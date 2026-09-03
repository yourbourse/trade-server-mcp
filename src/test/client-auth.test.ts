import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { ClientAuth } from "../auth/client-auth.js";
import { generateSignature } from "../auth/admin-auth.js";

let captured: { url: string; body: string; headers: Record<string, string> }[] = [];
let tokenCounter = 0;
let originalFetch: typeof globalThis.fetch;

beforeEach(() => {
  captured = [];
  tokenCounter = 0;
  originalFetch = globalThis.fetch;
  globalThis.fetch = (async (url: any, init: any) => {
    captured.push({ url: String(url), body: init?.body ?? "", headers: init?.headers ?? {} });
    tokenCounter++;
    return new Response(
      JSON.stringify({
        account: 1,
        token: `tok${tokenCounter}`,
        signingToken: `sig${tokenCounter}`,
        expiration: (Date.now() + 3600_000) * 1000,
      }),
      { status: 200 },
    );
  }) as any;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

test("authorize posts login signed with password and stores tokens", async () => {
  const auth = new ClientAuth("http://ts.local", { login: 100, password: "pw" });
  await auth.authorize();
  assert.equal(captured[0].url, "http://ts.local/api/v1/authorize");
  assert.equal(captured[0].body, '{"login":100}');
  assert.equal(captured[0].headers["X-YB-API-Key"], undefined); // no key before auth
  assert.ok(captured[0].headers["X-YB-Sign"]);
  assert.equal(auth.getApiKey(), "tok1");
  assert.equal(auth.getSigningSecret(), "sig1");
  // Pin actual HMAC value
  assert.equal(
    captured[0].headers["X-YB-Sign"],
    generateSignature("pw", '{"login":100}', Number(captured[0].headers["X-YB-Timestamp"])),
  );
  auth.stop();
});

test("broker field included when configured", async () => {
  const auth = new ClientAuth("http://ts.local", { login: 5, password: "pw", broker: "ACME Ltd" });
  await auth.authorize();
  assert.equal(captured[0].body, '{"login":5,"broker":"ACME Ltd"}');
  auth.stop();
});

test("handleUnauthorized re-authorizes once and reports retry", async () => {
  const auth = new ClientAuth("http://ts.local", { login: 1, password: "pw" });
  await auth.authorize();
  const retry = await auth.handleUnauthorized();
  assert.equal(retry, true);
  assert.equal(auth.getApiKey(), "tok2"); // new token after re-auth
  auth.stop();
});

test("getApiKey before authorize returns empty string", () => {
  const auth = new ClientAuth("http://ts.local", { login: 1, password: "pw" });
  assert.equal(auth.getApiKey(), "");
  auth.stop();
});

test("getSigningSecret before authorize returns empty string", () => {
  const auth = new ClientAuth("http://ts.local", { login: 1, password: "pw" });
  assert.equal(auth.getSigningSecret(), "");
  auth.stop();
});

test("refresh uses current token as API key and signingToken as secret", async () => {
  const auth = new ClientAuth("http://ts.local", { login: 1, password: "pw" });
  await auth.authorize();
  await auth.refresh();
  assert.equal(captured[1].url, "http://ts.local/api/v1/refresh");
  assert.equal(captured[1].headers["X-YB-API-Key"], "tok1");
  assert.equal(auth.getApiKey(), "tok2");
  assert.equal(auth.getSigningSecret(), "sig2");
  // Pin actual HMAC value for refresh
  assert.equal(
    captured[1].headers["X-YB-Sign"],
    generateSignature("sig1", "{}", Number(captured[1].headers["X-YB-Timestamp"])),
  );
  auth.stop();
});

test("malformed token response throws and keeps prior state", async () => {
  const auth = new ClientAuth("http://ts.local", { login: 1, password: "pw" });
  await auth.authorize();
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ account: 1, token: "x" }), { status: 200 })) as any;
  await assert.rejects(() => auth.refresh(), /Malformed/);
  assert.equal(auth.getApiKey(), "tok1"); // unchanged
  auth.stop();
});

test("failed authorize throws with status and server text, never the password", async () => {
  globalThis.fetch = (async () =>
    new Response('{"title":"Not found","detail":"Incorrect login or password","code":"1"}', {
      status: 401,
    })) as any;
  const auth = new ClientAuth("http://ts.local", { login: 1, password: "SuperSecret99" });
  await assert.rejects(
    () => auth.authorize(),
    (err: Error) => {
      assert.match(err.message, /401/);
      assert.ok(!err.message.includes("SuperSecret99"), "password must never appear in errors");
      return true;
    },
  );
  auth.stop();
});

test("handleUnauthorized returns false when authorize fails, getApiKey keeps prior value", async () => {
  const auth = new ClientAuth("http://ts.local", { login: 1, password: "pw" });
  // First authorize succeeds — gives us tok1
  await auth.authorize();
  assert.equal(auth.getApiKey(), "tok1");
  // Now make fetch fail with 401
  globalThis.fetch = (async () =>
    new Response('{"detail":"bad credentials"}', { status: 401 })) as any;
  const result = await auth.handleUnauthorized();
  assert.equal(result, false);
  assert.equal(auth.getApiKey(), "tok1"); // prior value kept
  auth.stop();
});

test("concurrent authorize calls join a single in-flight request", async () => {
  const auth = new ClientAuth("http://ts.local", { login: 1, password: "pw" });
  // Launch two authorize calls concurrently — only one fetch should happen
  await Promise.all([auth.authorize(), auth.authorize()]);
  assert.equal(captured.length, 1);
  assert.equal(auth.getApiKey(), "tok1");
  auth.stop();
});

test("authFailureHint returns null after successful authorize", async () => {
  const auth = new ClientAuth("http://ts.local", { login: 1, password: "pw" });
  await auth.authorize();
  assert.equal(auth.authFailureHint(), null);
  auth.stop();
});

test("authFailureHint returns credentials hint after a 401 authorize failure", async () => {
  globalThis.fetch = (async () =>
    new Response('{"detail":"bad credentials"}', { status: 401 })) as any;
  const auth = new ClientAuth("http://ts.local", { login: 1, password: "pw" });
  await assert.rejects(() => auth.authorize());
  assert.equal(
    auth.authFailureHint(),
    "Sign-in to the Trade Server failed: check YB_LOGIN and YB_PASSWORD.",
  );
  auth.stop();
});

test("authFailureHint explains an invalid-parameter rejection after a 400 failure (does not assert wrong-port as the cause)", async () => {
  globalThis.fetch = (async () =>
    new Response('{"title":"Invalid parameter","code":"3"}', { status: 400 })) as any;
  const auth = new ClientAuth("http://ts.local", { login: 1, password: "pw" });
  await assert.rejects(() => auth.authorize());
  const hint = auth.authFailureHint();
  assert.ok(hint);
  assert.match(hint!, /HTTP 400/);
  assert.match(hint!, /invalid request parameter|invalid parameter/i);
  assert.match(hint!, /optional fields/i);
  auth.stop();
});

test("authFailureHint returns connectivity hint when fetch rejects", async () => {
  globalThis.fetch = (async () => {
    throw new TypeError("fetch failed");
  }) as any;
  const auth = new ClientAuth("http://ts.local", { login: 1, password: "pw" });
  await assert.rejects(() => auth.authorize());
  assert.equal(
    auth.authFailureHint(),
    "Could not reach the Trade Server: check YB_BASE_URL and network connectivity.",
  );
  auth.stop();
});

test("refresh timer fires and falls back to authorize on refresh failure", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });

  const shortExpirationMs = Date.now() + 10_000; // 10s from now
  let callCount = 0;

  globalThis.fetch = (async (url: any, init: any) => {
    captured.push({ url: String(url), body: init?.body ?? "", headers: init?.headers ?? {} });
    callCount++;
    if (callCount === 1) {
      // First call: authorize succeeds with short expiration
      return new Response(
        JSON.stringify({
          account: 1,
          token: "tok1",
          signingToken: "sig1",
          expiration: shortExpirationMs * 1000, // microseconds
        }),
        { status: 200 },
      );
    } else if (callCount === 2) {
      // Second call: timer-driven refresh fails
      return new Response("server error", { status: 500 });
    } else {
      // Third call: fallback authorize succeeds
      return new Response(
        JSON.stringify({
          account: 1,
          token: "tok3",
          signingToken: "sig3",
          expiration: (Date.now() + 3600_000) * 1000,
        }),
        { status: 200 },
      );
    }
  }) as any;

  const auth = new ClientAuth("http://ts.local", { login: 1, password: "pw" });
  await auth.authorize();
  assert.equal(captured.length, 1);
  assert.ok(captured[0].url.endsWith("/authorize"));

  // delay = max(10_000 * 0.8, 5_000) = 8_000ms — tick past it
  t.mock.timers.tick(8_001);

  // Drain microtasks: the timer callback launches async work; we need to let it settle
  // Use multiple Promise.resolve() rounds to drain the microtask queue
  for (let i = 0; i < 20; i++) {
    await new Promise<void>((r) => setImmediate(r));
  }

  assert.equal(
    captured.length,
    3,
    `Expected 3 fetches, got ${captured.length}: ${captured.map((c) => c.url).join(", ")}`,
  );
  assert.ok(captured[0].url.endsWith("/authorize"), "first call should be /authorize");
  assert.ok(captured[1].url.endsWith("/refresh"), "second call should be /refresh");
  assert.ok(captured[2].url.endsWith("/authorize"), "third call should be fallback /authorize");

  auth.stop();
});

test("a failed refresh+authorize re-arms a backoff retry instead of giving up forever", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });

  let n = 0;
  globalThis.fetch = (async (url: any, init: any) => {
    captured.push({ url: String(url), body: init?.body ?? "", headers: init?.headers ?? {} });
    n++;
    if (n === 1) {
      // initial authorize: short 10s lifetime so the renewal fires quickly
      return new Response(
        JSON.stringify({
          account: 1,
          token: "tok1",
          signingToken: "sig1",
          expiration: (Date.now() + 10_000) * 1000,
        }),
        { status: 200 },
      );
    }
    if (n === 2 || n === 3) return new Response("server error", { status: 500 }); // refresh + fallback authorize both fail
    // retry cycle: refresh succeeds and the session recovers
    return new Response(
      JSON.stringify({
        account: 1,
        token: "tok4",
        signingToken: "sig4",
        expiration: (Date.now() + 3600_000) * 1000,
      }),
      { status: 200 },
    );
  }) as any;

  const drain = async () => {
    for (let i = 0; i < 20; i++) await new Promise<void>((r) => setImmediate(r));
  };

  const auth = new ClientAuth("http://ts.local", { login: 1, password: "pw" });
  await auth.authorize();

  // delay = max(10_000 * 0.8, 5_000) = 8_000ms — fire the scheduled renewal
  t.mock.timers.tick(8_001);
  await drain();
  assert.equal(captured.length, 3, "refresh + fallback authorize both attempted");
  assert.equal(auth.getApiKey(), "tok1", "token unchanged while both attempts failed");

  // The old code stopped here (session dead forever). Now a backoff retry (RETRY_MIN=30s) is armed.
  t.mock.timers.tick(30_000);
  await drain();
  assert.equal(captured.length, 4, "retry cycle ran instead of giving up");
  assert.equal(auth.getApiKey(), "tok4", "session recovered on retry");

  auth.stop();
});
