import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { WsClient } from "../ws-client.js";

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

const CONFIG = { apiKey: "K", secretKey: "S", baseUrl: "https://ts.local" };

function makeClient() {
  const sockets: FakeSocket[] = [];
  const factory = (_url: string) => {
    const s = new FakeSocket();
    sockets.push(s);
    return s as unknown as import("ws").WebSocket;
  };
  const client = new WsClient(CONFIG, factory);
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
  const client = new WsClient(
    { apiKey: "K", secretKey: "S", baseUrl: "HTTPS://ts.local" },
    factory,
  );
  activeClients.push(client);
  client.connect().catch(() => {}); // never opens in this test; the URL is derived synchronously
  assert.match(capturedUrl, /^wss:\/\/ts\.local\/ws\/v1$/);
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
