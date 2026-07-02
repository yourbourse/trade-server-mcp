import { CredentialsProvider, generateSignature } from "./admin-auth.js";

export interface ClientLoginOptions {
  login: number;
  password: string;
  broker?: string;
}

interface ApiToken {
  account: number;
  token: string;
  signingToken: string;
  expiration: number; // microseconds since epoch
}

/** Auth request failure carrying the HTTP status (null for network/abort errors). */
export class AuthRequestError extends Error {
  constructor(
    message: string,
    public readonly status: number | null,
  ) {
    super(message);
    this.name = "AuthRequestError";
  }
}

/**
 * Login-based client auth: POST /authorize signed with the account password,
 * then token+signingToken for all requests. Auto-refresh at 80% of lifetime.
 */
export class ClientAuth implements CredentialsProvider {
  private token = "";
  private signingToken = "";
  private expiration = 0;
  private accountId = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private inflight: Promise<void> | null = null;
  private lastAuthFailure: AuthRequestError | null = null;

  constructor(
    private baseUrl: string,
    private opts: ClientLoginOptions,
  ) {}

  getApiKey() {
    return this.token;
  }
  getSigningSecret() {
    return this.signingToken;
  }

  /** Account ID confirmed by the server, or null before sign-in. */
  get account(): number | null {
    return this.token ? this.accountId : null;
  }

  async authorize(): Promise<void> {
    if (this.inflight) return this.inflight;
    this.inflight = this.doAuthorize().finally(() => {
      this.inflight = null;
    });
    return this.inflight;
  }

  /** Rotate token+signingToken using the current pair. */
  async refresh(): Promise<void> {
    if (this.inflight) return this.inflight;
    this.inflight = this.doRefresh().finally(() => {
      this.inflight = null;
    });
    return this.inflight;
  }

  /** RestClient hook: on 401, re-authorize from scratch once. */
  async handleUnauthorized(): Promise<boolean> {
    try {
      await this.authorize();
      return true;
    } catch (err) {
      console.error(
        "Trade Server MCP: re-authorization failed:",
        err instanceof Error ? err.message : String(err),
      );
      return false;
    }
  }

  stop() {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private async doAuthorize(): Promise<void> {
    const body: Record<string, unknown> = { login: this.opts.login };
    if (this.opts.broker) body.broker = this.opts.broker;
    let result: ApiToken;
    try {
      result = await this.signedPost("/authorize", JSON.stringify(body), this.opts.password, "");
    } catch (err) {
      if (err instanceof AuthRequestError) this.lastAuthFailure = err;
      throw err;
    }
    this.store(result);
  }

  private async doRefresh(): Promise<void> {
    const result = await this.signedPost("/refresh", "{}", this.signingToken, this.token);
    this.store(result);
  }

  private store(t: ApiToken) {
    if (!t.token || !t.signingToken || !t.expiration) {
      throw new Error("Malformed ApiToken from server; refusing partial token state");
    }
    this.token = t.token;
    this.signingToken = t.signingToken;
    this.expiration = t.expiration;
    this.accountId = t.account;
    this.lastAuthFailure = null;
    this.scheduleRefresh();
  }

  /** Human-readable hint for the last sign-in failure, or null if signed in / never failed. */
  authFailureHint(): string | null {
    if (!this.lastAuthFailure) return null;
    const status = this.lastAuthFailure.status;
    if (status === 401 || status === 403) {
      return "Sign-in to the Trade Server failed: check YB_LOGIN and YB_PASSWORD.";
    }
    if (status === 400 || status === 404) {
      return `Sign-in was rejected by the Trade Server (HTTP ${status}) — usually an invalid request parameter or wrong endpoint. Verify YB_BASE_URL points to your Trade Server's API address (traders: the client/public API; managers: the admin API — they can differ in port), and that any optional fields (e.g. YB_BROKER) are correct or left unset. If the configuration is correct, the account may not be enabled for this API on this server, or the server version may predate it — check with your broker.`;
    }
    if (status === null) {
      return "Could not reach the Trade Server: check YB_BASE_URL and network connectivity.";
    }
    return `Sign-in to the Trade Server failed (HTTP ${status}).`;
  }

  private scheduleRefresh() {
    this.stop();
    const msLeft = this.expiration / 1000 - Date.now();
    const delay = Math.min(Math.max(msLeft * 0.8, 5_000), 2 ** 31 - 1);
    this.timer = setTimeout(() => {
      this.refresh().catch(() => {
        this.authorize().catch((err) => {
          console.error(
            "Trade Server MCP: re-authorization failed:",
            err instanceof Error ? err.message : String(err),
          );
        });
      });
    }, delay);
    if (typeof (this.timer as any).unref === "function") (this.timer as any).unref();
  }

  private async signedPost(
    path: string,
    body: string,
    secret: string,
    apiKey: string,
  ): Promise<ApiToken> {
    const timestamp = Date.now() * 1000;
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "X-YB-Timestamp": timestamp.toString(),
      "X-YB-Sign": generateSignature(secret, body, timestamp),
    };
    if (apiKey) headers["X-YB-API-Key"] = apiKey;
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}/api/v1${path}`, {
        method: "POST",
        headers,
        body,
        signal: AbortSignal.timeout(10_000),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new AuthRequestError(`POST ${path} failed: ${msg}`, null);
    }
    if (!res.ok) {
      const text = await res.text();
      throw new AuthRequestError(
        `POST ${path} failed (${res.status}): ${text.slice(0, 200)}`,
        res.status,
      );
    }
    return res.json() as Promise<ApiToken>;
  }
}
