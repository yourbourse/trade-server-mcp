import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { RestClient } from "../rest-client.js";
import { StaticCredentials } from "../auth/admin-auth.js";
import * as cfg from "../tools/admin/config.js";
import * as acct from "../tools/admin/account.js";
import * as trd from "../tools/admin/trading.js";
import * as md from "../tools/admin/market-data.js";
import { buildAccountFilter } from "../tools/admin/filters.js";

let captured: { url: string; method: string; body?: string }[] = [];

beforeEach(() => {
  captured = [];
  globalThis.fetch = (async (url: any, init: any) => {
    captured.push({ url: String(url), method: init?.method ?? "GET", body: init?.body });
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  }) as any;
});

const client = () => new RestClient("http://ts", new StaticCredentials("K", "S"));
const B = () => JSON.parse(captured[0].body!);

test("get_journal posts the time range and optional filters", async () => {
  await cfg.getJournal(client(), {
    fromTime: 100,
    toTime: 200,
    severities: ["error", "critical"],
    mask: "symbol",
    maxResults: 50,
  });
  assert.equal(captured[0].url, "http://ts/api/v1/admin/journal/query");
  assert.equal(captured[0].method, "POST");
  assert.deepEqual(B(), {
    fromTime: 100,
    toTime: 200,
    mask: "symbol",
    severities: ["error", "critical"],
    maxResults: 50,
  });
});

test("get_journal omits absent optional fields", async () => {
  await cfg.getJournal(client(), { fromTime: 1, toTime: 2 });
  assert.deepEqual(B(), { fromTime: 1, toTime: 2 });
});

test("get_statements maps the account filter and defaults it to all groups", async () => {
  await cfg.getStatements(client(), { type: "Daily", date: "2026-08-10", groups: [2] });
  assert.equal(captured[0].url, "http://ts/api/v1/admin/statements/query");
  assert.deepEqual(B(), {
    type: "Daily",
    date: "2026-08-10",
    accountFilter: { groups: [2] },
  });

  captured = [];
  await cfg.getStatements(client(), { type: "Monthly", date: "2026-08-01", positions: true });
  assert.deepEqual(B(), {
    type: "Monthly",
    date: "2026-08-01",
    accountFilter: { groupMasks: ["*"] }, // required by the API — defaulted, not omitted
    positions: true,
  });
});

test("buildAccountFilter picks one shape, accounts first, undefined when empty", () => {
  assert.deepEqual(buildAccountFilter({ accounts: [1], groups: [2] }), { accounts: [1] });
  assert.deepEqual(buildAccountFilter({ groups: [2], groupMasks: ["x"] }), { groups: [2] });
  assert.deepEqual(buildAccountFilter({ groupMasks: ["Real/*"] }), { groupMasks: ["Real/*"] });
  assert.equal(buildAccountFilter({}), undefined);
  assert.equal(buildAccountFilter({ accounts: [] }), undefined); // empty list is not a filter
});

test("get_email_services is a plain GET", async () => {
  await cfg.getEmailServices(client());
  assert.equal(captured[0].url, "http://ts/api/v1/admin/email-service/query");
  assert.equal(captured[0].method, "GET");
});

test("find_client_by_external_id posts the external id", async () => {
  await cfg.findClientByExternalId(client(), { clientExternalId: "CRM-42" });
  assert.equal(captured[0].url, "http://ts/api/v1/admin/clients/query-by-external-id");
  assert.equal(captured[0].method, "POST");
  assert.deepEqual(B(), { clientExternalId: "CRM-42" });
});

test("get_margin_call_accounts maps filter, paging and sort", async () => {
  await acct.getMarginCallAccounts(client(), {
    accounts: [1001],
    maxResults: 10,
    sortOrder: "desc",
  });
  assert.equal(captured[0].url, "http://ts/api/v1/admin/accounts/margin-call/query");
  assert.deepEqual(B(), { accountFilter: { accounts: [1001] }, maxResults: 10, sortOrder: "desc" });

  captured = [];
  await acct.getMarginCallAccounts(client(), {});
  assert.deepEqual(B(), {}); // no filter supplied → server-wide
});

test("get_transfer reads a single transfer by id", async () => {
  await acct.getTransfer(client(), { transferId: 77 });
  assert.equal(captured[0].url, "http://ts/api/v1/admin/transfers/get/77");
  assert.equal(captured[0].method, "GET");
});

test("single-order lookups hit their distinct endpoints", async () => {
  await trd.getWorkingOrder(client(), { orderId: 5 });
  assert.equal(captured[0].url, "http://ts/api/v1/admin/orders/active/single");
  assert.deepEqual(B(), { orderId: 5 });

  captured = [];
  await trd.getHistoricalOrder(client(), { orderId: 6 });
  assert.equal(captured[0].url, "http://ts/api/v1/admin/orders/history/single");
  assert.deepEqual(B(), { orderId: 6 });
});

test("get_conversion_rates_batch posts a bare array, not an object wrapper", async () => {
  await md.getConversionRatesBatch(client(), {
    rates: [
      { groupId: 1, from: "EUR", to: "USD" },
      { groupId: 1, from: "GBP", to: "USD" },
    ],
  });
  assert.equal(captured[0].url, "http://ts/api/v1/admin/conversion-rate/batch");
  assert.equal(captured[0].method, "POST");
  assert.deepEqual(B(), [
    { groupId: 1, from: "EUR", to: "USD" },
    { groupId: 1, from: "GBP", to: "USD" },
  ]);
});
