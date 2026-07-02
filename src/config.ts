export type ServerConfig = (
  | {
      mode: "admin";
      baseUrl: string;
      auth:
        | { style: "keys"; apiKey: string; secretKey: string }
        | { style: "login"; login: number; password: string; broker?: string };
    }
  | {
      mode: "client";
      baseUrl: string;
      auth:
        | { style: "login"; login: number; password: string; broker?: string }
        | { style: "token"; apiKey: string; secretKey: string };
    }
  | {
      mode: "auto";
      baseUrl: string;
      auth: { style: "login"; login: number; password: string; broker?: string };
    }
) & { requestTimeoutMs: number };

const HELP = `Trade Server MCP configuration:
  Sign in (recommended):  YB_BASE_URL + YB_LOGIN + YB_PASSWORD [+ YB_BROKER]
                          — your role (trader or manager) is detected automatically.
  Explicit override:      add YB_MODE=client or YB_MODE=admin to skip detection.
  API key pair:           YB_BASE_URL + YB_API_KEY + YB_SECRET_KEY (admin, or client tokens with YB_MODE=client)
  Optional (all modes):   YB_REQUEST_TIMEOUT_MS (per-request timeout in ms; positive integer; default 10000)
  Optional (all modes):   YB_ALLOW_INSECURE_BASE_URL (true/1/yes — allow http:// for local development only)`;

export function parseConfig(env: Record<string, string | undefined>): ServerConfig {
  const v = (name: string) => {
    const raw = env[name];
    if (raw === undefined) return undefined;
    const t = raw.trim();
    // An unsubstituted manifest placeholder (e.g. "${user_config.yb_broker}", which Claude
    // Desktop injects for an empty optional .mcpb field) is treated as unset — otherwise the
    // literal string is sent as a real value and the server rejects the request.
    if (t === "" || /^\$\{[^}]*\}$/.test(t)) return undefined;
    return t;
  };

  const baseUrl = v("YB_BASE_URL");
  if (!baseUrl) throw new Error(`Missing YB_BASE_URL.\n${HELP}`);

  // Transport security: credentials are signed/sent on every request, so the base URL must use a
  // secure transport. HTTPS is required by default; plain http:// is allowed only when explicitly
  // opted in for local development. Embedded URL credentials are always rejected (leak risk).
  const allowInsecureBaseUrl = /^(1|true|yes)$/i.test(v("YB_ALLOW_INSECURE_BASE_URL") ?? "");
  let parsedBaseUrl: URL;
  try {
    parsedBaseUrl = new URL(baseUrl);
  } catch {
    throw new Error(`YB_BASE_URL must be a valid URL.\n${HELP}`);
  }
  if (allowInsecureBaseUrl) {
    if (parsedBaseUrl.protocol !== "https:" && parsedBaseUrl.protocol !== "http:") {
      throw new Error(
        `YB_BASE_URL must use http:// or https:// when YB_ALLOW_INSECURE_BASE_URL is enabled.\n${HELP}`,
      );
    }
  } else if (parsedBaseUrl.protocol !== "https:") {
    throw new Error(
      `YB_BASE_URL must use https:// to protect API credentials in transit. Set YB_ALLOW_INSECURE_BASE_URL=true only for local development.\n${HELP}`,
    );
  }
  if (parsedBaseUrl.username || parsedBaseUrl.password) {
    throw new Error(`YB_BASE_URL must not include username/password credentials.\n${HELP}`);
  }

  const timeout_raw = v("YB_REQUEST_TIMEOUT_MS");
  let requestTimeoutMs = 10_000;
  if (timeout_raw !== undefined) {
    const n = Number(timeout_raw);
    if (!Number.isInteger(n) || n <= 0) {
      throw new Error(
        `YB_REQUEST_TIMEOUT_MS must be a positive integer (milliseconds), got "${timeout_raw}".\n${HELP}`,
      );
    }
    requestTimeoutMs = n;
  }

  const mode_raw = v("YB_MODE");
  const login_raw = v("YB_LOGIN");
  const password_raw = v("YB_PASSWORD");
  const apiKey_raw = v("YB_API_KEY");
  const secretKey_raw = v("YB_SECRET_KEY");
  const broker_raw = v("YB_BROKER");

  const hasLogin = login_raw !== undefined || password_raw !== undefined;
  const hasKeys = apiKey_raw !== undefined || secretKey_raw !== undefined;
  // Login/password without an explicit YB_MODE = "auto": the bootstrap signs in and
  // detects the account's role (manager -> admin tools, trader -> client tools).
  const mode = mode_raw ?? (hasLogin ? "auto" : hasKeys ? "admin" : undefined);

  // Shared login/password validation — the same rules apply in client, admin and auto modes.
  const parseLoginAuth = (label: string) => {
    if (hasLogin && hasKeys) {
      throw new Error(
        `${label}: set either YB_LOGIN/YB_PASSWORD or YB_API_KEY/YB_SECRET_KEY, not both.\n${HELP}`,
      );
    }
    if (!login_raw) throw new Error(`${label} requires YB_LOGIN.\n${HELP}`);
    const login = Number(login_raw);
    if (!Number.isInteger(login) || login <= 0) {
      throw new Error(`YB_LOGIN must be a positive integer (got "${login_raw}").\n${HELP}`);
    }
    if (!password_raw) throw new Error(`${label} requires YB_PASSWORD.\n${HELP}`);
    return { style: "login" as const, login, password: password_raw, broker: broker_raw };
  };

  if (mode === "admin") {
    if (hasLogin) {
      return { mode: "admin", baseUrl, auth: parseLoginAuth("Admin login mode"), requestTimeoutMs };
    }
    if (!apiKey_raw) throw new Error(`Admin mode requires YB_API_KEY.\n${HELP}`);
    if (!secretKey_raw) throw new Error(`Admin mode requires YB_SECRET_KEY.\n${HELP}`);
    return {
      mode: "admin",
      baseUrl,
      auth: { style: "keys", apiKey: apiKey_raw, secretKey: secretKey_raw },
      requestTimeoutMs,
    };
  }

  if (mode === "auto") {
    // No YB_MODE was chosen, so error labels must not imply one ("Sign-in requires
    // YB_LOGIN", not "Client login mode requires YB_LOGIN").
    return { mode: "auto", baseUrl, auth: parseLoginAuth("Sign-in"), requestTimeoutMs };
  }

  if (mode === "client") {
    if (hasLogin) {
      return {
        mode: "client",
        baseUrl,
        auth: parseLoginAuth("Client login mode"),
        requestTimeoutMs,
      };
    }
    if (hasKeys) {
      if (!apiKey_raw || !secretKey_raw) {
        throw new Error(`Client token mode requires both YB_API_KEY and YB_SECRET_KEY.\n${HELP}`);
      }
      return {
        mode: "client",
        baseUrl,
        auth: { style: "token", apiKey: apiKey_raw, secretKey: secretKey_raw },
        requestTimeoutMs,
      };
    }
    throw new Error(`Client mode requires credentials.\n${HELP}`);
  }

  if (mode !== undefined) {
    throw new Error(`Unknown YB_MODE "${mode_raw}". Valid values: admin, client.\n${HELP}`);
  }
  throw new Error(
    `No mode could be inferred — set YB_LOGIN + YB_PASSWORD (sign-in, auto-detected role) or YB_API_KEY + YB_SECRET_KEY (admin keys).\n${HELP}`,
  );
}
