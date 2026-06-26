import { CredentialsProvider, generateSignature } from "./auth/admin-auth.js";

export class ApiError extends Error {
  public readonly statusCode: number;
  public readonly errorCode: string;
  public readonly detail: string;

  constructor(method: string, path: string, statusCode: number, body: string) {
    let errorCode = "UNKNOWN";
    let detail = body;

    try {
      const parsed = JSON.parse(body);
      if (parsed.e) errorCode = parsed.e;
      if (parsed.message) detail = parsed.message;
      else if (parsed.error) detail = parsed.error;
    } catch {
      // body is not JSON — use as-is
    }

    // Map common HTTP status codes to semantic codes
    if (errorCode === "UNKNOWN") {
      if (statusCode === 400) errorCode = "BAD_REQUEST";
      else if (statusCode === 401) errorCode = "UNAUTHORIZED";
      else if (statusCode === 403) errorCode = "FORBIDDEN";
      else if (statusCode === 404) errorCode = "NOT_FOUND";
      else if (statusCode === 409) errorCode = "CONFLICT";
      else if (statusCode === 412) errorCode = "PRECONDITION_FAILED";
      else if (statusCode === 429) errorCode = "RATE_LIMITED";
      else if (statusCode >= 500) errorCode = "SERVER_ERROR";
    }

    super(`${method} ${path} failed [${errorCode}]: ${detail}`);
    this.name = "ApiError";
    this.statusCode = statusCode;
    this.errorCode = errorCode;
    this.detail = detail;
  }
}

export class RestClient {
  private etags: Map<string, string> = new Map();

  constructor(
    private baseUrl: string,
    private provider: CredentialsProvider,
    private timeoutMs: number = 10_000,
  ) {}

  /** fetch with a per-request deadline applied via AbortSignal.timeout. */
  private fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
    return fetch(url, { ...init, signal: AbortSignal.timeout(this.timeoutMs) });
  }

  /** A fired AbortSignal.timeout rejects with an Error named "TimeoutError". */
  private isTimeout(err: unknown): boolean {
    return err instanceof Error && err.name === "TimeoutError";
  }

  /**
   * The stable ApiError a fired request timeout maps to (errorCode "TIMEOUT",
   * status 408) so it is reported consistently AND — being an ApiError — is never
   * auto-retried by doSend's transport loop (a timeout is not proof of non-delivery;
   * retrying could double-fill orders). The deadline can fire during the fetch OR
   * while reading the response body (res.json()/res.text()), so every request stage
   * routes its errors through this — see the try/catch in doGet/doSend/doDelete.
   */
  private timeoutApiError(method: string, path: string): ApiError {
    return new ApiError(
      method,
      path,
      408,
      JSON.stringify({ e: "TIMEOUT", message: `request timed out after ${this.timeoutMs}ms` }),
    );
  }

  private buildHeaders(method: string, body?: string): Record<string, string> {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    const key = this.provider.getApiKey();
    if (key) headers["X-YB-API-Key"] = key;
    if (method !== "GET") {
      const timestamp = Date.now() * 1000;
      headers["X-YB-Timestamp"] = timestamp.toString();
      headers["X-YB-Sign"] = generateSignature(
        this.provider.getSigningSecret(),
        body || "",
        timestamp,
      );
    }
    return headers;
  }

  /**
   * Run a request once; on a 401, ask the provider to renew credentials and
   * re-run the request exactly once. A second 401 (or any other error)
   * propagates. If renewal itself throws, the original 401 is surfaced.
   */
  private async withAuthRetry<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      if (err instanceof ApiError && err.statusCode === 401 && this.provider.handleUnauthorized) {
        let renewed = false;
        try {
          renewed = await this.provider.handleUnauthorized();
        } catch {
          throw err; // renewal itself failed — surface the original 401
        }
        if (renewed) return await fn(); // second 401 propagates — no loop
      }
      throw err;
    }
  }

  private async doGet<T>(path: string): Promise<T> {
    const url = `${this.baseUrl}/api/v1${path}`;
    const headers = this.buildHeaders("GET");

    const etag = this.etags.get(path);
    if (etag) {
      headers["If-None-Match"] = etag;
    }

    try {
      const res = await this.fetchWithTimeout(url, { method: "GET", headers });

      if (res.status === 304) {
        throw new Error("Not modified (304)");
      }

      if (!res.ok) {
        const text = await res.text();
        throw new ApiError("GET", path, res.status, text);
      }

      const newEtag = res.headers.get("ETag");
      if (newEtag) {
        this.etags.set(path, newEtag);
      }

      return (await res.json()) as T;
    } catch (err) {
      if (this.isTimeout(err)) throw this.timeoutApiError("GET", path);
      throw err;
    }
  }

  private async doSend<T>(
    method: "POST" | "PUT",
    path: string,
    bodyStr: string,
    retryOnConnectionError = true,
  ): Promise<T> {
    const url = `${this.baseUrl}/api/v1${path}`;

    // Retry once on connection-level failures (undici connection reuse issues).
    // 401 handling lives in withAuthRetry — this loop only covers transport errors.
    // NOTE: a connection reset does not prove non-delivery — the server may have
    // received the request before the connection dropped. Order placements pass
    // retryOnConnectionError=false to opt out and avoid duplicate fills.
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const headers = this.buildHeaders(method, bodyStr);

        const etag = this.etags.get(path);
        if (etag) {
          headers["If-Match"] = etag;
        }

        // An empty bodyStr means "no body at all": some endpoints (e.g. the
        // client /account/state) reject any payload — even {} — but accept a
        // body-less request signed over the empty string.
        const res = await this.fetchWithTimeout(url, {
          method,
          headers,
          body: bodyStr || undefined,
        });

        if (!res.ok) {
          const text = await res.text();
          throw new ApiError(method, path, res.status, text);
        }

        const newEtag = res.headers.get("ETag");
        if (newEtag) {
          this.etags.set(path, newEtag);
        }

        const text = await res.text();
        if (!text) return {} as T;
        return JSON.parse(text) as T;
      } catch (err) {
        // A timeout can fire during the fetch OR the res.text() body read; map it
        // to the stable TIMEOUT ApiError (which the line below then refuses to retry).
        if (this.isTimeout(err)) throw this.timeoutApiError(method, path);
        if (err instanceof ApiError) throw err; // don't swallow HTTP errors
        const msg = err instanceof Error ? err.message : "";
        // Only retry on connection-level failures, not HTTP errors
        if (
          retryOnConnectionError &&
          attempt === 0 &&
          (msg === "fetch failed" || msg.includes("ECONNRESET") || msg.includes("socket hang up"))
        ) {
          console.error(`${method} ${path}: connection failed, retrying...`);
          continue;
        }
        throw err;
      }
    }
    throw new Error(`${method} ${path}: unreachable`);
  }

  private async doDelete<T>(path: string, bodyStr: string): Promise<T> {
    const url = `${this.baseUrl}/api/v1${path}`;
    const headers = this.buildHeaders("DELETE", bodyStr);

    const etag = this.etags.get(path);
    if (etag) {
      headers["If-Match"] = etag;
    }

    try {
      const res = await this.fetchWithTimeout(url, {
        method: "DELETE",
        headers,
        body: bodyStr || undefined,
      });

      if (!res.ok) {
        const text = await res.text();
        throw new ApiError("DELETE", path, res.status, text);
      }

      const text = await res.text();
      if (!text) return {} as T;
      return JSON.parse(text) as T;
    } catch (err) {
      if (this.isTimeout(err)) throw this.timeoutApiError("DELETE", path);
      throw err;
    }
  }

  async get<T = unknown>(path: string): Promise<T> {
    return this.withAuthRetry(() => this.doGet<T>(path));
  }

  async post<T = unknown>(
    path: string,
    body?: unknown,
    opts?: { retryOnConnectionError?: boolean },
  ): Promise<T> {
    // Explicit: an undefined body means the request is sent with NO body and
    // the signature is computed over the empty string.
    const bodyStr = body === undefined ? "" : JSON.stringify(body);
    return this.withAuthRetry(() =>
      this.doSend<T>("POST", path, bodyStr, opts?.retryOnConnectionError ?? true),
    );
  }

  async put<T = unknown>(
    path: string,
    body: unknown,
    opts?: { retryOnConnectionError?: boolean },
  ): Promise<T> {
    const bodyStr = JSON.stringify(body);
    return this.withAuthRetry(() =>
      this.doSend<T>("PUT", path, bodyStr, opts?.retryOnConnectionError ?? true),
    );
  }

  async delete<T = unknown>(path: string, body?: unknown): Promise<T> {
    const bodyStr = body ? JSON.stringify(body) : "";
    return this.withAuthRetry(() => this.doDelete<T>(path, bodyStr));
  }

  /** Store an etag for a specific path (useful after queries) */
  setEtag(path: string, etag: string) {
    this.etags.set(path, etag);
  }

  /** Get stored etag */
  getEtag(path: string): string | undefined {
    return this.etags.get(path);
  }
}
