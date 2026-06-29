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

// ===== admin money-mover preview/commit (E1a) =====
test("admin place_order_plan tokenizes with the account in the echo; missing accountId asks", async () => {
  let writes = 0;
  const fake = {
    get: async () => ({}),
    post: async (path: string) => {
      if (path === "/admin/orders/edit") writes++;
      return {};
    },
  } as never;
  const ok = (await at.placeOrderPlan(fake, {
    accountId: 100,
    symbol: "EURUSD",
    side: "buy",
    quantity: 0.1,
    orderType: "Market",
    timeInForce: "FOK",
  })) as { commitToken?: string; preview?: { summary: string } };
  assert.ok(ok.commitToken);
  assert.match(ok.preview!.summary, /account 100/i);
  assert.equal(writes, 0); // plan must not place the order
  const miss = (await at.placeOrderPlan(fake, {
    symbol: "EURUSD",
    side: "buy",
    quantity: 0.1,
    orderType: "Market",
    timeInForce: "FOK",
  })) as { needMoreInfo?: string };
  assert.match(miss.needMoreInfo!, /account/i);
});

test("admin place_order_commit executes once via /admin/orders/edit (A=accountId), then rejects reuse", async () => {
  let body: Record<string, unknown> | undefined;
  const fake = {
    get: async () => ({}),
    post: async (path: string, b: Record<string, unknown>) => {
      if (path === "/admin/orders/edit") body = b;
      return {};
    },
  } as never;
  const plan = (await at.placeOrderPlan(fake, {
    accountId: 100,
    symbol: "EURUSD",
    side: "buy",
    quantity: 0.1,
    orderType: "Market",
    timeInForce: "FOK",
  })) as { commitToken: string };
  await at.placeOrderCommit(fake, { commitToken: plan.commitToken });
  assert.equal(body!.A, 100); // accountId mapped to body field A
  assert.equal(body!.s, "EURUSD");
  await assert.rejects(
    at.placeOrderCommit(fake, { commitToken: plan.commitToken }),
    /No pending order/,
  );
});

test("admin close_* plans enforce accountId (and their own required ids)", async () => {
  const fake = { get: async () => ({}), post: async () => ({}) } as never;
  const cp = (await at.closePositionPlan(fake, { positionId: 5 })) as { needMoreInfo?: string };
  assert.match(cp.needMoreInfo!, /account/i);
  assert.ok(
    (
      (await at.closePositionPlan(fake, { accountId: 100, positionId: 5 })) as {
        commitToken?: string;
      }
    ).commitToken,
  );
  const cb = (await at.closeByPlan(fake, { accountId: 100, positionId: 5 })) as {
    needMoreInfo?: string;
  };
  assert.match(cb.needMoreInfo!, /opposite position ID/);
  const ca = (await at.closeAllPositionsPlan(fake, {})) as { needMoreInfo?: string };
  assert.match(ca.needMoreInfo!, /account/i);
  assert.ok(
    ((await at.closeAllPositionsPlan(fake, { accountId: 100 })) as { commitToken?: string })
      .commitToken,
  );
});
