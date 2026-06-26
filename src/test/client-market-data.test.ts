import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { RestClient } from "../rest-client.js";
import { StaticCredentials } from "../auth/admin-auth.js";
import * as m from "../tools/client/market-data.js";

let captured: { url: string; method: string; body?: string }[] = [];
let respond: (url: string) => unknown;

beforeEach(() => {
  captured = [];
  respond = () => ({});
  globalThis.fetch = (async (url: any, init: any) => {
    captured.push({ url: String(url), method: init?.method ?? "GET", body: init?.body });
    return new Response(JSON.stringify(respond(String(url))), { status: 200 });
  }) as any;
});

const client = () => new RestClient("http://ts", new StaticCredentials("K", "S"));

test("getQuote GETs /quote/{symbol}", async () => {
  await m.getQuote(client(), { symbol: "EURUSD" });
  assert.equal(captured[0].url, "http://ts/api/v1/quote/EURUSD");
});

test("getQuotes fans out one GET per symbol", async () => {
  const res = (await m.getQuotes(client(), { symbols: ["EURUSD", "GBPUSD"] })) as Array<{
    symbol: string;
  }>;
  assert.equal(captured.length, 2);
  assert.deepEqual(
    res.map((r) => r.symbol),
    ["EURUSD", "GBPUSD"],
  );
});

test("getMarketDepth GETs /depth/{symbol}?depth=N", async () => {
  await m.getMarketDepth(client(), { symbol: "EURUSD", priceLevel: 5 });
  assert.equal(captured[0].url, "http://ts/api/v1/depth/EURUSD?depth=5");
});

test("getSymbols GETs /symbols/query and filters client-side", async () => {
  respond = () => ({ symbols: [{ name: "EURUSD" }, { name: "GBPUSD" }] });
  const res = (await m.getSymbols(client(), { filter: "EUR*" })) as Array<{ name: string }>;
  assert.deepEqual(res, [{ name: "EURUSD" }]);
});

test("getSymbolDetails GETs /symbols/get/{name}", async () => {
  await m.getSymbolDetails(client(), { symbolName: "XAUUSD" });
  assert.equal(captured[0].url, "http://ts/api/v1/symbols/get/XAUUSD");
});

test("getCandles POSTs /charts with required symbolName+interval", async () => {
  await m.getCandles(client(), { symbolName: "EURUSD", interval: "1H", maxResults: 100 });
  assert.equal(captured[0].url, "http://ts/api/v1/charts");
  assert.deepEqual(JSON.parse(captured[0].body!), {
    symbolName: "EURUSD",
    interval: "1H",
    maxResults: 100,
  });
});

test("getConversionRate POSTs /conversion-rate/single", async () => {
  await m.getConversionRate(client(), { from: "EUR", to: "USD" });
  assert.deepEqual(JSON.parse(captured[0].body!), { from: "EUR", to: "USD" });
});

test("healthCheck GETs /now", async () => {
  await m.healthCheck(client());
  assert.equal(captured[0].url, "http://ts/api/v1/now");
});

test("getSymbols filter 'EURUSD.r' matches literal dot, not any char", async () => {
  respond = () => ({ symbols: [{ name: "EURUSD.r" }, { name: "EURUSDXr" }] });
  const res = (await m.getSymbols(client(), { filter: "EURUSD.r" })) as Array<{ name: string }>;
  assert.deepEqual(res, [{ name: "EURUSD.r" }]);
});

test("getSymbols filter '(' does not throw and matches literal paren symbol", async () => {
  respond = () => ({ symbols: [{ name: "(" }, { name: "EURUSD" }] });
  const res = (await m.getSymbols(client(), { filter: "(" })) as Array<{ name: string }>;
  assert.deepEqual(res, [{ name: "(" }]);
});

test("getSymbols filter matches the server's real 'n' field (regression: was reading 'name')", async () => {
  respond = () => ({ symbols: [{ n: "EURUSD" }, { n: "GBPUSD" }, { n: "USDJPY" }] });
  const res = (await m.getSymbols(client(), { filter: "EUR*" })) as Array<{ n?: string }>;
  assert.deepEqual(res, [{ n: "EURUSD" }]);
});

test("getQuotes returns null+error for failed symbol, quote for success", async () => {
  globalThis.fetch = (async (url: any, init: any) => {
    captured.push({ url: String(url), method: init?.method ?? "GET", body: init?.body });
    if (String(url).includes("BROKEN")) {
      return new Response("server error", { status: 500 });
    }
    return new Response(JSON.stringify({ bid: 1.1, ask: 1.2 }), { status: 200 });
  }) as any;
  const res = (await m.getQuotes(client(), { symbols: ["EURUSD", "BROKEN"] })) as Array<{
    symbol: string;
    quote: unknown;
    error?: string;
  }>;
  assert.ok(res[0].quote, "EURUSD should have a quote");
  assert.equal(res[1].symbol, "BROKEN");
  assert.equal(res[1].quote, null);
  assert.equal(typeof res[1].error, "string");
  assert.ok(
    res[1].error!.includes("500") || res[1].error!.includes("SERVER_ERROR"),
    `error should mention 500 or SERVER_ERROR, got: ${res[1].error}`,
  );
});
