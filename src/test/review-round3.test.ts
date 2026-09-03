import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { RestClient } from "../rest-client.js";
import { StaticCredentials } from "../auth/admin-auth.js";
import { PAGE_SIZE, queryAllPages } from "../tools/admin/paging.js";
import * as trd from "../tools/admin/trading.js";
import * as acct from "../tools/admin/account.js";
import * as cfg from "../tools/admin/config.js";
import * as bulk from "../tools/admin/bulk.js";

// Regression guards for the third review round (@susco-yb + @mohsen007-yb on PR #48).

let captured: {
  url: string;
  method: string;
  body?: string;
  headers: Record<string, string>;
  opts?: unknown;
}[] = [];
let respond: (url: string, body?: string) => unknown;
let status: (url: string) => number;

beforeEach(() => {
  captured = [];
  respond = () => ({});
  status = () => 200;
  globalThis.fetch = (async (url: any, init: any) => {
    const method = init?.method ?? "GET";
    captured.push({
      url: String(url),
      method,
      body: init?.body,
      headers: (init?.headers ?? {}) as Record<string, string>,
    });
    const code = status(String(url));
    if (code >= 400) return new Response("error", { status: code });
    return new Response(JSON.stringify(respond(String(url), init?.body)), {
      status: 200,
      headers: method === "GET" ? { ETag: '"1"' } : undefined,
    });
  }) as any;
});

const client = () => new RestClient("http://ts", new StaticCredentials("K", "S"));
const bodyOf = (i: number) => JSON.parse(captured[i].body!);
const urls = () => captured.map((c) => c.url);

// ── pagination: the cursor lives in the query string, for POST endpoints too ──────────────────

test("queryAllPages follows nextToken through the query string and returns every row", async () => {
  // Live contract: `nextToken` in a POST BODY is silently ignored and the same page comes back
  // forever — the accidental infinite loop this helper exists to avoid.
  const pages: Record<string, unknown> = {
    "": { rows: [{ id: 1 }, { id: 2 }], nextToken: "t1" },
    t1: { rows: [{ id: 3 }], nextToken: "t2" },
    t2: { rows: [], nextToken: "t2" }, // a token can come back on the last page too
  };
  respond = (url) => pages[new URL(url).searchParams.get("nextToken") ?? ""];

  const rows = await queryAllPages(client(), {
    path: "/admin/things/query",
    method: "POST",
    body: { accountFilter: { accounts: [7] } },
    collectionKey: "rows",
  });
  assert.deepEqual(
    rows.map((r) => r.id),
    [1, 2, 3],
  );
  assert.equal(captured.length, 3);
  assert.ok(captured[1].url.includes("nextToken=t1"), "cursor must go in the query string");
  assert.deepEqual(bodyOf(0), { accountFilter: { accounts: [7] }, maxResults: PAGE_SIZE });
});

test("queryAllPages refuses to return a partial collection when the cursor does not advance", async () => {
  respond = () => ({ rows: [{ id: 1 }], nextToken: "stuck" }); // same token, non-empty page
  await assert.rejects(
    () =>
      queryAllPages(client(), {
        path: "/admin/things/query",
        method: "POST",
        collectionKey: "rows",
      }),
    /did not advance/,
  );
});

test("close_all_positions closes the whole book, not just the first page", async () => {
  const pages: Record<string, unknown> = {
    "": { positions: [{ id: 1, A: 7, s: "EURUSD", S: "buy", q: 1 }], nextToken: "p2" },
    p2: { positions: [{ id: 2, A: 7, s: "GBPUSD", S: "sell", q: 2 }] },
  };
  respond = (url) =>
    url.includes("/positions/query") ? pages[new URL(url).searchParams.get("nextToken") ?? ""] : {};

  const res = (await trd.closeAllPositions(client(), { accountId: 7 })) as { closed: number };
  assert.equal(res.closed, 2, "a position on page 2 must not survive a close-all");
  assert.equal(captured.filter((c) => c.url.includes("/orders/edit")).length, 2);
});

test("bulk selection walks every page and reports ids the server does not have", async () => {
  const pages: Record<string, unknown> = {
    "": { symbols: [{ id: 1, version: 1, name: "EURUSD", bidMarkup: 0 }], nextToken: "s2" },
    s2: { symbols: [{ id: 2, version: 1, name: "EURGBP", bidMarkup: 0 }] },
  };
  respond = (url) => pages[new URL(url).searchParams.get("nextToken") ?? ""];

  const plan = (await bulk.bulkUpdatePlan(client(), {
    resource: "symbols",
    ids: [1, 2, 999],
    updates: { bidMarkup: 5 },
  })) as Record<string, unknown>;

  assert.equal(plan.willChange, 2, "the record on page 2 must be selectable");
  assert.deepEqual(plan.missingIds, [999]);
  assert.equal(plan.requested, 3);
});

// ── ownership: an account parameter must actually lock the target ─────────────────────────────

test("fetchRecord rejects a record that belongs to a different account (get-by-id path)", async () => {
  respond = () => ({ id: 5, A: 999, q: 1 }); // the documented route answers with a foreign record
  await assert.rejects(
    () => trd.getPosition(client(), { positionId: 5, accountId: 7 }),
    /belongs to account 999, not 7/,
  );
});

test("fetchRecord rejects a foreign record on the query fallback too", async () => {
  status = (url) => (url.includes("/positions/get/") ? 502 : 200);
  respond = () => ({ positions: [{ id: 5, A: 999, q: 1 }] });
  await assert.rejects(
    () => trd.getPosition(client(), { positionId: 5, accountId: 7 }),
    /belongs to account 999, not 7/,
  );
});

test("a refused get-by-id surfaces as itself instead of a confusing 'not found'", async () => {
  status = (url) => (url.includes("/positions/get/") ? 401 : 200);
  respond = () => ({ positions: [] });
  await assert.rejects(() => trd.getPosition(client(), { positionId: 5 }), /UNAUTHORIZED/);
  assert.equal(
    captured.filter((c) => c.url.includes("/positions/query")).length,
    0,
    "a 401 must not send us looking somewhere else",
  );
});

test("get_account_summary returns only the named account's rows", async () => {
  respond = (url) => {
    if (url.includes("/positions/query")) return { positions: [{ id: 1, A: 999 }] };
    if (url.includes("/orders/active")) return { orders: [{ id: 2, A: 999 }] };
    return { accountStates: [{ A: 999 }] };
  };
  const s = (await trd.getAccountSummary(client(), { accountId: 7 })) as {
    positions: { positions: unknown[] };
    orders: { orders: unknown[] };
    state: { accountStates: unknown[] };
  };
  assert.deepEqual(s.positions.positions, []);
  assert.deepEqual(s.orders.orders, []);
  assert.deepEqual(s.state.accountStates, []);
  // The wire key is accountStates — reading the wrong key would silently drop the state.
  assert.ok(captured.some((c) => c.url.includes("/accounts/states/query")));
});

test("a book row with no account field fails loudly rather than filtering the book away", async () => {
  respond = () => ({ positions: [{ id: 1, s: "EURUSD", S: "buy", q: 1 }] }); // no `A`
  await assert.rejects(
    () => trd.closeAllPositions(client(), { accountId: 7 }),
    /without an account field/,
  );
});

// ── money and orders: no transport retry on non-idempotent writes ─────────────────────────────

test("cash_transfer does not transport-retry (a reset must not deposit twice)", async () => {
  let attempts = 0;
  globalThis.fetch = (async () => {
    attempts++;
    throw new TypeError("fetch failed");
  }) as any;
  await assert.rejects(() =>
    acct.cashTransfer(client(), { accountId: 7, amount: 100, type: "Balance", currency: "USD" }),
  );
  assert.equal(attempts, 1, "the transfer body must be sent at most once");
});

test("cancel_all_orders does not transport-retry its deletes", async () => {
  let deletes = 0;
  globalThis.fetch = (async (url: any) => {
    const u = String(url);
    if (u.includes("/orders/delete")) {
      deletes++;
      throw new TypeError("fetch failed");
    }
    return new Response(JSON.stringify({ orders: [{ id: 1, A: 7, s: "EURUSD", st: "Working" }] }), {
      status: 200,
    });
  }) as any;
  await trd.cancelAllOrders(client(), { accountId: 7 });
  assert.equal(deletes, 1);
});

// ── routing writes are confirm-before-execute ────────────────────────────────────────────────

test("routing changes are previewed and only written on commit, carrying the plan's ETag", async () => {
  respond = () => ({ version: 5, routing: [{ a: [{ type: "Execute" }] }] });

  const c = client();
  const plan = (await cfg.addRoutingRulePlan(c, { actions: [{ type: "Reject" }] })) as {
    commitToken: string;
    rulesBefore: number;
    rulesAfter: number;
  };
  assert.equal(plan.rulesBefore, 1);
  assert.equal(plan.rulesAfter, 2);
  assert.equal(
    captured.filter((x) => x.url.endsWith("/admin/routing/edit")).length,
    0,
    "the plan must not write",
  );

  captured = [];
  respond = () => ({ ok: true });
  await cfg.addRoutingRuleCommit(c, { commitToken: plan.commitToken });
  assert.equal(captured[0].url, "http://ts/api/v1/admin/routing/edit");
  assert.equal(captured[0].headers["If-Match"], '"1"'); // bridged from the plan's own read
  assert.equal(bodyOf(0).routing.length, 2);
});

test("remove_routing_rule previews the rule it would drop and needs a commit", async () => {
  respond = () => ({ version: 5, routing: [{ a: [{ type: "A" }] }, { a: [{ type: "B" }] }] });
  const c = client();
  const plan = (await cfg.removeRoutingRulePlan(c, { index: 1 })) as {
    commitToken: string;
    removing: { a: Array<{ type: string }> };
  };
  assert.equal(plan.removing.a[0].type, "B");
  assert.equal(captured.filter((x) => x.url.endsWith("/routing/edit")).length, 0);

  captured = [];
  respond = () => ({ ok: true });
  await cfg.removeRoutingRuleCommit(c, { commitToken: plan.commitToken });
  assert.equal(bodyOf(0).routing.length, 1);
});

test("cancel_all_orders is previewed before it wipes an account's working orders", async () => {
  respond = () => ({ orders: [{ id: 1, A: 7, s: "EURUSD", st: "Working" }] });
  const plan = (await trd.cancelAllOrdersPlan(client(), { accountId: 7 })) as {
    commitToken: string;
    willCancel: number;
  };
  assert.equal(plan.willCancel, 1);
  assert.equal(
    captured.filter((x) => x.url.includes("/orders/delete")).length,
    0,
    "the plan must not cancel anything",
  );

  captured = [];
  await trd.cancelAllOrdersCommit(client(), { commitToken: plan.commitToken });
  assert.ok(urls().some((u) => u.includes("/orders/delete")));
});

// ── create_manager goes through the same hygiene as the other six creates ─────────────────────

test("create_manager strips server-managed fields and never echoes a secret", async () => {
  respond = () => ({
    accountId: 1,
    version: 3,
    groups: "*",
    viewSymbols: true,
    password: "s3cret",
    timeCreated: 111,
    timeModified: 222,
  });
  const plan = (await cfg.createManagerPlan(client(), { accountId: 500, fromId: 1 })) as {
    commitToken: string;
    willCreate: Record<string, unknown>;
  };
  assert.equal(plan.willCreate.timeCreated, undefined);
  assert.equal(plan.willCreate.timeModified, undefined);
  assert.ok(!JSON.stringify(plan).includes("s3cret"));

  captured = [];
  respond = () => ({ ok: true });
  await cfg.createManagerCommit(client(), { commitToken: plan.commitToken });
  assert.equal(bodyOf(0).timeCreated, undefined);
  assert.equal(bodyOf(0).accountId, 500);
  assert.equal(bodyOf(0).version, 0);
});

test("the account state for the named account survives the ownership filter", async () => {
  respond = (url) => {
    if (url.includes("/positions/query")) return { positions: [] };
    if (url.includes("/orders/active")) return { orders: [] };
    return { accountStates: [{ A: 7, b: 100000 }] };
  };
  const s = (await trd.getAccountSummary(client(), { accountId: 7 })) as unknown as {
    state: { accountStates: Array<{ b: number }> };
  };
  assert.equal(s.state.accountStates.length, 1);
  assert.equal(s.state.accountStates[0].b, 100000);
});
