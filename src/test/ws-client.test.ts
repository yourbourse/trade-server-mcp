import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { WsClient } from "../ws-client.js";
import { StaticCredentials } from "../auth/admin-auth.js";

// Safety net: disconnect any client a test opened — even if an assertion threw
// before the test's own disconnect() — so the keepalive ping interval can't leak
// and hang `node --test`.
const activeClients: WsClient[] = [];
afterEach(() => {
  for (const c of activeClients.splice(0)) c.disconnect();
});

// Minimal controllable WebSocket double: records sent frames, lets the test
// emit "open"/"close"/"message". NOTE: close() emits "close" SYNCHRONOUSLY here,
// whereas the real `ws` socket emits it asynchronously — fine for these tests.
class FakeSocket extends EventEmitter {
  sent: string[] = [];
  closed = false;
  send(data: string) {
    this.sent.push(data);
  }
  close() {
    if (this.closed) return;
    this.closed = true;
    this.emit("close");
  }
  pong() {}
}

function makeClient() {
  const sockets: FakeSocket[] = [];
  const factory = (_url: string) => {
    const s = new FakeSocket();
    sockets.push(s);
    return s as unknown as import("ws").WebSocket;
  };
  const client = new WsClient("https://ts.local", new StaticCredentials("K", "S"), factory);
  activeClients.push(client);
  return { client, sockets };
}

/** connect() and drive the socket to "open". */
async function openClient() {
  const { client, sockets } = makeClient();
  const p = client.connect();
  sockets[0].emit("open");
  await p;
  return { client, sockets };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

test("derives a case-insensitive wss:// URL even from an uppercase base-URL scheme", () => {
  let capturedUrl = "";
  const factory = (url: string) => {
    capturedUrl = url;
    return new FakeSocket() as unknown as import("ws").WebSocket;
  };
  const client = new WsClient("HTTPS://ts.local", new StaticCredentials("K", "S"), factory);
  activeClients.push(client);
  client.connect().catch(() => {}); // never opens in this test; the URL is derived synchronously
  assert.match(capturedUrl, /^wss:\/\/ts\.local\/ws\/v1$/);
});

test("connect() rejects (no hang) if the socket closes before it opens", async () => {
  const { client, sockets } = makeClient();
  const p = client.connect();
  sockets[0].emit("close"); // close arrives before any "open"
  await assert.rejects(() => p, /closed before connecting/i);
});

test("explicit disconnect does not reconnect", async () => {
  const { client, sockets } = await openClient();
  assert.equal(client.isConnected, true);
  client.disconnect();
  assert.equal(client.isConnected, false);
  // Wait past the first reconnect backoff (~1000ms): a buggy close handler would
  // have created a second socket by now. The fix gates reconnect on isShuttingDown.
  await new Promise((r) => setTimeout(r, 1100));
  assert.equal(sockets.length, 1, "no new socket should be created after disconnect");
});

test("disconnect() during the reconnect backoff is terminal (no socket reopens)", async () => {
  const { client, sockets } = await openClient();
  sockets[0].emit("close"); // unexpected close → attemptReconnect starts and awaits the ~1000ms backoff
  await new Promise((r) => setTimeout(r, 100)); // we are now inside the backoff window
  client.disconnect(); // flips isShuttingDown mid-backoff
  // Wait past the first backoff (~1000ms). Without the post-delay shutdown re-check, the loop would
  // call connect() (which resets isShuttingDown) and reopen a second socket; the fix breaks instead.
  await new Promise((r) => setTimeout(r, 1200));
  assert.equal(sockets.length, 1, "a disconnect during backoff must not reopen the socket");
});

test("pending requests reject on disconnect (no hang)", async () => {
  const { client } = await openClient();
  const pending = client.subscribe("L1", { s: "EURUSD" }, "req1"); // pending sendAndWait
  const rejected = assert.rejects(() => pending, /disconnect/i);
  client.disconnect();
  await rejected;
});

test("unexpected close triggers a reconnect", async () => {
  const { client, sockets } = await openClient();
  sockets[0].emit("close"); // not via disconnect() → isShuttingDown stays false
  await new Promise((r) => setTimeout(r, 1200)); // first backoff is ~1000ms
  assert.ok(sockets.length >= 2, `expected a reconnect socket, got ${sockets.length}`);
  sockets[1].emit("open"); // complete the reconnect cleanly
  await tick();
  client.disconnect(); // stop ping interval so the test process can exit
});

test("getSnapshot rejects when the subscribe is refused", async () => {
  const { client, sockets } = await openClient();
  const snap = client.getSnapshot("L1", { s: "EURUSD" }, { timeoutMs: 50 });
  await tick(); // let getSnapshot send the subscribe frame
  const reqId = JSON.parse(sockets[0].sent.at(-1)!).reqId;
  sockets[0].emit(
    "message",
    JSON.stringify({ m: "subscribe", s: false, reqId, e: { msg: "denied" } }),
  );
  await assert.rejects(() => snap, /denied/i);
  client.disconnect();
});

test("connect() rejects if the handshake never completes (timeout)", async () => {
  const sockets: FakeSocket[] = [];
  const factory = (_url: string) => {
    const s = new FakeSocket();
    sockets.push(s);
    return s as unknown as import("ws").WebSocket;
  };
  // 20ms connect timeout; the fake socket never emits open/close/error, so a black-holed handshake
  // must self-reject instead of hanging forever.
  const client = new WsClient("https://ts.local", new StaticCredentials("K", "S"), factory, 20);
  activeClients.push(client);
  await assert.rejects(() => client.connect(), /timed out/i);
});

test("a late open after a connect timeout does not connect the client or reconnect", async () => {
  const sockets: FakeSocket[] = [];
  const factory = (_url: string) => {
    const s = new FakeSocket();
    sockets.push(s);
    return s as unknown as import("ws").WebSocket;
  };
  const client = new WsClient("https://ts.local", new StaticCredentials("K", "S"), factory, 20);
  activeClients.push(client);
  await assert.rejects(() => client.connect(), /timed out/i);
  // A slow handshake fires "open" AFTER the timeout already rejected: it must be ignored, not flip
  // the client to connected (callers already saw a rejection) or start a background reconnect.
  sockets[0].emit("open");
  await tick();
  assert.equal(client.isConnected, false, "a late open must not connect the client");
  assert.equal(sockets.length, 1, "a timed-out attempt must not create a reconnect socket");
});

test("a stale socket's late close does not tear down a newer established connection", async () => {
  const { client, sockets } = makeClient();
  // Attempt 1 fails (closed before it opened) and is abandoned.
  const first = client.connect();
  sockets[0].emit("close");
  await assert.rejects(() => first, /closed before connecting/i);
  // Attempt 2 opens a fresh socket and establishes the connection.
  const second = client.connect();
  sockets[1].emit("open");
  await second;
  assert.equal(client.isConnected, true);
  // The abandoned socket #0 emits a late close — a real socket's async close can land after a
  // reconnect replaced this.ws. It must NOT touch the current connection.
  sockets[0].emit("close");
  assert.equal(client.isConnected, true, "a stale socket's close must not disconnect the client");
  client.disconnect();
});

test("concurrent connect() calls share one in-flight attempt (no second socket)", async () => {
  const { client, sockets } = makeClient();
  const p1 = client.connect();
  const p2 = client.connect();
  // Both calls must reuse the same in-flight attempt: exactly one socket is created. Without the
  // guard the second connect() opens a second socket and overwrites this.ws, orphaning the first.
  assert.equal(sockets.length, 1, "concurrent connects must not open a second socket");
  sockets[0].emit("open");
  await Promise.all([p1, p2]);
  client.disconnect();
});

test("getSnapshot fails if the socket drops after a successful subscribe (not a silent partial)", async () => {
  const { client, sockets } = await openClient();
  // Long window so the fallback timer cannot fire during the test — the close must be what settles it.
  const snap = client.getSnapshot("L1", { s: "EURUSD" }, { timeoutMs: 100 });
  await tick();
  const reqId = JSON.parse(sockets[0].sent.at(-1)!).reqId;
  sockets[0].emit("message", JSON.stringify({ m: "subscribe", s: true, reqId })); // subscribe ack OK
  await tick();
  sockets[0].emit("close"); // connection drops mid-stream, after the ack
  await assert.rejects(() => snap, /clos/i);
  client.disconnect();
});

test("getSnapshot collects data and resolves on success", async () => {
  const { client, sockets } = await openClient();
  const snap = client.getSnapshot("L1", { s: "EURUSD" }, { timeoutMs: 50 });
  await tick();
  const reqId = JSON.parse(sockets[0].sent.at(-1)!).reqId;
  sockets[0].emit("message", JSON.stringify({ m: "subscribe", s: true, reqId }));
  sockets[0].emit("message", JSON.stringify({ reqId, c: "L1", d: [{ bid: 1.1, ask: 1.2 }] }));
  const result = await snap;
  assert.ok(Array.isArray(result) && result.length >= 1, "should collect the data frame");
  client.disconnect();
});

test("subscribe sends the provider's CURRENT api key (token rotation)", async () => {
  let key = "token-1";
  const provider = { getApiKey: () => key, getSigningSecret: () => "" };
  const sockets: FakeSocket[] = [];
  const factory = (_url: string) => {
    const s = new FakeSocket();
    sockets.push(s);
    return s as unknown as import("ws").WebSocket;
  };
  const client = new WsClient("https://ts.local", provider, factory);
  activeClients.push(client);
  const connecting = client.connect();
  sockets[0].emit("open");
  await connecting;

  const p1 = client.subscribe("L1", { s: "EURUSD" }, "r1");
  sockets[0].emit("message", JSON.stringify({ m: "subscribe", s: true, reqId: "r1" }));
  await p1;

  key = "token-2";
  const p2 = client.subscribe("L1", { s: "GBPUSD" }, "r2");
  sockets[0].emit("message", JSON.stringify({ m: "subscribe", s: true, reqId: "r2" }));
  await p2;

  const sent = sockets[0].sent.map((f) => JSON.parse(f));
  assert.equal(sent[0].h["X-YB-API-Key"], "token-1");
  assert.equal(sent[1].h["X-YB-API-Key"], "token-2");
  client.disconnect();
});

test("subscribe recovers a missing api key via handleUnauthorized before sending", async () => {
  let key = "";
  let recoveries = 0;
  const provider = {
    getApiKey: () => key,
    getSigningSecret: () => "",
    handleUnauthorized: async () => {
      recoveries += 1;
      key = "recovered-token";
      return true;
    },
  };
  const sockets: FakeSocket[] = [];
  const factory = (_url: string) => {
    const s = new FakeSocket();
    sockets.push(s);
    return s as unknown as import("ws").WebSocket;
  };
  const client = new WsClient("https://ts.local", provider, factory);
  activeClients.push(client);
  const connecting = client.connect();
  sockets[0].emit("open");
  await connecting;

  const p = client.subscribe("L1", { s: "EURUSD" }, "r1");
  // The recovery await defers the send by a tick; let it land before acking.
  await new Promise((r) => setTimeout(r, 0));
  sockets[0].emit("message", JSON.stringify({ m: "subscribe", s: true, reqId: "r1" }));
  await p;

  assert.equal(recoveries, 1);
  assert.equal(JSON.parse(sockets[0].sent[0]).h["X-YB-API-Key"], "recovered-token");
  client.disconnect();
});

test("subscribe still sends the frame when handleUnauthorized throws", async () => {
  const provider = {
    getApiKey: () => "",
    getSigningSecret: () => "",
    handleUnauthorized: async () => {
      throw new Error("renewal exploded");
    },
  };
  const sockets: FakeSocket[] = [];
  const factory = (_url: string) => {
    const s = new FakeSocket();
    sockets.push(s);
    return s as unknown as import("ws").WebSocket;
  };
  const client = new WsClient("https://ts.local", provider, factory);
  activeClients.push(client);
  const connecting = client.connect();
  sockets[0].emit("open");
  await connecting;

  const p = client.subscribe("L1", { s: "EURUSD" }, "r1");
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(sockets[0].sent.length, 1, "the subscribe frame must still be sent");
  sockets[0].emit(
    "message",
    JSON.stringify({ m: "subscribe", s: false, reqId: "r1", e: { msg: "unauthorized" } }),
  );
  await assert.rejects(() => p, /unauthorized/i);
  client.disconnect();
});
