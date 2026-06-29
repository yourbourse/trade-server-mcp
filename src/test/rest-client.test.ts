import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { RestClient, ApiError } from "../rest-client.js";
import { StaticCredentials, CredentialsProvider, generateSignature } from "../auth/admin-auth.js";

type Captured = { url: string; method: string; headers: Record<string, string>; body?: string };
let captured: Captured[] = [];
// Responder by call index. May throw to simulate connection-level fetch failures.
let responder: (url: string, callIndex: number) => { status: number; body: string };

beforeEach(() => {
  captured = [];
  responder = () => ({ status: 200, body: "{}" });
  globalThis.fetch = (async (url: any, init: any) => {
    const callIndex = captured.length;
    captured.push({
      url: String(url),
      method: init?.method ?? "GET",
      headers: init?.headers ?? {},
      body: init?.body,
    });
    const r = responder(String(url), callIndex);
    return new Response(r.body, { status: r.status });
  }) as any;
});

/** Provider whose credentials flip from OLD/OLDSEC to NEW/NEWSEC when renewed. */
function renewingProvider() {
  let renewed = false;
  let reauthCalls = 0;
  const provider: CredentialsProvider = {
    getApiKey: () => (renewed ? "NEW" : "OLD"),
    getSigningSecret: () => (renewed ? "NEWSEC" : "OLDSEC"),
    handleUnauthorized: async () => {
      reauthCalls++;
      renewed = true;
      return true;
    },
  };
  return { provider, reauthCalls: () => reauthCalls };
}

test("GET sends API key header and hits /api/v1 path", async () => {
  const client = new RestClient("http://ts.local", new StaticCredentials("KEY", "SECRET"));
  await client.get("/account/balances");
  assert.equal(captured[0].url, "http://ts.local/api/v1/account/balances");
  assert.equal(captured[0].headers["X-YB-API-Key"], "KEY");
  assert.equal(captured[0].headers["X-YB-Timestamp"], undefined);
});

test("POST signs body with provider secret", async () => {
  const client = new RestClient("http://ts.local", new StaticCredentials("KEY", "SECRET"));
  await client.post("/positions", { symbolName: "EURUSD" });
  const h = captured[0].headers;
  assert.equal(h["X-YB-API-Key"], "KEY");
  assert.ok(h["X-YB-Timestamp"]);
  assert.ok(h["X-YB-Sign"]);
  assert.equal(captured[0].body, '{"symbolName":"EURUSD"}');
});

test("POST with undefined body sends NO body and signs the empty string", async () => {
  const client = new RestClient("http://ts.local", new StaticCredentials("KEY", "SECRET"));
  await client.post("/account/state");
  assert.equal(captured[0].body, undefined); // no payload bytes at all
  const h = captured[0].headers;
  assert.equal(h["X-YB-Sign"], generateSignature("SECRET", "", Number(h["X-YB-Timestamp"])));
});

test("empty API key omits the header (pre-auth /authorize case)", async () => {
  const client = new RestClient("http://ts.local", new StaticCredentials("", "pw"));
  await client.post("/authorize", { login: 1 });
  assert.equal(captured[0].headers["X-YB-API-Key"], undefined);
  assert.ok(captured[0].headers["X-YB-Sign"]);
});

test("POST 401 renew-retry re-signs with the RENEWED credentials", async () => {
  responder = (_url, i) =>
    i === 0 ? { status: 401, body: '{"title":"x"}' } : { status: 200, body: '{"ok":true}' };
  const { provider, reauthCalls } = renewingProvider();
  const client = new RestClient("http://ts.local", provider);
  const res = await client.post("/order", {});
  assert.deepEqual(res, { ok: true });
  assert.equal(reauthCalls(), 1);
  assert.equal(captured.length, 2);
  assert.equal(captured[0].headers["X-YB-API-Key"], "OLD");
  assert.equal(captured[1].headers["X-YB-API-Key"], "NEW");
  assert.notEqual(captured[1].headers["X-YB-Sign"], captured[0].headers["X-YB-Sign"]);
});

test("POST 401 with handleUnauthorized returning false throws the original ApiError, no retry", async () => {
  responder = () => ({ status: 401, body: '{"title":"x"}' });
  const provider: CredentialsProvider = {
    getApiKey: () => "K",
    getSigningSecret: () => "S",
    handleUnauthorized: async () => false,
  };
  const client = new RestClient("http://ts.local", provider);
  await assert.rejects(
    () => client.post("/order", {}),
    (err: unknown) => err instanceof ApiError && err.statusCode === 401,
  );
  assert.equal(captured.length, 1);
});

test("POST 401 with provider lacking handleUnauthorized throws ApiError, no retry", async () => {
  responder = () => ({ status: 401, body: '{"title":"x"}' });
  const client = new RestClient("http://ts.local", new StaticCredentials("K", "S"));
  await assert.rejects(
    () => client.post("/order", {}),
    (err: unknown) => err instanceof ApiError && err.statusCode === 401,
  );
  assert.equal(captured.length, 1);
});

test("POST 401 -> renew -> 401 again throws, handleUnauthorized called once, exactly 2 requests", async () => {
  responder = () => ({ status: 401, body: '{"title":"x"}' });
  const { provider, reauthCalls } = renewingProvider();
  const client = new RestClient("http://ts.local", provider);
  await assert.rejects(
    () => client.post("/order", {}),
    (err: unknown) => err instanceof ApiError && err.statusCode === 401,
  );
  assert.equal(reauthCalls(), 1);
  assert.equal(captured.length, 2);
});

test("GET 401 renew-retry resends with renewed API key", async () => {
  responder = (_url, i) =>
    i === 0 ? { status: 401, body: '{"title":"x"}' } : { status: 200, body: '{"ok":true}' };
  const { provider, reauthCalls } = renewingProvider();
  const client = new RestClient("http://ts.local", provider);
  const res = await client.get("/account/balances");
  assert.deepEqual(res, { ok: true });
  assert.equal(reauthCalls(), 1);
  assert.equal(captured.length, 2);
  assert.equal(captured[0].headers["X-YB-API-Key"], "OLD");
  assert.equal(captured[1].headers["X-YB-API-Key"], "NEW");
});

test("DELETE 401 renew-retry re-signs with the RENEWED credentials", async () => {
  responder = (_url, i) =>
    i === 0 ? { status: 401, body: '{"title":"x"}' } : { status: 200, body: '{"ok":true}' };
  const { provider, reauthCalls } = renewingProvider();
  const client = new RestClient("http://ts.local", provider);
  const res = await client.delete("/order/1", { id: 1 });
  assert.deepEqual(res, { ok: true });
  assert.equal(reauthCalls(), 1);
  assert.equal(captured.length, 2);
  assert.equal(captured[0].headers["X-YB-API-Key"], "OLD");
  assert.equal(captured[1].headers["X-YB-API-Key"], "NEW");
  assert.notEqual(captured[1].headers["X-YB-Sign"], captured[0].headers["X-YB-Sign"]);
});

test("POST compound failure: connection error, then 401, then renew -> success on third request", async () => {
  responder = (_url, i) => {
    if (i === 0) throw new TypeError("fetch failed");
    if (i === 1) return { status: 401, body: '{"title":"x"}' };
    return { status: 200, body: '{"ok":true}' };
  };
  const { provider, reauthCalls } = renewingProvider();
  const client = new RestClient("http://ts.local", provider);
  const res = await client.post("/order", {});
  assert.deepEqual(res, { ok: true });
  assert.equal(reauthCalls(), 1);
  assert.equal(captured.length, 3);
  assert.equal(captured[2].headers["X-YB-API-Key"], "NEW");
});

test("PUT signs body and hits the right URL", async () => {
  const client = new RestClient("http://ts.local", new StaticCredentials("KEY", "SECRET"));
  await client.put("/order", { id: 7, lp: 1.1 });
  assert.equal(captured[0].url, "http://ts.local/api/v1/order");
  assert.equal(captured[0].method, "PUT");
  assert.equal(captured[0].headers["X-YB-API-Key"], "KEY");
  assert.ok(captured[0].headers["X-YB-Timestamp"]);
  assert.ok(captured[0].headers["X-YB-Sign"]);
  assert.equal(captured[0].body, '{"id":7,"lp":1.1}');
});

test("PUT retries once on connection failure then succeeds", async () => {
  responder = (_url, i) => {
    if (i === 0) throw new TypeError("fetch failed");
    return { status: 200, body: '{"ok":true}' };
  };
  const client = new RestClient("http://ts.local", new StaticCredentials("K", "S"));
  const res = await client.put("/order", { id: 7 });
  assert.deepEqual(res, { ok: true });
  assert.equal(captured.length, 2);
});

test("a fired timeout maps to ApiError TIMEOUT / 408", async () => {
  globalThis.fetch = (async () => {
    throw Object.assign(new Error("The operation was aborted due to timeout"), {
      name: "TimeoutError",
    });
  }) as any;
  const client = new RestClient("http://ts.local", new StaticCredentials("K", "S"));
  await assert.rejects(
    () => client.get("/now"),
    (err: unknown) =>
      err instanceof ApiError && err.errorCode === "TIMEOUT" && err.statusCode === 408,
  );
});

test("an order-placement timeout is NOT retried (single fetch call)", async () => {
  let calls = 0;
  globalThis.fetch = (async () => {
    calls++;
    throw Object.assign(new Error("aborted"), { name: "TimeoutError" });
  }) as any;
  const client = new RestClient("http://ts.local", new StaticCredentials("K", "S"));
  await assert.rejects(
    () => client.post("/order", { x: 1 }, { retryOnConnectionError: false }),
    (err: unknown) => err instanceof ApiError && err.errorCode === "TIMEOUT",
  );
  assert.equal(calls, 1);
});

test("timeout error message reflects the configured timeout", async () => {
  globalThis.fetch = (async () => {
    throw Object.assign(new Error("aborted"), { name: "TimeoutError" });
  }) as any;
  const client = new RestClient("http://ts.local", new StaticCredentials("K", "S"), 2500);
  await assert.rejects(
    () => client.get("/now"),
    (err: unknown) => err instanceof ApiError && /2500ms/.test(err.detail),
  );
});

test("fetch is invoked with an AbortSignal (deadline wired)", async () => {
  let sawSignal: unknown;
  globalThis.fetch = (async (_url: any, init: any) => {
    sawSignal = init?.signal;
    return new Response("{}", { status: 200 });
  }) as any;
  const client = new RestClient("http://ts.local", new StaticCredentials("K", "S"));
  await client.get("/now");
  assert.ok(sawSignal instanceof AbortSignal);
});

// A timeout can fire AFTER headers arrive, while the body is being read
// (res.json()/res.text()) — that stage is outside fetchWithTimeout, so the
// per-method try/catch must still map it to the stable TIMEOUT ApiError.
function bodyTimeoutResponse() {
  const boom = () => {
    throw Object.assign(new Error("aborted"), { name: "TimeoutError" });
  };
  return {
    ok: true,
    status: 200,
    headers: { get: () => null },
    json: async () => boom(),
    text: async () => boom(),
  };
}

test("GET timeout during body read maps to ApiError TIMEOUT / 408", async () => {
  globalThis.fetch = (async () => bodyTimeoutResponse()) as any;
  const client = new RestClient("http://ts.local", new StaticCredentials("K", "S"));
  await assert.rejects(
    () => client.get("/now"),
    (err: unknown) =>
      err instanceof ApiError && err.errorCode === "TIMEOUT" && err.statusCode === 408,
  );
});

test("POST timeout during body read maps to TIMEOUT and is NOT retried", async () => {
  let calls = 0;
  globalThis.fetch = (async () => {
    calls++;
    return bodyTimeoutResponse();
  }) as any;
  const client = new RestClient("http://ts.local", new StaticCredentials("K", "S"));
  await assert.rejects(
    () => client.post("/order", { x: 1 }),
    (err: unknown) => err instanceof ApiError && err.errorCode === "TIMEOUT",
  );
  assert.equal(calls, 1);
});
