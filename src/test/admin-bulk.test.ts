import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { RestClient } from "../rest-client.js";
import { PAGE_SIZE } from "../tools/admin/paging.js";
import { StaticCredentials } from "../auth/admin-auth.js";
import * as bulk from "../tools/admin/bulk.js";
import * as md from "../tools/admin/market-data.js";

let captured: { url: string; method: string; body?: string; headers: Record<string, string> }[] =
  [];
let respond: (url: string) => unknown;

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
    const headers = (init?.method ?? "GET") === "GET" ? { ETag: '"3"' } : undefined;
    return new Response(JSON.stringify(respond(String(url))), { status: 200, headers });
  }) as any;
});

const client = () => new RestClient("http://ts", new StaticCredentials("K", "S"));
const last = () => captured[captured.length - 1];

const SYMBOLS = {
  symbols: [
    { id: 1, version: 2, name: "EURUSD", bidMarkup: 0, timeCreated: 5 },
    { id: 2, version: 1, name: "EURGBP", bidMarkup: 0 },
    { id: 3, version: 1, name: "GBPUSD", bidMarkup: 0 },
    { id: 4, version: 1, name: "EURJPY", bidMarkup: 5 }, // already at the target value
  ],
};

test("bulk_update selects by glob, skips already-matching records, posts one array", async () => {
  respond = () => SYMBOLS;
  const plan = (await bulk.bulkUpdatePlan(client(), {
    resource: "symbols",
    namePattern: "EUR*",
    updates: { bidMarkup: 5 },
  })) as Record<string, unknown>;

  assert.equal(captured[0].url, `http://ts/api/v1/admin/symbols/query?maxResults=${PAGE_SIZE}`); // one paged listing request
  assert.equal(plan.matched, 3); // EURUSD, EURGBP, EURJPY
  assert.equal(plan.willChange, 2); // EURJPY already has bidMarkup 5
  assert.equal(plan.unchangedSkipped, 1);
  assert.deepEqual(plan.affected, ["EURUSD (1)", "EURGBP (2)"]);

  captured = [];
  respond = () => ({ ok: true });
  await bulk.bulkUpdateCommit(client(), { commitToken: plan.commitToken as string });
  assert.equal(last().url, "http://ts/api/v1/admin/symbols/batch/edit");
  assert.equal(last().method, "POST");
  assert.equal(last().headers["If-Match"], undefined); // batch endpoints carry no ETag concurrency

  const sent = JSON.parse(last().body!);
  assert.ok(Array.isArray(sent)); // bare array, not an object wrapper
  assert.equal(sent.length, 2);
  assert.deepEqual(
    sent.map((s: any) => [s.name, s.bidMarkup, s.version]),
    [
      ["EURUSD", 5, 2],
      ["EURGBP", 5, 1],
    ],
  );
  assert.equal(sent[0].timeCreated, undefined); // server-managed fields stripped
});

test("bulk_update selects by explicit ids", async () => {
  respond = () => SYMBOLS;
  const plan = (await bulk.bulkUpdatePlan(client(), {
    resource: "symbols",
    ids: [3],
    updates: { bidMarkup: 9 },
  })) as Record<string, unknown>;
  assert.equal(plan.willChange, 1);
  assert.deepEqual(plan.affected, ["GBPUSD (3)"]);
});

test("bulk_delete builds the per-resource id key and version", async () => {
  respond = () => SYMBOLS;
  const plan = (await bulk.bulkDeletePlan(client(), {
    resource: "symbols",
    namePattern: "GBP*",
  })) as Record<string, unknown>;
  assert.equal(plan.willDelete, 1);

  captured = [];
  respond = () => ({ ok: true });
  await bulk.bulkDeleteCommit(client(), { commitToken: plan.commitToken as string });
  assert.equal(last().url, "http://ts/api/v1/admin/symbols/batch/delete");
  assert.deepEqual(JSON.parse(last().body!), [{ symbolId: 3, version: 1 }]);
});

test("managers are keyed by accountId, not id", async () => {
  respond = () => ({ managers: [{ accountId: 7, version: 1, viewSymbols: true }] });
  const plan = (await bulk.bulkDeletePlan(client(), { resource: "managers", ids: [7] })) as Record<
    string,
    unknown
  >;
  captured = [];
  await bulk.bulkDeleteCommit(client(), { commitToken: plan.commitToken as string });
  assert.equal(last().url, "http://ts/api/v1/admin/managers/batch/delete");
  assert.deepEqual(JSON.parse(last().body!), [{ accountId: 7, version: 1 }]);
});

test("holidays list through the POST query endpoint", async () => {
  respond = () => ({ holidays: [{ id: 5, version: 1, description: "Xmas", enabled: true }] });
  await bulk.bulkUpdatePlan(client(), {
    resource: "holidays",
    namePattern: "Xmas",
    updates: { enabled: false },
  });
  assert.equal(captured[0].url, "http://ts/api/v1/admin/holidays/query");
  assert.equal(captured[0].method, "POST");
  assert.equal(captured[0].body, JSON.stringify({ maxResults: PAGE_SIZE }));
});

test("a nothing-matched selection returns a message and no commit token", async () => {
  respond = () => SYMBOLS;
  const plan = (await bulk.bulkUpdatePlan(client(), {
    resource: "symbols",
    namePattern: "NOPE*",
    updates: { bidMarkup: 5 },
  })) as Record<string, unknown>;
  assert.equal(plan.matched, 0);
  assert.equal(plan.commitToken, undefined);
});

test("selection errors are explicit: no selector, and globs on nameless resources", async () => {
  respond = () => SYMBOLS;
  await assert.rejects(
    () => bulk.bulkUpdatePlan(client(), { resource: "symbols", updates: { bidMarkup: 1 } }),
    /either `ids` or `namePattern`/,
  );
  respond = () => ({ accounts: [{ id: 1000, version: 1 }] });
  await assert.rejects(
    () =>
      bulk.bulkUpdatePlan(client(), {
        resource: "accounts",
        namePattern: "*",
        updates: { leverage: 50 },
      }),
    /no name to match on/,
  );
});

test("bulk candle tools group bars under the symbol and interval", async () => {
  const bars = [
    { barTime: 100, open: 1, high: 2, low: 0.5, close: 1.5, volume: 10 },
    { barTime: 200, open: 1.5, high: 2.5, low: 1, close: 2, volume: 20 },
  ];
  const plan = (await md.bulkUpdateCandlesPlan(client(), {
    symbolId: 1,
    interval: "1H",
    bars,
  })) as Record<string, unknown>;
  assert.equal(plan.barCount, 2);
  assert.deepEqual(plan.timeRange, { firstBar: 100, lastBar: 200 });
  assert.equal(captured.length, 0); // planning a candle batch needs no read

  await md.bulkUpdateCandlesCommit(client(), { commitToken: plan.commitToken as string });
  assert.equal(last().url, "http://ts/api/v1/admin/charts/batch/edit");
  assert.deepEqual(JSON.parse(last().body!), {
    si: 1,
    i: "1H",
    d: [
      { t: 100, o: 1, h: 2, l: 0.5, c: 1.5, v: 10 },
      { t: 200, o: 1.5, h: 2.5, l: 1, c: 2, v: 20 },
    ],
  });

  const del = (await md.bulkDeleteCandlesPlan(client(), {
    symbolId: 1,
    interval: "1H",
    barTimes: [200, 100],
  })) as Record<string, unknown>;
  await md.bulkDeleteCandlesCommit(client(), { commitToken: del.commitToken as string });
  assert.equal(last().url, "http://ts/api/v1/admin/charts/batch/delete");
  assert.deepEqual(JSON.parse(last().body!), { si: 1, i: "1H", d: [200, 100] });
});
