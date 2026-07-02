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

  constructor(
    private baseUrl: string,
    private provider: CredentialsProvider,
    private wsFactory: (url: string) => WebSocket = (url) => new WebSocket(url),
  ) {}

  get isConnected(): boolean {
    return this.connected;
  }

  async connect(): Promise<void> {
    if (this.connected) return;
    this.isShuttingDown = false;

    // Anchored + case-insensitive: an uppercase scheme (e.g. "HTTPS://") passes config validation
    // (URL.protocol is normalized there) but keeps its original case in the raw baseUrl string.
    const wsUrl = this.baseUrl.replace(/^https:\/\//i, "wss://").replace(/^http:\/\//i, "ws://");
    const url = `${wsUrl}/ws/v1`;

    return new Promise<void>((resolve, reject) => {
      let opened = false;
      this.ws = this.wsFactory(url);

      this.ws.on("open", () => {
        opened = true;
        this.connected = true;
        this.startPingPong();
        resolve();
      });

      this.ws.on("message", (data) => {
        this.handleMessage(data.toString());
      });

      this.ws.on("close", () => {
        this.connected = false;
        this.stopPingPong();
        this.rejectPending(new Error("WebSocket closed"));
        if (!opened) {
          // Closed before it ever opened (server refused, or disconnect mid-connect): settle the
          // connect() promise so callers awaiting connect()/ensureConnected() don't hang forever.
          opened = true;
          reject(new Error("WebSocket closed before connecting"));
          return;
        }
        if (this.isShuttingDown) return; // explicit shutdown is terminal
        this.attemptReconnect();
      });

      this.ws.on("error", (err) => {
        if (!opened) {
          opened = true;
          reject(err);
        }
      });

      this.ws.on("ping", (data) => {
        this.ws?.pong(data);
      });
    });
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
