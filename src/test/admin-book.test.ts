import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { RestClient } from "../rest-client.js";
import { PAGE_SIZE } from "../tools/admin/paging.js";
import { StaticCredentials } from "../auth/admin-auth.js";
import * as trd from "../tools/admin/trading.js";
import * as cfg from "../tools/admin/config.js";

let captured: { url: string; method: string; body?: string; headers: Record<string, string> }[] =
  [];
let respond: () => unknown;

beforeEach(() => {
  captured = [];
  respond = () => ({});
  globalThis.fetch = (async (url: any, init: any) => {
    captured.push({
      url: String(url),
      method: init?.method ?? "GET",
      body: init?.body,
      headers: (init?.headers ?? {}) as Record<string, string>,
    });
    const headers = (init?.method ?? "GET") === "GET" ? { ETag: '"1"' } : undefined;
    return new Response(JSON.stringify(respond()), { status: 200, headers });
  }) as any;
});

const client = () => new RestClient("http://ts", new StaticCredentials("K", "S"));
const B = () => JSON.parse(captured[0].body!);

// A position as /admin/positions/get/{id} returns it (terse wire keys).
const POSITION = {
  id: 476797305095829,
  A: 2,
  s: "EURUSD",
  S: "buy",
  q: 0.01,
  p: 1.14261,
  pl: 10.66,
  sw: -6.75,
  c: 0,
  f: 0,
};
const TRADE = { id: 999, A: 2, s: "EURUSD", q: 0.02, p: 1.2, pl: 5, sw: 0, c: 0, f: 0 };

test("get_position and get_trade read their single-record endpoints", async () => {
  respond = () => POSITION;
  await trd.getPosition(client(), { positionId: 5 });
  assert.equal(captured[0].url, "http://ts/api/v1/admin/positions/get/5");
  assert.equal(captured[0].method, "GET");

  captured = [];
  await trd.getTrade(client(), { tradeId: 7 });
  assert.equal(captured[0].url, "http://ts/api/v1/admin/trades/get/7");
  assert.equal(captured[0].method, "GET");
});

test("update_position sends a SPARSE body — id, account and only the changed fields", async () => {
  respond = () => POSITION;
  const plan = (await trd.updatePositionPlan(client(), { positionId: 1, swaps: -7.5 })) as {
    commitToken: string;
    changes: Record<string, { from: unknown; to: unknown }>;
  };
  assert.deepEqual(Object.keys(plan.changes), ["swaps"]);
  assert.deepEqual(plan.changes.swaps, { from: -6.75, to: -7.5 });

  captured = [];
  await trd.updatePositionCommit(client(), { commitToken: plan.commitToken });
  assert.equal(captured[0].url, "http://ts/api/v1/admin/positions/edit");
  assert.equal(captured[0].method, "POST");
  // wire keys, account carried from the record, untouched fields NOT resent
  assert.deepEqual(B(), { id: POSITION.id, A: 2, sw: -7.5 });
  assert.equal(captured[0].headers["If-Match"], undefined); // no ETag concurrency on this endpoint
});

test("update_position reports noChanges and issues no token when nothing differs", async () => {
  respond = () => POSITION;
  const plan = (await trd.updatePositionPlan(client(), {
    positionId: 1,
    swaps: -6.75, // same as current
  })) as { noChanges?: boolean; commitToken?: string };
  assert.equal(plan.noChanges, true);
  assert.equal(plan.commitToken, undefined);
});

test("delete_position previews the target and commits { id, A }", async () => {
  respond = () => POSITION;
  const plan = (await trd.deletePositionPlan(client(), { positionId: 1 })) as {
    commitToken: string;
    willDelete: Record<string, unknown>;
  };
  assert.equal(plan.willDelete.symbol, "EURUSD");
  assert.equal(plan.willDelete.account, 2);

  captured = [];
  await trd.deletePositionCommit(client(), { commitToken: plan.commitToken });
  assert.equal(captured[0].url, "http://ts/api/v1/admin/positions/delete");
  assert.deepEqual(B(), { id: POSITION.id, A: 2 });
});

test("update_trade and delete_trade hit the trade endpoints with the same shapes", async () => {
  respond = () => TRADE;
  const upd = (await trd.updateTradePlan(client(), { tradeId: 999, profit: 6.5 })) as {
    commitToken: string;
    changes: Record<string, unknown>;
  };
  assert.deepEqual(Object.keys(upd.changes), ["profit"]);
  captured = [];
  await trd.updateTradeCommit(client(), { commitToken: upd.commitToken });
  assert.equal(captured[0].url, "http://ts/api/v1/admin/trades/edit");
  assert.deepEqual(B(), { id: 999, A: 2, pl: 6.5 });

  respond = () => TRADE;
  captured = [];
  const del = (await trd.deleteTradePlan(client(), { tradeId: 999 })) as { commitToken: string };
  captured = [];
  await trd.deleteTradeCommit(client(), { commitToken: del.commitToken });
  assert.equal(captured[0].url, "http://ts/api/v1/admin/trades/delete");
  assert.deepEqual(B(), { id: 999, A: 2 });
});

test("a position token cannot be committed by the trade tool (tool-bound tokens)", async () => {
  respond = () => POSITION;
  const plan = (await trd.deletePositionPlan(client(), { positionId: 1 })) as {
    commitToken: string;
  };
  await assert.rejects(
    () => trd.deleteTradeCommit(client(), { commitToken: plan.commitToken }),
    /delete_position_plan/,
  );
});

test("create_manager keys on accountId with version 0 and no If-Match", async () => {
  respond = () => ({ accountId: 1, version: 3, viewSymbols: true, configureSymbols: true });
  const plan = (await cfg.createManagerPlan(client(), {
    accountId: 55,
    fromId: 1,
    permissions: { configureSymbols: false },
  })) as { commitToken: string; willCreate: Record<string, unknown> };

  assert.equal(captured[0].url, "http://ts/api/v1/admin/managers/get/1"); // template read
  assert.equal(plan.willCreate.accountId, 55);
  assert.equal(plan.willCreate.version, 0);
  assert.equal(plan.willCreate.viewSymbols, true); // copied from the template
  assert.equal(plan.willCreate.configureSymbols, false); // overridden

  captured = [];
  respond = () => ({ ok: true });
  await cfg.createManagerCommit(client(), { commitToken: plan.commitToken });
  assert.equal(captured[0].url, "http://ts/api/v1/admin/managers/edit");
  assert.equal(captured[0].method, "POST");
  assert.equal(captured[0].headers["If-Match"], undefined);
  assert.equal(B().accountId, 55);
  assert.equal(B().version, 0);
});

test("book lookups fall back to the query endpoint when get-by-id is not served (502)", async () => {
  // Reproduces the live behaviour: /admin/positions/get/{id} answers 502 for every id, while
  // /admin/positions/query returns the record.
  globalThis.fetch = (async (url: any, init: any) => {
    const u = String(url);
    captured.push({
      url: u,
      method: init?.method ?? "GET",
      body: init?.body,
      headers: (init?.headers ?? {}) as Record<string, string>,
    });
    if (u.includes("/positions/get/")) return new Response("Bad Gateway", { status: 502 });
    return new Response(JSON.stringify({ positions: [POSITION] }), { status: 200 });
  }) as any;

  const plan = (await trd.updatePositionPlan(client(), {
    positionId: POSITION.id,
    accountId: 2,
    swaps: -8,
  })) as { commitToken: string; changes: Record<string, unknown> };

  assert.ok(captured[0].url.includes("/admin/positions/get/")); // documented route tried first
  assert.equal(captured[1].url, "http://ts/api/v1/admin/positions/query"); // then the fallback
  assert.deepEqual(JSON.parse(captured[1].body!), {
    accountFilter: { accounts: [2] },
    maxResults: PAGE_SIZE,
  }); // narrowed, and paged so the record cannot fall off page 1
  assert.deepEqual(Object.keys(plan.changes), ["swaps"]);
  assert.ok(plan.commitToken);
});

test("book lookup surfaces a clear error when neither route yields the record", async () => {
  globalThis.fetch = (async (url: any) => {
    const u = String(url);
    if (u.includes("/trades/get/")) return new Response("Bad Gateway", { status: 502 });
    return new Response(JSON.stringify({ trades: [] }), { status: 200 });
  }) as any;

  await assert.rejects(
    () => trd.getTrade(client(), { tradeId: 424242 }),
    /No trade with id 424242 was found/,
  );
});

test("create_manager without a template sends a COMPLETE record with every permission off", async () => {
  // The server rejects a sparse manager body with "Invalid body" (observed live), so with no
  // fromId the tool starts from /admin/managers/self and turns every boolean off.
  respond = () => ({
    accountId: 1,
    version: 9,
    viewSymbols: true,
    configureSymbols: true,
    viewGroups: true,
    balanceOperations: true,
  });
  const plan = (await cfg.createManagerPlan(client(), {
    accountId: 77,
    permissions: { viewSymbols: true },
  })) as { commitToken: string; willCreate: Record<string, unknown> };

  assert.equal(captured[0].url, "http://ts/api/v1/admin/managers/self");
  assert.equal(plan.willCreate.accountId, 77);
  assert.equal(plan.willCreate.version, 0);
  assert.equal(plan.willCreate.viewSymbols, true); // asked for
  assert.equal(plan.willCreate.configureSymbols, false); // defaulted off, but PRESENT
  assert.equal(plan.willCreate.viewGroups, false);
  assert.equal(plan.willCreate.balanceOperations, false);
  // completeness is the point: every field of the reference record is carried over
  assert.equal(plan.willCreate.groups, "*"); // required by /edit; managers/self omits it
  assert.equal(Object.keys(plan.willCreate).length, 7);
});
