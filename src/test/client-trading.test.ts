import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { RestClient } from "../rest-client.js";
import { StaticCredentials } from "../auth/admin-auth.js";
import * as t from "../tools/client/trading.js";

let captured: { url: string; method: string; body?: string }[] = [];
let respond: (url: string, method: string) => unknown;

beforeEach(() => {
  captured = [];
  respond = () => ({});
  globalThis.fetch = (async (url: any, init: any) => {
    captured.push({ url: String(url), method: init?.method ?? "GET", body: init?.body });
    return new Response(JSON.stringify(respond(String(url), init?.method ?? "GET")), {
      status: 200,
    });
  }) as any;
});

const client = () => new RestClient("http://ts", new StaticCredentials("K", "S"));

test("closePositionPlanSchema rejects non-positive quantity (Copilot #5)", () => {
  assert.throws(() => t.closePositionPlanSchema.parse({ positionId: 1, quantity: 0 }));
  assert.throws(() => t.closePositionPlanSchema.parse({ positionId: 1, quantity: -1 }));
  assert.doesNotThrow(() => t.closePositionPlanSchema.parse({ positionId: 1, quantity: 0.1 }));
  assert.doesNotThrow(() => t.closePositionPlanSchema.parse({ positionId: 1 })); // full close
});

test("closePositionSchema (commit) also rejects non-positive quantity (Copilot #5)", () => {
  assert.throws(() => t.closePositionSchema.parse({ positionId: 1, quantity: 0 }));
  assert.throws(() => t.closePositionSchema.parse({ positionId: 1, quantity: -2 }));
  assert.doesNotThrow(() => t.closePositionSchema.parse({ positionId: 1, quantity: 0.5 }));
});

test("plan completeness messages name the *_plan tool, not the removed one-shot tool (Copilot #A)", async () => {
  const fake = { get: async () => ({}), post: async () => ({}) } as never;
  const po = (await t.placeOrderPlan(fake, { symbol: "EURUSD" })) as { needMoreInfo?: string };
  assert.match(po.needMoreInfo!, /place_order_plan/);
  const cp = (await t.closePositionPlan(fake, {})) as { needMoreInfo?: string };
  assert.match(cp.needMoreInfo!, /close_position_plan/);
});

test("place_order no longer offers CloseBy or position-ID fields; hedged closes use close_by (Copilot)", () => {
  // CloseBy is rejected by both the commit and plan schemas
  assert.throws(() =>
    t.placeOrderSchema.parse({
      symbol: "EURUSD",
      side: "buy",
      quantity: 0.1,
      orderType: "CloseBy",
      timeInForce: "IOC",
    }),
  );
  assert.throws(() => t.placeOrderPlanSchema.parse({ orderType: "CloseBy" }));
  // the vestigial close-machinery fields are gone from the commit schema
  assert.ok(!("positionId" in t.placeOrderSchema.shape));
  assert.ok(!("positionById" in t.placeOrderSchema.shape));
  // hedged closes still have their dedicated home
  assert.doesNotThrow(() => t.closeByPlanSchema.parse({ positionId: 1, positionById: 2 }));
});

test("placeOrder POSTs /order with terse keys, no A, no mc", async () => {
  await t.placeOrder(client(), {
    symbol: "EURUSD",
    side: "buy",
    quantity: 0.1,
    orderType: "Market",
    timeInForce: "IOC",
  });
  assert.equal(captured[0].url, "http://ts/api/v1/order");
  assert.equal(captured[0].method, "POST");
  assert.deepEqual(JSON.parse(captured[0].body!), {
    s: "EURUSD",
    q: 0.1,
    S: "buy",
    t: "Market",
    tif: "IOC",
  });
});

test("modifyOrder PUTs /order", async () => {
  await t.modifyOrder(client(), { orderId: 7, limitPrice: 1.1 });
  assert.equal(captured[0].method, "PUT");
  assert.equal(captured[0].url, "http://ts/api/v1/order");
  assert.deepEqual(JSON.parse(captured[0].body!), { id: 7, lp: 1.1 });
});

test("cancelOrder DELETEs /order/{id}", async () => {
  await t.cancelOrder(client(), { orderId: 42 });
  assert.equal(captured[0].method, "DELETE");
  assert.equal(captured[0].url, "http://ts/api/v1/order/42");
});

test("modifyOrderSltp PUTs /order/sltp with id key", async () => {
  await t.modifyOrderSltp(client(), { orderId: 5, stopLoss: 1.05 });
  assert.equal(captured[0].url, "http://ts/api/v1/order/sltp");
  assert.deepEqual(JSON.parse(captured[0].body!), { id: 5, sl: 1.05 });
});

test("modifyPositionSltp PUTs /sltp", async () => {
  await t.modifyPositionSltp(client(), { positionId: 9, takeProfit: 1.2 });
  assert.equal(captured[0].url, "http://ts/api/v1/sltp");
  assert.deepEqual(JSON.parse(captured[0].body!), { id: 9, tp: 1.2 });
});

test("modifyPositionSltp maps 0 to omission: sl 0 + tp 1.2 sends {id, tp} only", async () => {
  // Sending sl:0 to the server does NOT remove the SL — it creates a
  // zero-priced working order (verified live). Removal = omitting the field.
  await t.modifyPositionSltp(client(), { positionId: 9, stopLoss: 0, takeProfit: 1.2 });
  assert.deepEqual(JSON.parse(captured[0].body!), { id: 9, tp: 1.2 });
});

test("modifyPositionSltp with both 0 sends {id} only, which removes both sides", async () => {
  await t.modifyPositionSltp(client(), { positionId: 9, stopLoss: 0, takeProfit: 0 });
  assert.deepEqual(JSON.parse(captured[0].body!), { id: 9 });
});

test("getOpenPositions POSTs /positions with camelCase filter", async () => {
  respond = () => ({ positions: [] });
  await t.getOpenPositions(client(), { symbol: "EURUSD" });
  assert.equal(captured[0].url, "http://ts/api/v1/positions");
  assert.deepEqual(JSON.parse(captured[0].body!), { symbolName: "EURUSD" });
});

test("closePosition finds position then places opposite IOC market order with pi", async () => {
  respond = (url) =>
    url.endsWith("/positions") ? { positions: [{ id: 3, s: "EURUSD", S: "buy", q: 2 }] } : {};
  await t.closePosition(client(), { positionId: 3 });
  assert.equal(captured.length, 2);
  assert.deepEqual(JSON.parse(captured[1].body!), {
    s: "EURUSD",
    q: 2,
    S: "sell",
    t: "Market",
    tif: "IOC",
    pi: 3,
  });
});

test("closeBy validates same symbol opposite sides and posts CloseBy", async () => {
  respond = (url) =>
    url.endsWith("/positions")
      ? {
          positions: [
            { id: 1, s: "EURUSD", S: "buy", q: 2 },
            { id: 2, s: "EURUSD", S: "sell", q: 1 },
          ],
        }
      : {};
  await t.closeBy(client(), { positionId: 1, positionById: 2 });
  const body = JSON.parse(captured[1].body!);
  assert.equal(body.t, "CloseBy");
  assert.equal(body.q, 1); // min of the two
  assert.equal(body.pi, 1);
  assert.equal(body.pbi, 2);
});

test("cancelAllOrders lists then deletes each", async () => {
  respond = (url, method) =>
    method === "POST" && url.endsWith("/orders/open")
      ? {
          orders: [
            { id: 1, s: "EURUSD" },
            { id: 2, s: "GBPUSD" },
          ],
        }
      : {};
  const res = (await t.cancelAllOrders(client(), { symbol: "EURUSD" })) as { cancelled: number };
  assert.equal(res.cancelled, 1); // client-side symbol filter
  assert.ok(captured.some((c) => c.method === "DELETE" && c.url.endsWith("/order/1")));
  assert.ok(!captured.some((c) => c.url.endsWith("/order/2")));
});

test("getTradeHistory POSTs /trades with from/to passthrough", async () => {
  await t.getTradeHistory(client(), { from: 1, to: 2, limit: 10 });
  assert.equal(captured[0].url, "http://ts/api/v1/trades");
  assert.deepEqual(JSON.parse(captured[0].body!), { from: 1, to: 2, maxResults: 10 });
});

test("getWorkingOrders and getOrderHistory hit /orders/open and /orders/completed", async () => {
  await t.getWorkingOrders(client(), {});
  await t.getOrderHistory(client(), { symbol: "GBPUSD" });
  assert.equal(captured[0].url, "http://ts/api/v1/orders/open");
  assert.equal(captured[1].url, "http://ts/api/v1/orders/completed");
  assert.deepEqual(JSON.parse(captured[1].body!), { symbolName: "GBPUSD" });
});

test("closeAllPositions closes every (filtered) position", async () => {
  respond = (url) =>
    url.endsWith("/positions")
      ? {
          positions: [
            { id: 1, s: "EURUSD", S: "buy", q: 1 },
            { id: 2, s: "GBPUSD", S: "sell", q: 2 },
          ],
        }
      : {};
  const res = (await t.closeAllPositions(client(), {})) as { closed: number };
  assert.equal(res.closed, 2);
});

test("closePosition partial quantity is sent as-is, undefined falls back to full position size", async () => {
  respond = (url) =>
    url.endsWith("/positions") ? { positions: [{ id: 3, s: "EURUSD", S: "buy", q: 2 }] } : {};
  await t.closePosition(client(), { positionId: 3, quantity: 0.5 });
  assert.equal(JSON.parse(captured[1].body!).q, 0.5);

  captured = [];
  await t.closePosition(client(), { positionId: 3 });
  assert.equal(JSON.parse(captured[1].body!).q, 2); // zero-protection: full size, not 0/undefined
});

test("closePosition rejects when position not found, no order placed", async () => {
  respond = (url) => (url.endsWith("/positions") ? { positions: [] } : {});
  await assert.rejects(() => t.closePosition(client(), { positionId: 99 }), /not found/);
  assert.ok(!captured.some((c) => c.url.endsWith("/order")));
});

test("closeBy rejects on symbol mismatch, no order placed", async () => {
  respond = (url) =>
    url.endsWith("/positions")
      ? {
          positions: [
            { id: 1, s: "EURUSD", S: "buy", q: 1 },
            { id: 2, s: "GBPUSD", S: "sell", q: 1 },
          ],
        }
      : {};
  await assert.rejects(
    () => t.closeBy(client(), { positionId: 1, positionById: 2 }),
    /same symbol/,
  );
  assert.ok(!captured.some((c) => c.url.endsWith("/order")));
});

test("closeBy rejects when both positions are on the same side, no order placed", async () => {
  respond = (url) =>
    url.endsWith("/positions")
      ? {
          positions: [
            { id: 1, s: "EURUSD", S: "buy", q: 1 },
            { id: 2, s: "EURUSD", S: "buy", q: 1 },
          ],
        }
      : {};
  await assert.rejects(
    () => t.closeBy(client(), { positionId: 1, positionById: 2 }),
    /opposite sides/,
  );
  assert.ok(!captured.some((c) => c.url.endsWith("/order")));
});

test("closeBy rejects when pbi position missing, no order placed", async () => {
  respond = (url) =>
    url.endsWith("/positions") ? { positions: [{ id: 1, s: "EURUSD", S: "buy", q: 1 }] } : {};
  await assert.rejects(() => t.closeBy(client(), { positionId: 1, positionById: 2 }), /not found/);
  assert.ok(!captured.some((c) => c.url.endsWith("/order")));
});

test("cancelAllOrders reports per-item failure and keeps going", async () => {
  globalThis.fetch = (async (url: any, init: any) => {
    const u = String(url);
    captured.push({ url: u, method: init?.method ?? "GET", body: init?.body });
    if (init?.method === "POST" && u.endsWith("/orders/open")) {
      return new Response(
        JSON.stringify({
          orders: [
            { id: 1, s: "EURUSD" },
            { id: 2, s: "EURUSD" },
          ],
        }),
        { status: 200 },
      );
    }
    if (u.endsWith("/order/1")) return new Response('{"error":"boom"}', { status: 500 });
    return new Response("{}", { status: 200 });
  }) as any;
  const res = (await t.cancelAllOrders(client(), {})) as {
    cancelled: number;
    total: number;
    results: Array<{ status: string }>;
  };
  assert.equal(res.cancelled, 1);
  assert.equal(res.total, 2);
  assert.ok(res.results[0].status.startsWith("failed:"));
  assert.equal(res.results[1].status, "cancelled");
});

test("closeAllPositions with symbol filter only closes matching positions", async () => {
  respond = (url) =>
    url.endsWith("/positions")
      ? {
          positions: [
            { id: 1, s: "EURUSD", S: "buy", q: 1 },
            { id: 2, s: "GBPUSD", S: "sell", q: 2 },
          ],
        }
      : {};
  const res = (await t.closeAllPositions(client(), { symbol: "GBPUSD" })) as { closed: number };
  assert.equal(res.closed, 1);
  const orderCalls = captured.filter((c) => c.url.endsWith("/order"));
  assert.equal(orderCalls.length, 1);
  assert.equal(JSON.parse(orderCalls[0].body!).pi, 2);
});

test("placeOrder maps every optional field to its terse key", async () => {
  await t.placeOrder(client(), {
    symbol: "EURUSD",
    side: "buy",
    quantity: 0.1,
    orderType: "StopLimit",
    timeInForce: "GTC",
    limitPrice: 1.1,
    stopPrice: 1.2,
    stopLoss: 1.05,
    takeProfit: 1.3,
    comment: "hi",
  });
  assert.deepEqual(JSON.parse(captured[0].body!), {
    s: "EURUSD",
    q: 0.1,
    S: "buy",
    t: "StopLimit",
    tif: "GTC",
    lp: 1.1,
    sp: 1.2,
    sl: 1.05,
    tp: 1.3,
    ct: "hi",
  });
});

test("placeOrder does NOT retry on connection error (duplicate-fill protection)", async () => {
  globalThis.fetch = (async (url: any, init: any) => {
    captured.push({ url: String(url), method: init?.method ?? "GET", body: init?.body });
    throw new TypeError("fetch failed");
  }) as any;
  await assert.rejects(
    () =>
      t.placeOrder(client(), {
        symbol: "EURUSD",
        side: "buy",
        quantity: 0.1,
        orderType: "Market",
        timeInForce: "IOC",
      }),
    /fetch failed/,
  );
  assert.equal(captured.length, 1); // no second submission
});

test("modifyOrder still retries once on connection error (idempotent PUT)", async () => {
  globalThis.fetch = (async (url: any, init: any) => {
    captured.push({ url: String(url), method: init?.method ?? "GET", body: init?.body });
    if (captured.length === 1) throw new TypeError("fetch failed");
    return new Response("{}", { status: 200 });
  }) as any;
  await t.modifyOrder(client(), { orderId: 7, limitPrice: 1.1 });
  assert.equal(captured.length, 2);
});

// ===== place_order preview/commit (E1a) =====
test("place_order_plan returns a preview + commitToken and does NOT call /order", async () => {
  let orderCalls = 0;
  const fake = {
    get: async () => ({ s: "EURUSD", bp: 1.1, ap: 1.1003 }),
    post: async (path: string) => {
      if (path === "/order") orderCalls++;
      return path === "/account/state" ? { e: 8968, m: 909 } : {};
    },
  } as never;
  const r = (await t.placeOrderPlan(fake, {
    symbol: "EURUSD",
    side: "buy",
    quantity: 0.1,
    orderType: "Market",
    timeInForce: "IOC",
  })) as { commitToken?: string; preview?: { summary: string }; disclosure?: string };
  assert.equal(orderCalls, 0); // plan must never execute
  assert.ok(r.commitToken);
  assert.match(r.preview!.summary, /BUY 0.1 EURUSD/i);
  assert.ok(r.disclosure);
});

test("place_order_plan reports missing fields instead of guessing", async () => {
  const fake = { get: async () => ({}), post: async () => ({}) } as never;
  const r = (await t.placeOrderPlan(fake, {
    symbol: "EURUSD",
    side: "buy",
    quantity: 0.1,
  })) as { needMoreInfo?: string };
  assert.ok(r.needMoreInfo);
  assert.match(r.needMoreInfo!, /order type/);
  assert.match(r.needMoreInfo!, /time-in-force/);
});

test("place_order_commit runs the stored order exactly once, then rejects reuse", async () => {
  let body: Record<string, unknown> | undefined;
  const fake = {
    get: async () => ({ s: "EURUSD", bp: 1.1, ap: 1.1003 }),
    post: async (path: string, b: Record<string, unknown>) => {
      if (path === "/order") {
        body = b;
        return { ok: true };
      }
      return path === "/account/state" ? { e: 1, m: 0 } : {};
    },
  } as never;
  const plan = (await t.placeOrderPlan(fake, {
    symbol: "EURUSD",
    side: "buy",
    quantity: 0.1,
    orderType: "Market",
    timeInForce: "IOC",
  })) as { commitToken: string };
  await t.placeOrderCommit(fake, { commitToken: plan.commitToken });
  assert.equal(body!.s, "EURUSD");
  assert.equal(body!.S, "buy");
  // single-use: a second commit with the same token must reject
  await assert.rejects(
    t.placeOrderCommit(fake, { commitToken: plan.commitToken }),
    /No pending order/,
  );
});

// ===== close_position / close_by / close_all_positions preview/commit (E1a) =====
test("close_position_plan previews + tokenizes without closing; missing positionId asks", async () => {
  let writes = 0;
  const fake = {
    get: async () => ({}),
    post: async (path: string) => {
      if (path === "/order" || path === "/positions") writes++;
      return path === "/account/state" ? { e: 1, m: 0 } : {};
    },
  } as never;
  const ok = (await t.closePositionPlan(fake, { positionId: 3 })) as {
    commitToken?: string;
    preview?: { summary: string };
  };
  assert.ok(ok.commitToken);
  assert.match(ok.preview!.summary, /Close position 3/);
  assert.equal(writes, 0); // plan must not query positions or place the closing order
  const miss = (await t.closePositionPlan(fake, {})) as { needMoreInfo?: string };
  assert.match(miss.needMoreInfo!, /position ID/);
});

test("close_position_commit closes the stored position once, then rejects reuse", async () => {
  const fake = {
    get: async () => ({}),
    post: async (path: string) => {
      if (path === "/positions") return { positions: [{ id: 3, s: "EURUSD", S: "buy", q: 2 }] };
      return path === "/account/state" ? { e: 1, m: 0 } : {};
    },
  } as never;
  const plan = (await t.closePositionPlan(fake, { positionId: 3 })) as { commitToken: string };
  await t.closePositionCommit(fake, { commitToken: plan.commitToken }); // executes without throwing
  await assert.rejects(
    t.closePositionCommit(fake, { commitToken: plan.commitToken }),
    /No pending order/,
  );
});

test("close_by_plan requires both ids then tokenizes", async () => {
  const fake = { get: async () => ({}), post: async () => ({ e: 1, m: 0 }) } as never;
  const miss = (await t.closeByPlan(fake, { positionId: 1 })) as { needMoreInfo?: string };
  assert.match(miss.needMoreInfo!, /opposite position ID/);
  const ok = (await t.closeByPlan(fake, { positionId: 1, positionById: 2 })) as {
    commitToken?: string;
    preview?: { summary: string };
  };
  assert.ok(ok.commitToken);
  assert.match(ok.preview!.summary, /Close position 1 against 2/);
});

test("close_by_commit executes once, then rejects reuse", async () => {
  const fake = {
    get: async () => ({}),
    post: async (path: string) => {
      if (path === "/positions")
        return {
          positions: [
            { id: 1, s: "EURUSD", S: "buy", q: 2 },
            { id: 2, s: "EURUSD", S: "sell", q: 1 },
          ],
        };
      return path === "/account/state" ? { e: 1, m: 0 } : {};
    },
  } as never;
  const plan = (await t.closeByPlan(fake, { positionId: 1, positionById: 2 })) as {
    commitToken: string;
  };
  await t.closeByCommit(fake, { commitToken: plan.commitToken });
  await assert.rejects(
    t.closeByCommit(fake, { commitToken: plan.commitToken }),
    /No pending order/,
  );
});

test("close_all_positions_plan tokenizes with a high-impact disclosure (no required fields)", async () => {
  const fake = { get: async () => ({}), post: async () => ({ e: 1, m: 0 }) } as never;
  const r = (await t.closeAllPositionsPlan(fake, {})) as {
    commitToken?: string;
    preview?: { summary: string };
    disclosure?: string;
  };
  assert.ok(r.commitToken);
  assert.match(r.preview!.summary, /Close ALL/i);
  assert.match(r.disclosure!, /ALL/);
});

test("close_all_positions_commit executes once, then rejects reuse", async () => {
  const fake = {
    get: async () => ({}),
    post: async (path: string) => {
      if (path === "/positions") return { positions: [{ id: 1, s: "EURUSD", S: "buy", q: 1 }] };
      return path === "/account/state" ? { e: 1, m: 0 } : {};
    },
  } as never;
  const plan = (await t.closeAllPositionsPlan(fake, {})) as { commitToken: string };
  await t.closeAllPositionsCommit(fake, { commitToken: plan.commitToken });
  await assert.rejects(
    t.closeAllPositionsCommit(fake, { commitToken: plan.commitToken }),
    /No pending order/,
  );
});
