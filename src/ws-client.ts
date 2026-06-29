import WebSocket from "ws";
import { AuthConfig } from "./auth/admin-auth.js";

export class WsClient {
  private ws: WebSocket | null = null;
  private config: AuthConfig;
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
    config: AuthConfig,
    private wsFactory: (url: string) => WebSocket = (url) => new WebSocket(url),
  ) {
    this.config = config;
  }

  get isConnected(): boolean {
    return this.connected;
  }

  async connect(): Promise<void> {
    if (this.connected) return;
    this.isShuttingDown = false;

    const wsUrl = this.config.baseUrl.replace("https://", "wss://").replace("http://", "ws://");
    const url = `${wsUrl}/ws/v1`;

    return new Promise((resolve, reject) => {
      this.ws = this.wsFactory(url);

      this.ws.on("open", () => {
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
        if (this.isShuttingDown) return; // explicit shutdown is terminal
        this.attemptReconnect();
      });

      this.ws.on("error", (err) => {
        if (!this.connected) reject(err);
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
        this.ws.send(JSON.stringify({ m: "ping", h: { "X-YB-API-Key": this.config.apiKey } }));
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
    const msg = {
      m: "subscribe" as const,
      c: channel,
      p: payload,
      h: {
        "X-YB-API-Key": this.config.apiKey,
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
        "X-YB-API-Key": this.config.apiKey,
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

    return new Promise<unknown[]>(async (resolve, reject) => {
      const timer = setTimeout(() => {
        this.subscriptionHandlers.delete(reqId);
        this.unsubscribe(channel, payload, reqId);
        resolve(results);
      }, timeout);

      this.subscriptionHandlers.set(reqId, (data) => {
        results.push(data);
      });

      try {
        await this.subscribe(channel, payload, reqId);
      } catch (err) {
        clearTimeout(timer);
        this.subscriptionHandlers.delete(reqId);
        reject(err instanceof Error ? err : new Error(String(err)));
        return;
      }

      // Give time for streaming data after snapshot
      setTimeout(() => {
        clearTimeout(timer);
        this.subscriptionHandlers.delete(reqId);
        this.unsubscribe(channel, payload, reqId);
        resolve(results);
      }, timeout);
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
