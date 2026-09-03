import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { RestClient } from "../rest-client.js";
import { PAGE_SIZE } from "../tools/admin/paging.js";
import { StaticCredentials } from "../auth/admin-auth.js";
import * as trd from "../tools/admin/trading.js";
import * as acct from "../tools/admin/account.js";
import * as cfg from "../tools/admin/config.js";

// Regression guard for a bug found live: these endpoints filter with `accountFilter` /
// `symbolNames`, but the tools used to send a bare `{ A, s }`. The server SILENTLY IGNORED it and
// returned every record on the server, so "positions for account X" answered with everybody's
// positions — and anything acting on that answer hit the wrong records.

let captured: { url: string; body?: string }[] = [];

beforeEach(() => {
  captured = [];
  globalThis.fetch = (async (url: any, init: any) => {
    captured.push({ url: String(url), body: init?.body });
    return new Response(JSON.stringify({}), { status: 200 });
  }) as any;
});

const client = () => new RestClient("http://ts", new StaticCredentials("K", "S"));
const sent = () => JSON.parse(captured[0].body!);

test("account-scoped queries send accountFilter, never a bare A", async () => {
  const c = client();
  const calls: Array<[string, () => Promise<unknown>]> = [
    ["/admin/orders/active", () => trd.getWorkingOrders(c, { accountId: 7 })],
    ["/admin/positions/query", () => trd.getOpenPositions(c, { accountId: 7 })],
    ["/admin/trades/query", () => trd.getTradeHistory(c, { accountId: 7 })],
    ["/admin/orders/history", () => trd.getOrderHistory(c, { accountId: 7 })],
    ["/admin/transfers/query", () => acct.getTransferHistory(c, { accountId: 7 })],
  ];
  for (const [path, run] of calls) {
    captured = [];
    await run();
    assert.equal(captured[0].url, `http://ts/api/v1${path}`);
    assert.deepEqual(
      sent().accountFilter,
      { accounts: [7] },
      `${path} must scope by accountFilter`,
    );
    assert.equal(sent().A, undefined, `${path} must not send the ignored A field`);
  }
});

test("symbol-scoped queries send symbolNames, never a bare s", async () => {
  const c = client();
  await trd.getOpenPositions(c, { symbol: "EURUSD" });
  assert.deepEqual(sent().symbolNames, ["EURUSD"]);
  assert.equal(sent().s, undefined);

  captured = [];
  await trd.getTradeHistory(c, { accountId: 7, symbol: "GBPUSD" });
  assert.deepEqual(sent().symbolNames, ["GBPUSD"]);
  assert.deepEqual(sent().accountFilter, { accounts: [7] });
});

test("account state and balances scope through accountFilter too", async () => {
  const c = client();
  await acct.getAccountState(c, { accountId: 42 });
  assert.equal(captured[0].url, "http://ts/api/v1/admin/accounts/states/query");
  assert.deepEqual(sent().accountFilter, { accounts: [42] });

  captured = [];
  globalThis.fetch = (async (url: any, init: any) => {
    captured.push({ url: String(url), body: init?.body });
    const payload = String(url).includes("/accounts/query")
      ? { accounts: [{ id: 11 }, { id: 12 }] }
      : {};
    return new Response(JSON.stringify(payload), { status: 200 });
  }) as any;
  await acct.getBalances(c);
  const statesCall = captured.find((x) => x.url.includes("/states/query"))!;
  assert.deepEqual(JSON.parse(statesCall.body!).accountFilter, { accounts: [11, 12] });
});

test("no filter supplied means no filter sent (server-wide)", async () => {
  await trd.getOpenPositions(client(), {});
  assert.deepEqual(sent(), { maxResults: PAGE_SIZE }); // page size only — no account/symbol filter
});

test("repeated GETs of the same resource do not send If-None-Match (no bogus 304)", async () => {
  // RestClient records ETags for If-Match on writes but never caches bodies, so a conditional GET
  // could only ever fail. Reading the same path twice used to throw "Not modified (304)".
  const seen: Array<Record<string, string>> = [];
  globalThis.fetch = (async (_url: any, init: any) => {
    seen.push((init?.headers ?? {}) as Record<string, string>);
    return new Response(JSON.stringify({ version: 2, routing: [] }), {
      status: 200,
      headers: { ETag: '"2"' },
    });
  }) as any;

  const c = client();
  await c.get("/admin/routing/query");
  await c.get("/admin/routing/query"); // would have 304'd before
  assert.equal(seen.length, 2);
  for (const h of seen) assert.equal(h["If-None-Match"], undefined);
  assert.equal(c.getEtag("/admin/routing/query"), '"2"'); // still recorded for If-Match
});

test("routing writes bridge the ETag from /query onto /edit (If-Match is mandatory there)", async () => {
  const calls: Array<{ url: string; headers: Record<string, string> }> = [];
  globalThis.fetch = (async (url: any, init: any) => {
    calls.push({ url: String(url), headers: (init?.headers ?? {}) as Record<string, string> });
    return new Response(JSON.stringify({ version: 5, routing: [] }), {
      status: 200,
      headers: { ETag: '"5"' },
    });
  }) as any;

  const c = client();
  const plan = (await cfg.setOrderRoutingPlan(c, { version: 5, routing: [] })) as {
    commitToken: string;
  };
  await cfg.setOrderRoutingCommit(c, { commitToken: plan.commitToken });
  const write = calls.find((x) => x.url.endsWith("/admin/routing/edit"))!;
  assert.ok(
    calls.some((x) => x.url.endsWith("/admin/routing/query")),
    "must read before writing",
  );
  assert.equal(write.headers["If-Match"], '"5"');
});
