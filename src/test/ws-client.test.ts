import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { WsClient } from "../ws-client.js";

// Minimal controllable WebSocket double: records sent frames, lets the test
// emit "open"/"close"/"message". close() emits "close" like the real socket.
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
  return { client: new WsClient(CONFIG, factory), sockets };
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
