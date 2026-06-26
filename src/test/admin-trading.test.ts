import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { RestClient } from "../rest-client.js";
import { StaticCredentials } from "../auth/admin-auth.js";
import * as at from "../tools/admin/trading.js";

const client = () => new RestClient("http://ts", new StaticCredentials("K", "S"));

beforeEach(() => {
  globalThis.fetch = (async () => new Response("{}", { status: 200 })) as any;
});

test("admin placeOrder does NOT retry on a connection error (duplicate-fill protection)", async () => {
  let calls = 0;
  globalThis.fetch = (async () => {
    calls++;
    throw new TypeError("fetch failed");
  }) as any;
  await assert.rejects(() =>
    at.placeOrder(client(), {
      accountId: 1,
      symbol: "EURUSD",
      side: "buy",
      quantity: 0.1,
      orderType: "Market",
      timeInForce: "IOC",
    }),
  );
  assert.equal(calls, 1);
});

test("admin closePosition does NOT retry the closing order on a connection error", async () => {
  let orderCalls = 0;
  globalThis.fetch = (async (url: any) => {
    if (String(url).includes("/positions/query")) {
      return new Response(
        JSON.stringify({ positions: [{ id: 5, s: "EURUSD", S: "buy", q: 0.1 }] }),
        { status: 200 },
      );
    }
    orderCalls++; // /admin/orders/edit
    throw new TypeError("fetch failed");
  }) as any;
  await assert.rejects(() => at.closePosition(client(), { accountId: 1, positionId: 5 }));
  assert.equal(orderCalls, 1);
});

test("admin closeBy does NOT retry the closing order on a connection error", async () => {
  let orderCalls = 0;
  globalThis.fetch = (async (url: any) => {
    if (String(url).includes("/positions/query")) {
      return new Response(
        JSON.stringify({
          positions: [
            { id: 5, s: "EURUSD", S: "buy", q: 0.1 },
            { id: 6, s: "EURUSD", S: "sell", q: 0.1 },
          ],
        }),
        { status: 200 },
      );
    }
    orderCalls++;
    throw new TypeError("fetch failed");
  }) as any;
  await assert.rejects(() =>
    at.closeBy(client(), { accountId: 1, positionId: 5, positionById: 6 }),
  );
  assert.equal(orderCalls, 1);
});

test("admin modifyOrder STILL retries once on a connection error (idempotent control)", async () => {
  let calls = 0;
  globalThis.fetch = (async () => {
    calls++;
    if (calls === 1) throw new TypeError("fetch failed");
    return new Response("{}", { status: 200 });
  }) as any;
  await at.modifyOrder(client(), { accountId: 1, orderId: 5, quantity: 0.2 });
  assert.equal(calls, 2);
});
