import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { RestClient } from "../rest-client.js";
import { StaticCredentials } from "../auth/admin-auth.js";
import * as trd from "../tools/admin/trading.js";
import * as cfg from "../tools/admin/config.js";
import * as bulk from "../tools/admin/bulk.js";

// Regression guards for the second review round (full-branch multi-agent review).

let captured: { url: string; method: string; body?: string; headers: Record<string, string> }[] =
  [];
let respond: (url: string) => unknown;

beforeEach(() => {
  captured = [];
  respond = () => ({});
  globalThis.fetch = (async (url: any, init: any) => {
    const method = init?.method ?? "GET";
    captured.push({
      url: String(url),
      method,
      body: init?.body,
      headers: (init?.headers ?? {}) as Record<string, string>,
    });
    return new Response(JSON.stringify(respond(String(url))), {
      status: 200,
      headers: method === "GET" ? { ETag: '"1"' } : undefined,
    });
  }) as any;
});

const client = () => new RestClient("http://ts", new StaticCredentials("K", "S"));
const call = (i: number) => captured[i];
const bodyOf = (i: number) => JSON.parse(captured[i].body!);

// ── action tools must scope with accountFilter and never act on foreign records ──────────────

test("close/cancel action tools query with accountFilter, not the ignored bare A", async () => {
  const c = client();
  respond = () => ({ positions: [], orders: [] });

  await trd.closeAllPositions(c, { accountId: 7 });
  assert.deepEqual(bodyOf(0).accountFilter, { accounts: [7] });
  assert.equal(bodyOf(0).A, undefined);

  captured = [];
  await trd.cancelAllOrders(c, { accountId: 7 });
  assert.deepEqual(bodyOf(0).accountFilter, { accounts: [7] });

  captured = [];
  await trd.getAccountSummary(c, { accountId: 7 });
  for (const idx of [0, 1, 2]) {
    assert.deepEqual(bodyOf(idx).accountFilter, { accounts: [7] }, call(idx).url);
    assert.equal(bodyOf(idx).A, undefined, call(idx).url);
  }
});

test("close_all_positions never fires an order for another account's position", async () => {
  // Even if the server ignores the filter and returns a foreign position, ownership is
  // re-checked client-side before any closing order is placed.
  respond = (url) =>
    url.includes("/positions/query")
      ? { positions: [{ id: 900, A: 999, s: "EURUSD", S: "buy", q: 0.5 }] }
      : { ok: true };
  const res = (await trd.closeAllPositions(client(), { accountId: 7 })) as { closed: number };
  assert.equal(res.closed, 0);
  assert.equal(
    captured.filter((x) => x.url.includes("/orders/edit")).length,
    0,
    "no closing order may be sent for a foreign position",
  );
});

test("cancel_all_orders never deletes another account's order", async () => {
  respond = (url) =>
    url.includes("/orders/active")
      ? { orders: [{ id: 900, A: 999, s: "EURUSD", st: "Working" }] }
      : { ok: true };
  await trd.cancelAllOrders(client(), { accountId: 7 });
  assert.equal(captured.filter((x) => x.url.includes("/orders/delete")).length, 0);
});

test("close_position and close_by refuse a position that belongs to a different account", async () => {
  respond = () => ({ positions: [{ id: 5, A: 999, s: "EURUSD", S: "buy", q: 0.1 }] });
  await assert.rejects(
    () => trd.closePosition(client(), { accountId: 7, positionId: 5 }),
    /not found on account 7/,
  );
  await assert.rejects(
    () => trd.closeBy(client(), { accountId: 7, positionId: 5, positionById: 6 }),
    /not found on account 7/,
  );
});

// ── endpoint-mapping tests the first round missed ────────────────────────────────────────────

test("create plan/commit pairs map to POST /admin/<res>/edit with id/version 0 and no If-Match", async () => {
  const CREATES: Array<{
    plan: (c: RestClient, p: any) => Promise<unknown>;
    commit: (c: RestClient, p: { commitToken: string }) => Promise<unknown>;
    fromPath: string;
    editPath: string;
    template: Record<string, unknown>;
  }> = [
    {
      plan: cfg.createGroupPlan,
      commit: cfg.createGroupCommit,
      fromPath: "http://ts/api/v1/admin/groups/get/2",
      editPath: "http://ts/api/v1/admin/groups/edit",
      template: { id: 2, version: 1, name: "Real/X", currency: "USD" },
    },
    {
      plan: cfg.createHolidayPlan,
      commit: cfg.createHolidayCommit,
      fromPath: "http://ts/api/v1/admin/holidays/get/2",
      editPath: "http://ts/api/v1/admin/holidays/edit",
      template: { id: 2, version: 1, description: "Xmas", month: 12, day: 25 },
    },
    {
      plan: cfg.createClientPlan,
      commit: cfg.createClientCommit,
      fromPath: "http://ts/api/v1/admin/clients/get/2",
      editPath: "http://ts/api/v1/admin/clients/edit",
      template: { id: 2, version: 1, clientType: "Individual" },
    },
    {
      plan: cfg.createLiquidityConnectorPlan,
      commit: cfg.createLiquidityConnectorCommit,
      fromPath: "http://ts/api/v1/admin/liquidity/get/2",
      editPath: "http://ts/api/v1/admin/liquidity/edit",
      template: { id: 2, version: 1, type: "YB-FIX-QUOTES", priority: 1 },
    },
  ];
  for (const t of CREATES) {
    captured = [];
    respond = () => t.template;
    const plan = (await t.plan(client(), { fromId: 2 })) as { commitToken: string };
    assert.equal(call(0).url, t.fromPath);

    captured = [];
    respond = () => ({ ok: true });
    await t.commit(client(), { commitToken: plan.commitToken });
    assert.equal(call(0).url, t.editPath);
    assert.equal(call(0).method, "POST");
    assert.equal(call(0).headers["If-Match"], undefined, t.editPath);
    const sent = bodyOf(0);
    assert.equal(sent.id, 0, t.editPath);
    assert.equal(sent.version, 0, t.editPath);
  }
});

test("uncovered read tools map to their documented endpoints", async () => {
  const READS: Array<[() => Promise<unknown>, string, string, string | undefined]> = [
    [() => cfg.getClient(client(), { clientId: 5 }), "GET", "/admin/clients/get/5", undefined],
    [() => cfg.getHoliday(client(), { holidayId: 5 }), "GET", "/admin/holidays/get/5", undefined],
    [
      () => cfg.getLiquidityConnector(client(), { connectorId: 9 }),
      "GET",
      "/admin/liquidity/get/9",
      undefined,
    ],
    [() => cfg.getManagers(client()), "GET", "/admin/managers/query", undefined],
    [() => cfg.getManager(client(), { accountId: 2 }), "GET", "/admin/managers/get/2", undefined],
    [() => cfg.getManagerSelf(client()), "GET", "/admin/managers/self", undefined],
    [() => cfg.getTokens(client()), "POST", "/admin/tokens/query", "{}"],
  ];
  for (const [run, method, path, body] of READS) {
    captured = [];
    await run();
    assert.equal(call(0).url, `http://ts/api/v1${path}`);
    assert.equal(call(0).method, method, path);
    if (body !== undefined) assert.equal(call(0).body, body, path);
  }
});

// ── secrets are masked in previews, everywhere ───────────────────────────────────────────────

test("a password reset cannot be smuggled through the generic account update", async () => {
  // set_account_password_* owns this write so the reset carries its own lock-out disclosure.
  respond = () => ({ id: 1000, version: 3, groupId: 2, clientId: 2, leverage: 100 });
  await assert.rejects(
    () =>
      cfg.updateAccountPlan(client(), { accountId: 1000, updates: { password: "TopSecret1!" } }),
    /set_account_password_plan/,
  );
  assert.equal(
    captured.filter((x) => x.method === "POST").length,
    0,
    "nothing may be written on a rejected update",
  );
});

test("a bulk update cannot reset account passwords", async () => {
  respond = () => ({ accounts: [{ id: 1000, version: 1, leverage: 100 }] });
  await assert.rejects(
    () =>
      bulk.bulkUpdatePlan(client(), {
        resource: "accounts",
        ids: [1000],
        updates: { password: "TopSecret1!" },
      }),
    /set_account_password_plan/,
  );
});

test("a legitimate account update is unaffected and still masks secrets it carries", async () => {
  respond = () => ({ id: 1000, version: 3, groupId: 2, clientId: 2, leverage: 100 });
  const plan = (await cfg.updateAccountPlan(client(), {
    accountId: 1000,
    updates: { leverage: 200 },
  })) as { commitToken: string; changes: Record<string, { to: unknown }> };
  assert.equal(plan.changes.leverage.to, 200);

  captured = [];
  respond = () => ({ ok: true });
  await cfg.updateAccountCommit(client(), { commitToken: plan.commitToken });
  assert.equal(bodyOf(0).leverage, 200);
});

// ── bulk correctness ─────────────────────────────────────────────────────────────────────────

test("bulk_update drops server-managed keys before change detection and reports them", async () => {
  respond = () => ({ accounts: [{ id: 1000, version: 1, leverage: 100, timeCreated: 5 }] });
  const noop = (await bulk.bulkUpdatePlan(client(), {
    resource: "accounts",
    ids: [1000],
    updates: { timeCreated: 999 }, // read-only: must select nothing
  })) as Record<string, unknown>;
  assert.equal(noop.willChange, 0);
  assert.deepEqual(noop.ignoredReadOnlyFields, ["timeCreated"]);
  assert.equal(noop.commitToken, undefined);

  const mixed = (await bulk.bulkUpdatePlan(client(), {
    resource: "accounts",
    ids: [1000],
    updates: { leverage: 100, timeCreated: 999 }, // leverage already matches → still nothing
  })) as Record<string, unknown>;
  assert.equal(mixed.willChange, 0);
  assert.deepEqual(mixed.ignoredReadOnlyFields, ["timeCreated"]);
});

test("bulk_update refuses to post a manager record whose required groups field is missing", async () => {
  respond = () => ({ managers: [{ accountId: 7, version: 1, viewSymbols: false }] }); // no groups
  await assert.rejects(
    () =>
      bulk.bulkUpdatePlan(client(), {
        resource: "managers",
        ids: [7],
        updates: { viewSymbols: true },
      }),
    /groups/,
  );
});

// ── creates merge template AND object, as the descriptions promise ──────────────────────────

test("create merges fromId template with an explicit object (and/or, overrides win)", async () => {
  respond = () => ({ id: 2, version: 4, name: "Real/X", currency: "USD", defaultLeverage: 100 });
  const plan = (await cfg.createGroupPlan(client(), {
    fromId: 2,
    object: { currency: "EUR", marginCall: 50 },
    overrides: { name: "Real/Y" },
  })) as { willCreate: Record<string, unknown> };
  assert.equal(plan.willCreate.defaultLeverage, 100); // from the template
  assert.equal(plan.willCreate.currency, "EUR"); // object overlays template
  assert.equal(plan.willCreate.marginCall, 50); // object-only field survives
  assert.equal(plan.willCreate.name, "Real/Y"); // overrides win last
});

// ── commits never transport-retry ────────────────────────────────────────────────────────────

test("a resource commit is not retried on a connection reset (no duplicate create)", async () => {
  respond = () => ({ id: 2, version: 1, name: "Real/X" });
  const plan = (await cfg.createGroupPlan(client(), { fromId: 2 })) as { commitToken: string };

  let writes = 0;
  globalThis.fetch = (async (url: any) => {
    if (String(url).includes("/groups/edit")) {
      writes++;
      throw new TypeError("fetch failed");
    }
    return new Response("{}", { status: 200 });
  }) as any;
  await assert.rejects(() => cfg.createGroupCommit(client(), { commitToken: plan.commitToken }));
  assert.equal(writes, 1, "a reset does not prove non-delivery; the create must not be re-sent");
});

// ── the fallback lookup's not-found hint reflects the account that was searched ─────────────

test("fetchRecord's not-found message names the account when one was supplied", async () => {
  globalThis.fetch = (async (url: any) => {
    if (String(url).includes("/trades/get/")) return new Response("Bad Gateway", { status: 502 });
    return new Response(JSON.stringify({ trades: [] }), { status: 200 });
  }) as any;
  await assert.rejects(
    () => trd.getTrade(client(), { tradeId: 42, accountId: 7 }),
    /for account 7/,
  );
});

// ── set_order_routing: the caller's version is a real conflict check now ─────────────────────

test("set_order_routing fails loudly when the config moved since the caller read it", async () => {
  respond = () => ({ version: 9, routing: [] }); // server is ahead of the caller's version 5
  await assert.rejects(
    () => cfg.setOrderRoutingPlan(client(), { version: 5, routing: [] }),
    /version 5.*server is at 9/s,
  );
  assert.equal(
    captured.filter((x) => x.url.endsWith("/admin/routing/edit")).length,
    0,
    "no write may happen on a version conflict",
  );
});

// ── no-ETag endpoints clear anything cached on their path ────────────────────────────────────

test("book and candle commits strip a stale cached ETag from their write path", async () => {
  const c = client();
  c.setEtag("/admin/positions/edit", '"7"'); // leftover from some earlier response
  respond = () => ({ id: 5, A: 2, s: "EURUSD", S: "buy", q: 0.1, sw: 0 });
  const plan = (await trd.updatePositionPlan(c, { positionId: 5, swaps: -1 })) as {
    commitToken: string;
  };
  captured = [];
  respond = () => ({ ok: true });
  await trd.updatePositionCommit(c, { commitToken: plan.commitToken });
  assert.equal(call(0).url, "http://ts/api/v1/admin/positions/edit");
  assert.equal(call(0).headers["If-Match"], undefined);
});
