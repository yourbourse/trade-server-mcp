import WebSocket from "ws";
import { CredentialsProvider } from "./auth/admin-auth.js";

export class WsClient {
  private ws: WebSocket | null = null;
  private reqCounter = 0;
  private pendingRequests: Map<
    string,
    { resolve: (data: unknown) => void; reject: (err: Error) => void }
  > = new Map();
  // Handlers keyed by reqId (not channel)
  private subscriptionHandlers: Map<string, (data: unknown) => void> = new Map();
  private connected = false;
  private pingInterval: ReturnType<typeof setInterval> | null = null;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnecting = false;
  private isShuttingDown = false;
  // In-flight connect(), shared by concurrent callers so a single disconnected client can never open
  // two sockets at once (which would orphan one, leaking listeners and spurious reconnects).
  private connecting: Promise<void> | null = null;
  // Bounds the handshake so a black-holed connection can't hang connect() forever.
  private connectTimer: ReturnType<typeof setTimeout> | null = null;
  // fail() callbacks for in-flight getSnapshot calls: a socket drop must reject them instead of
  // letting a snapshot resolve with partial/empty data. Registered for the whole call — a pre-ack
  // drop is also covered by pendingRequests, so this specifically catches a drop AFTER the ack.
  private snapshotFailers = new Set<(err: Error) => void>();

  constructor(
    private baseUrl: string,
    private provider: CredentialsProvider,
    private wsFactory: (url: string) => WebSocket = (url) => new WebSocket(url),
    private connectTimeoutMs: number = 10_000,
  ) {}

  get isConnected(): boolean {
    return this.connected;
  }

  async connect(): Promise<void> {
    if (this.connected) return;
    // Single-flight: concurrent callers (e.g. a get_quotes fan-out on a fresh client) share one
    // attempt instead of each opening a socket. Cleared in the finally once the attempt settles.
    if (this.connecting) return this.connecting;
    this.isShuttingDown = false;

    // Anchored + case-insensitive: an uppercase scheme (e.g. "HTTPS://") passes config validation
    // (URL.protocol is normalized there) but keeps its original case in the raw baseUrl string.
    const wsUrl = this.baseUrl.replace(/^https:\/\//i, "wss://").replace(/^http:\/\//i, "ws://");
    const url = `${wsUrl}/ws/v1`;

    this.connecting = new Promise<void>((resolve, reject) => {
      // `settled` = the connect() promise resolved or rejected (gates late/duplicate events, incl. an
      // "open" that arrives after the timeout already rejected). `established` = the socket actually
      // opened, which alone permits an auto-reconnect on a later close.
      let settled = false;
      let established = false;
      const ws = this.wsFactory(url);
      this.ws = ws;

      const clearConnectTimer = () => {
        if (this.connectTimer) {
          clearTimeout(this.connectTimer);
          this.connectTimer = null;
        }
      };

      // Bound the handshake: a black-holed connection fires neither open nor close/error, so without
      // this connect() would hang forever (the REST transport already bounds its calls this way).
      this.connectTimer = setTimeout(() => {
        if (settled) return;
        settled = true;
        this.connectTimer = null;
        reject(new Error(`WebSocket connect timed out after ${this.connectTimeoutMs}ms`));
        try {
          ws.close();
        } catch {
          /* best-effort: closing a half-open socket */
        }
      }, this.connectTimeoutMs);

      ws.on("open", () => {
        if (settled) return; // a late open after a timeout/error must not flip us to connected
        settled = true;
        established = true;
        clearConnectTimer();
        this.connected = true;
        this.startPingPong();
        resolve();
      });

      ws.on("message", (data) => {
        if (this.ws !== ws) return; // ignore a stale socket a newer connect already replaced
        this.handleMessage(data.toString());
      });

      ws.on("close", () => {
        // A previous (timed-out/abandoned) socket can emit close after a newer connect replaced
        // this.ws — once this attempt has settled it must not touch the current connection. An
        // UNSETTLED attempt still runs (e.g. disconnect() nulls this.ws mid-connect) so its
        // connect() promise is settled instead of hanging.
        if (this.ws !== ws && settled) return;
        this.connected = false;
        this.stopPingPong();
        this.rejectPending(new Error("WebSocket closed"));
        if (!settled) {
          // Closed before it ever opened (server refused, or disconnect mid-connect): settle the
          // connect() promise so callers awaiting connect()/ensureConnected() don't hang forever.
          settled = true;
          clearConnectTimer();
          reject(new Error("WebSocket closed before connecting"));
          return;
        }
        // Only an established connection that dropped may auto-reconnect — never a failed or
        // timed-out attempt (whose close arrives after we already rejected).
        if (!established) return;
        if (this.isShuttingDown) return; // explicit shutdown is terminal
        this.attemptReconnect();
      });

      ws.on("error", (err) => {
        if (!settled) {
          settled = true;
          clearConnectTimer();
          reject(err);
        }
      });

      ws.on("ping", (data) => {
        if (this.ws !== ws) return; // ignore a stale socket a newer connect already replaced
        ws.pong(data);
      });
    });

    try {
      await this.connecting;
    } finally {
      this.connecting = null;
    }
  }

  /** Ensure connected, auto-reconnect if needed */
  async ensureConnected(): Promise<void> {
    if (this.connected) return;
    this.reconnectAttempts = 0;
    await this.connect();
  }

  private async attemptReconnect(): Promise<void> {
    if (this.isShuttingDown) return;
    if (this.reconnecting || this.reconnectAttempts >= this.maxReconnectAttempts) return;
    this.reconnecting = true;

    while (
      this.reconnectAttempts < this.maxReconnectAttempts &&
      !this.connected &&
      !this.isShuttingDown
    ) {
      this.reconnectAttempts++;
      const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts - 1), 16000);
      console.error(
        `WS reconnect attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts} in ${delay}ms`,
      );
      await new Promise((r) => setTimeout(r, delay));
      // disconnect() may have flipped isShuttingDown during the backoff above; a terminal
      // shutdown must not be undone by connect() (which resets the flag and reopens the socket).
      if (this.isShuttingDown) break;

      try {
        await this.connect();
        this.reconnectAttempts = 0;
        console.error("WS reconnected successfully");
      } catch {
        // continue retrying
      }
    }
    this.reconnecting = false;
  }

  disconnect() {
    this.isShuttingDown = true;
    if (this.connectTimer) {
      clearTimeout(this.connectTimer);
      this.connectTimer = null;
    }
    this.stopPingPong();
    this.rejectPending(new Error("WebSocket disconnected"));
    this.subscriptionHandlers.clear();
    if (this.ws) {
      this.ws.close();
      this.ws = null;
      this.connected = false;
    }
  }

  /** Reject and clear all in-flight requests — they cannot complete on a closed socket. */
  private rejectPending(err: Error) {
    for (const { reject } of this.pendingRequests.values()) reject(err);
    this.pendingRequests.clear();
    // Snapshots past their subscribe ack are no longer in pendingRequests; fail them too so a socket
    // drop mid-stream surfaces as an error rather than resolving with partial/empty data.
    for (const fail of [...this.snapshotFailers]) fail(err);
    this.snapshotFailers.clear();
  }

  private startPingPong() {
    this.stopPingPong();
    this.pingInterval = setInterval(() => {
      if (this.ws && this.connected) {
        this.ws.send(
          JSON.stringify({ m: "ping", h: { "X-YB-API-Key": this.provider.getApiKey() } }),
        );
      }
    }, 15000);
  }

  private stopPingPong() {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
  }

  /**
   * Subscribe to a WebSocket channel.
   * @param channel - Channel type: "L1" (quotes), "L2" (depth), "states", "orders", "positions", etc.
   * @param payload - Channel-specific payload (e.g. { s: "EURUSD", g: 1, streaming: true })
   * @param reqId - Unique subscription ID
   */
  async subscribe(
    channel: string,
    payload: Record<string, unknown>,
    reqId: string,
  ): Promise<unknown> {
    // A login-based provider has no key until its first successful sign-in (the server
    // registers tools even when the startup sign-in failed). Try once to recover before
    // subscribing — the provider's single-flight guard coalesces concurrent attempts.
    // If recovery fails (returns false OR throws), the frame still goes out and the
    // server rejects it cleanly.
    let apiKey = this.provider.getApiKey();
    if (!apiKey && this.provider.handleUnauthorized) {
      try {
        await this.provider.handleUnauthorized();
      } catch {
        // proceed without a key — the server's rejection is the error surface
      }
      apiKey = this.provider.getApiKey();
    }
    const msg = {
      m: "subscribe" as const,
      c: channel,
      p: payload,
      h: {
        "X-YB-API-Key": apiKey,
        "X-YB-LOCALE": "en" as const,
      },
      reqId,
    };

    return this.sendAndWait(reqId, msg);
  }

  async unsubscribe(
    channel: string,
    payload: Record<string, unknown>,
    reqId: string,
  ): Promise<void> {
    if (!this.ws || !this.connected) return;
    const msg = {
      m: "unsubscribe" as const,
      c: channel,
      p: payload,
      h: {
        "X-YB-API-Key": this.provider.getApiKey(),
        "X-YB-LOCALE": "en" as const,
      },
      reqId,
    };
    this.send(msg);
  }

  onMessage(reqId: string, handler: (data: unknown) => void) {
    this.subscriptionHandlers.set(reqId, handler);
  }

  /** Subscribe and collect snapshot + streaming data with a timeout */
  async getSnapshot(
    channel: string,
    payload: Record<string, unknown>,
    options?: { timeoutMs?: number },
  ): Promise<unknown[]> {
    const results: unknown[] = [];
    const timeout = options?.timeoutMs ?? 3000;
    const reqId = `snapshot_${++this.reqCounter}`;

    await this.ensureConnected();

    return new Promise<unknown[]>((resolve, reject) => {
      let settled = false;
      const cleanup = () => {
        this.subscriptionHandlers.delete(reqId);
        this.snapshotFailers.delete(fail);
        // unsubscribe is async, so a synchronous throw inside it surfaces as a rejected promise that
        // a try/catch here would NOT catch — swallow it with .catch to keep this best-effort.
        void this.unsubscribe(channel, payload, reqId).catch(() => {
          /* best-effort: the socket may already be closed */
        });
      };
      // settled guard: once we resolve/reject, later handlers (a late subscribe ack after the
      // fallback already fired, or vice-versa) must no-op — no double cleanup, no extra timer.
      const finish = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        cleanup();
        resolve(results);
      };
      const fail = (err: unknown) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        cleanup();
        reject(err instanceof Error ? err : new Error(String(err)));
      };
      // Register for the whole call so a socket drop (via rejectPending) fails this snapshot instead
      // of leaving it to time out with partial data. A pre-ack drop is also caught by pendingRequests
      // (the subscribe promise rejects → .catch(fail)); the settled guard makes the extra call a
      // no-op. cleanup() deregisters it on settle.
      this.snapshotFailers.add(fail);

      this.subscriptionHandlers.set(reqId, (data) => {
        results.push(data);
      });

      // Fallback: if subscribe never resolves, resolve with whatever arrived after `timeout`.
      let timer = setTimeout(finish, timeout);

      // Non-async executor: drive the subscribe promise with .then/.catch so a rejection can never
      // leak as an unhandled rejection (an async Promise executor would not reject the outer promise).
      this.subscribe(channel, payload, reqId)
        .then(() => {
          if (settled) return; // fallback already fired — don't reschedule or double-clean
          // Subscribe succeeded — restart the timer as a streaming window so the caller always
          // gets the full window after a successful subscribe.
          clearTimeout(timer);
          timer = setTimeout(finish, timeout);
        })
        .catch(fail);
    });
  }

  private send(msg: unknown) {
    if (!this.ws || !this.connected) {
      throw new Error("WebSocket not connected");
    }
    this.ws.send(JSON.stringify(msg));
  }

  private sendAndWait(reqId: string, msg: unknown): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingRequests.delete(reqId);
        reject(new Error(`Request ${reqId} timed out`));
      }, 5000);

      this.pendingRequests.set(reqId, {
        resolve: (data) => {
          clearTimeout(timer);
          resolve(data);
        },
        reject: (err) => {
          clearTimeout(timer);
          reject(err);
        },
      });

      this.send(msg);
    });
  }

  private handleMessage(raw: string) {
    try {
      const msg = JSON.parse(raw);

      // Ignore pong responses
      if (msg.m === "pong") return;

      // Handle subscription ack — server echoes { m: "subscribe", s: true/false, reqId, ... }
      if (msg.reqId && msg.m === "subscribe") {
        const pending = this.pendingRequests.get(msg.reqId);
        if (pending) {
          this.pendingRequests.delete(msg.reqId);
          if (msg.s === true) {
            pending.resolve(msg);
          } else {
            pending.reject(new Error(msg.e?.msg || msg.e?.detail || "Subscription failed"));
          }
        }
        return;
      }

      // Handle errors
      if (msg.reqId && msg.m === "error") {
        const pending = this.pendingRequests.get(msg.reqId);
        if (pending) {
          this.pendingRequests.delete(msg.reqId);
          pending.reject(new Error(msg.e?.msg || msg.detail || "Request failed"));
        }
        return;
      }

      // Handle data updates — route by reqId
      // Format: { c: "L1"|"L2"|..., t: "s"|"u"|"d", d: [...], reqId: "..." }
      if (msg.reqId && msg.d) {
        const handler = this.subscriptionHandlers.get(msg.reqId);
        if (handler) {
          handler(msg);
        }
      }
    } catch {
      // ignore parse errors
    }
  }
}
