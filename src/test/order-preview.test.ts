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
