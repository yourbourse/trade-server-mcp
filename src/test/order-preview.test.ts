import { test } from "node:test";
import assert from "node:assert/strict";
import { buildOrderPreview } from "../preview/order-preview.js";

test("preview always returns a human summary even if data calls fail", async () => {
  const client = {
    get: async () => {
      throw new Error("502");
    },
    post: async () => {
      throw new Error("502");
    },
  } as never;
  const p = await buildOrderPreview(client, {
    action: "place",
    symbol: "EURUSD",
    side: "buy",
    quantity: 0.1,
    orderType: "Market",
    timeInForce: "IOC",
  });
  assert.match(p.summary, /BUY 0.1 EURUSD/i);
  assert.match(p.summary, /Market/);
  assert.ok(p.note); // notes that live market/account data was unavailable
});

test("preview includes quote + free margin when data calls succeed", async () => {
  const client = {
    get: async (path: string) =>
      path.includes("/quote/") ? { s: "EURUSD", bp: 1.1, ap: 1.1003 } : {},
    post: async (path: string) => (path === "/account/state" ? { e: 8968, m: 909 } : {}),
  } as never;
  const p = await buildOrderPreview(client, {
    action: "place",
    symbol: "EURUSD",
    side: "buy",
    quantity: 0.1,
    orderType: "Market",
    timeInForce: "IOC",
  });
  assert.equal(p.freeMargin, 8968 - 909);
  assert.ok(p.quote);
});

test("preview echoes margin-check OFF so the confirmer sees a bypassed margin check (Copilot #7)", async () => {
  const client = { get: async () => ({}), post: async () => ({}) } as never;
  const off = await buildOrderPreview(client, {
    action: "place",
    accountId: 100,
    symbol: "EURUSD",
    side: "buy",
    quantity: 0.1,
    orderType: "Market",
    timeInForce: "FOK",
    marginCheck: false,
  });
  assert.match(off.summary, /margin check off/i);
  // Default (true / omitted) is the safe case and must not clutter the summary.
  const on = await buildOrderPreview(client, {
    action: "place",
    accountId: 100,
    symbol: "EURUSD",
    side: "buy",
    quantity: 0.1,
    orderType: "Market",
    timeInForce: "FOK",
    marginCheck: true,
  });
  assert.doesNotMatch(on.summary, /margin check/i);
});

test("StopLimit preview shows BOTH limit and stop prices, not just one (Copilot #B)", async () => {
  const client = { get: async () => ({}), post: async () => ({}) } as never;
  const p = await buildOrderPreview(client, {
    action: "place",
    symbol: "EURUSD",
    side: "buy",
    quantity: 0.1,
    orderType: "StopLimit",
    timeInForce: "GTC",
    limitPrice: 1.105,
    stopPrice: 1.1,
  });
  assert.match(p.summary, /1\.105/); // limit price
  assert.match(p.summary, /stop 1\.1/i); // stop trigger must not be hidden from the confirmer
});
