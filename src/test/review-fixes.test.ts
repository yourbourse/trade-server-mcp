import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { RestClient } from "../rest-client.js";
import { StaticCredentials } from "../auth/admin-auth.js";
import { ClientAuth } from "../auth/client-auth.js";
import * as cfg from "../tools/admin/config.js";

// Regression guards for the review findings on PR #48.

let captured: { url: string; method: string; body?: string; headers: Record<string, string> }[] =
  [];
let respond: (url: string) => unknown;
let etagFor: (url: string) => string | undefined;

beforeEach(() => {
  captured = [];
  respond = () => ({});
  etagFor = () => '"1"';
  globalThis.fetch = (async (url: any, init: any) => {
    const method = init?.method ?? "GET";
    captured.push({
      url: String(url),
      method,
      body: init?.body,
      headers: (init?.headers ?? {}) as Record<string, string>,
    });
    const tag = method === "GET" ? etagFor(String(url)) : undefined;
    return new Response(JSON.stringify(respond(String(url))), {
      status: 200,
      headers: tag ? { ETag: tag } : undefined,
    });
  }) as any;
});

const client = () => new RestClient("http://ts", new StaticCredentials("K", "S"));
const lastBody = () => JSON.parse(captured[captured.length - 1].body!);
const lastHeaders = () => captured[captured.length - 1].headers;

const ACCOUNT = {
  id: 1000,
  version: 3,
  groupId: 2,
  clientId: 2,
  leverage: 100,
  timeCreated: 111,
  timeModified: 222,
  timePasswordLastChanged: 333,
};

// ── Finding 6 ────────────────────────────────────────────────────────────────
test("timePasswordLastChanged is stripped before writing an account", async () => {
  respond = () => ACCOUNT;
  const plan = (await cfg.updateAccountPlan(client(), {
    accountId: 1000,
    updates: { leverage: 200 },
  })) as { commitToken: string };

  respond = () => ({ ok: true });
  await cfg.updateAccountCommit(client(), { commitToken: plan.commitToken });

  const sent = lastBody();
  assert.equal(sent.timePasswordLastChanged, undefined);
  assert.equal(sent.timeCreated, undefined);
  assert.equal(sent.timeModified, undefined);
  assert.equal(sent.leverage, 200); // the real change survives
});

// ── Finding 8 ────────────────────────────────────────────────────────────────
test("an update aimed at a read-only field is reported, not silently dropped", async () => {
  respond = () => ACCOUNT;
  const plan = (await cfg.updateAccountPlan(client(), {
    accountId: 1000,
    updates: { timeCreated: 12345 },
  })) as Record<string, unknown>;

  // it must NOT appear as an approved change...
  assert.equal((plan.changes as Record<string, unknown> | undefined)?.timeCreated, undefined);
  // ...and the caller must be told why
  assert.deepEqual(plan.ignoredReadOnlyFields, ["timeCreated"]);
  assert.equal(plan.commitToken, undefined); // nothing real to apply
});

test("the diff only lists fields that the write will actually carry", async () => {
  respond = () => ACCOUNT;
  const plan = (await cfg.updateAccountPlan(client(), {
    accountId: 1000,
    updates: { leverage: 200, timeModified: 999 },
  })) as Record<string, unknown>;

  assert.deepEqual(Object.keys(plan.changes as object), ["leverage"]);
  assert.deepEqual(plan.ignoredReadOnlyFields, ["timeModified"]);

  respond = () => ({ ok: true });
  await cfg.updateAccountCommit(client(), { commitToken: plan.commitToken as string });
  assert.equal(lastBody().timeModified, undefined);
});

// ── Finding 9 ────────────────────────────────────────────────────────────────
test("willCreate matches the posted payload, with secrets masked for display", async () => {
  respond = () => ACCOUNT;
  const plan = (await cfg.createAccountPlan(client(), {
    fromId: 1000,
    overrides: { password: "pw" },
  })) as { commitToken: string; willCreate: Record<string, unknown> };

  assert.equal(plan.willCreate.timeCreated, undefined);
  assert.equal(plan.willCreate.timePasswordLastChanged, undefined);
  assert.equal(plan.willCreate.id, 0);
  assert.equal(plan.willCreate.version, 0);
  // the plaintext initial password must never be echoed back in the preview...
  assert.ok(!JSON.stringify(plan).includes('pw"'));
  assert.match(String(plan.willCreate.password), /hidden/);

  respond = () => ({ ok: true });
  await cfg.createAccountCommit(client(), { commitToken: plan.commitToken });
  // ...while the posted payload carries the real value; everything else matches the preview
  assert.deepEqual(lastBody(), { ...plan.willCreate, password: "pw" });
});

// ── Finding 1 ────────────────────────────────────────────────────────────────
test("a commit never inherits a stale ETag left on the write path", async () => {
  const c = client();
  c.setEtag("/admin/symbols/edit", '"99"'); // left by an unrelated earlier write

  respond = () => ({ id: 1, version: 4, name: "EURUSD", bidMarkup: 0 });
  etagFor = () => undefined; // this read yields NO ETag
  const plan = (await cfg.updateSymbolPlan(c, {
    symbolId: 1,
    updates: { bidMarkup: 5 },
  })) as { commitToken: string };

  respond = () => ({ ok: true });
  await cfg.updateSymbolCommit(c, { commitToken: plan.commitToken });
  assert.equal(captured[captured.length - 1].url, "http://ts/api/v1/admin/symbols/edit");
  assert.equal(lastHeaders()["If-Match"], undefined); // the stale "99" must not leak
});

test("symbols and groups go through the shared helper (same ETag handling as the rest)", async () => {
  const c = client();
  respond = () => ({ id: 2, version: 1, name: "Real/X", defaultLeverage: 100 });
  etagFor = () => '"7"';
  const plan = (await cfg.updateGroupPlan(c, {
    groupId: 2,
    updates: { defaultLeverage: 200 },
  })) as { commitToken: string };

  respond = () => ({ ok: true });
  await cfg.updateGroupCommit(c, { commitToken: plan.commitToken });
  assert.equal(lastHeaders()["If-Match"], '"7"'); // ETag from the read, carried onto the write
});

// ── Finding 5 ────────────────────────────────────────────────────────────────
test("the plan pairs the version with its own response, not with the shared cache", async () => {
  const c = client();
  respond = () => ({ id: 2, version: 1, name: "Real/X", defaultLeverage: 100 });
  etagFor = () => '"11"';

  const plan = (await cfg.updateGroupPlan(c, {
    groupId: 2,
    updates: { defaultLeverage: 200 },
  })) as { commitToken: string };

  // a concurrent read of the same resource lands between plan and commit and moves the cache
  c.setEtag("/admin/groups/get/2", '"22"');

  respond = () => ({ ok: true });
  await cfg.updateGroupCommit(c, { commitToken: plan.commitToken });
  assert.equal(lastHeaders()["If-Match"], '"11"'); // still the version this plan actually read
});

// ── Finding 7 ────────────────────────────────────────────────────────────────
test("stop() prevents an in-flight renewal failure from scheduling another retry", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });

  let calls = 0;
  globalThis.fetch = (async () => {
    calls++;
    if (calls === 1) {
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
    return new Response("server error", { status: 500 }); // refresh and re-authorize both fail
  }) as any;

  const auth = new ClientAuth("http://ts.local", { login: 1, password: "pw" });
  await auth.authorize();

  t.mock.timers.tick(8_001); // renewal fires
  auth.stop(); // ...and the caller stops the client while it is still in flight
  for (let i = 0; i < 20; i++) await new Promise<void>((r) => setImmediate(r));

  const afterStop = calls;
  t.mock.timers.tick(300_000); // well past any backoff that might have been armed
  for (let i = 0; i < 20; i++) await new Promise<void>((r) => setImmediate(r));
  assert.equal(calls, afterStop, "stop() must not leave a retry loop running");
});
