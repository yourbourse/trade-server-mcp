import { z } from "zod";
import { ApiError, RestClient } from "../../rest-client.js";
import { issuePlan, takeCommit } from "../../preview/plan-commit.js";
import { buildOrderPreview } from "../../preview/order-preview.js";
import { completenessMessage, orderPriceCompleteness } from "../../validation.js";

// Order placement is non-idempotent: a connection reset does not prove the
// server never received the order, so a transport-level retry could fill twice.
const NO_TRANSPORT_RETRY = { retryOnConnectionError: false };

// ===== place_order =====
export const placeOrderSchema = z.object({
  symbol: z.string().describe("Symbol name, e.g. EURUSD"),
  side: z.enum(["buy", "sell"]).describe("Order side"),
  quantity: z.number().positive().describe("Volume in lots, e.g. 0.1"),
  orderType: z.enum(["Market", "Limit", "Stop", "StopLimit"]).describe("Order type"),
  timeInForce: z
    .enum(["FOK", "IOC", "GTC", "GTD", "Day", "Ms"])
    .describe("Time in force. Use IOC or FOK for Market orders"),
  limitPrice: z.number().optional().describe("Limit price (for Limit/StopLimit)"),
  stopPrice: z.number().optional().describe("Stop price (for Stop/StopLimit)"),
  stopLoss: z.number().optional().describe("Stop loss price"),
  takeProfit: z.number().optional().describe("Take profit price"),
  comment: z.string().optional().describe("Order comment"),
});

export async function placeOrder(client: RestClient, params: z.infer<typeof placeOrderSchema>) {
  const body: Record<string, unknown> = {
    s: params.symbol,
    q: params.quantity,
    S: params.side,
    t: params.orderType,
    tif: params.timeInForce,
  };
  if (params.limitPrice !== undefined) body.lp = params.limitPrice;
  if (params.stopPrice !== undefined) body.sp = params.stopPrice;
  if (params.stopLoss !== undefined) body.sl = params.stopLoss;
  if (params.takeProfit !== undefined) body.tp = params.takeProfit;
  if (params.comment !== undefined) body.ct = params.comment;
  return client.post("/order", body, NO_TRANSPORT_RETRY);
}

// ===== place_order preview/commit (E1a: confirm-before-execute) =====
// place_order_plan validates + previews + issues a single-use token WITHOUT executing;
// place_order_commit consumes the token and runs the unchanged placeOrder() above.
export const placeOrderPlanSchema = z.object({
  symbol: z.string().optional().describe("Symbol name, e.g. EURUSD"),
  side: z.enum(["buy", "sell"]).optional().describe("Order side"),
  quantity: z.number().positive().optional().describe("Volume in lots, e.g. 0.1"),
  orderType: z.enum(["Market", "Limit", "Stop", "StopLimit"]).optional().describe("Order type"),
  timeInForce: z
    .enum(["FOK", "IOC", "GTC", "GTD", "Day", "Ms"])
    .optional()
    .describe("Time in force. Use IOC or FOK for Market orders"),
  limitPrice: z.number().optional().describe("Limit price (for Limit/StopLimit)"),
  stopPrice: z.number().optional().describe("Stop price (for Stop/StopLimit)"),
  stopLoss: z.number().optional().describe("Stop loss price"),
  takeProfit: z.number().optional().describe("Take profit price"),
  comment: z.string().optional().describe("Order comment"),
});

const PLACE_ORDER_DISCLOSURE =
  "You are confirming a LIVE order placed via an AI assistant. Review the details, then call place_order_commit with this commitToken to execute. Nothing is sent until you commit.";

export async function placeOrderPlan(
  client: RestClient,
  params: z.infer<typeof placeOrderPlanSchema>,
) {
  const need = completenessMessage("place_order_plan", params, [
    { name: "symbol", label: "symbol" },
    { name: "side", label: "side", options: ["buy", "sell"] },
    { name: "quantity", label: "quantity (lots)" },
    { name: "orderType", label: "order type", options: ["Market", "Limit", "Stop", "StopLimit"] },
    {
      name: "timeInForce",
      label: "time-in-force",
      options: ["IOC", "FOK", "GTC", "GTD", "Day", "Ms"],
    },
  ]);
  if (need) return { needMoreInfo: need };
  const priceNeed = orderPriceCompleteness("place_order_plan", params);
  if (priceNeed) return { needMoreInfo: priceNeed };
  const preview = await buildOrderPreview(client, {
    action: "place",
    symbol: params.symbol,
    side: params.side,
    quantity: params.quantity,
    orderType: params.orderType,
    timeInForce: params.timeInForce,
    limitPrice: params.limitPrice,
    stopPrice: params.stopPrice,
    stopLoss: params.stopLoss,
    takeProfit: params.takeProfit,
  });
  const commitToken = issuePlan(params);
  return { preview, commitToken, disclosure: PLACE_ORDER_DISCLOSURE };
}

export const placeOrderCommitSchema = z.object({
  commitToken: z.string().describe("The commitToken returned by place_order_plan"),
});

export async function placeOrderCommit(
  client: RestClient,
  params: z.infer<typeof placeOrderCommitSchema>,
) {
  const raw = takeCommit(params.commitToken);
  // DA fix #4: re-validate the stored order before executing (plan already gated completeness).
  const order = placeOrderSchema.parse(raw);
  return placeOrder(client, order);
}

// ===== modify_order =====
export const modifyOrderSchema = z.object({
  orderId: z.number().describe("Order ID to modify"),
  quantity: z.number().optional().describe("New remaining quantity in lots"),
  limitPrice: z.number().optional().describe("New limit price"),
  stopPrice: z.number().optional().describe("New stop price"),
});

export async function modifyOrder(client: RestClient, params: z.infer<typeof modifyOrderSchema>) {
  const body: Record<string, unknown> = { id: params.orderId };
  if (params.quantity !== undefined) body.q = params.quantity;
  if (params.limitPrice !== undefined) body.lp = params.limitPrice;
  if (params.stopPrice !== undefined) body.sp = params.stopPrice;
  return client.put("/order", body);
}

// ===== cancel_order =====
export const cancelOrderSchema = z.object({
  orderId: z.number().describe("Order ID to cancel"),
});

export async function cancelOrder(client: RestClient, params: z.infer<typeof cancelOrderSchema>) {
  return client.delete(`/order/${params.orderId}`);
}

// ===== modify_order_sltp =====
export const modifyOrderSltpSchema = z.object({
  orderId: z.number().describe("Order ID to modify"),
  stopLoss: z.number().optional().describe("New stop loss price. Omit to cancel existing SL."),
  takeProfit: z.number().optional().describe("New take profit price. Omit to cancel existing TP."),
});

export async function modifyOrderSltp(
  client: RestClient,
  params: z.infer<typeof modifyOrderSltpSchema>,
) {
  const body: Record<string, unknown> = { id: params.orderId };
  if (params.stopLoss !== undefined) body.sl = params.stopLoss;
  if (params.takeProfit !== undefined) body.tp = params.takeProfit;
  return client.put("/order/sltp", body);
}

// ===== modify_position_sltp =====
export const modifyPositionSltpSchema = z.object({
  positionId: z.number().describe("Position ID"),
  stopLoss: z.number().optional().describe("New stop loss price (0 or omit to remove)"),
  takeProfit: z.number().optional().describe("New take profit price (0 or omit to remove)"),
});

export async function modifyPositionSltp(
  client: RestClient,
  params: z.infer<typeof modifyPositionSltpSchema>,
) {
  // Server semantics (verified live): OMITTING sl/tp from the body removes
  // that side; sending sl:0/tp:0 does NOT remove — it creates zero-priced
  // working orders. So 0 ("remove" in the tool UX) maps to omission, and a
  // call with neither field sends {id} only, which removes BOTH sides.
  const body: Record<string, unknown> = { id: params.positionId };
  if (params.stopLoss !== undefined && params.stopLoss !== 0) body.sl = params.stopLoss;
  if (params.takeProfit !== undefined && params.takeProfit !== 0) body.tp = params.takeProfit;
  return client.put("/sltp", body);
}

// ===== read filters (shared shape) =====
const historyFilter = {
  symbol: z.string().optional().describe("Filter by symbol"),
  from: z.number().optional().describe("Start time (microseconds since epoch)"),
  to: z.number().optional().describe("End time (microseconds since epoch)"),
  limit: z.number().optional().describe("Max results to return"),
};

function filterBody(params: { symbol?: string; from?: number; to?: number; limit?: number }) {
  const body: Record<string, unknown> = {};
  if (params.symbol !== undefined) body.symbolName = params.symbol;
  if (params.from !== undefined) body.from = params.from;
  if (params.to !== undefined) body.to = params.to;
  if (params.limit !== undefined) body.maxResults = params.limit;
  return body;
}

// ===== get_working_orders =====
export const getWorkingOrdersSchema = z.object({
  symbol: z.string().optional().describe("Filter by symbol"),
  limit: z.number().optional().describe("Max results to return"),
});

export async function getWorkingOrders(
  client: RestClient,
  params: z.infer<typeof getWorkingOrdersSchema>,
) {
  return client.post("/orders/open", filterBody(params));
}

// ===== get_order_history =====
export const getOrderHistorySchema = z.object(historyFilter);

export async function getOrderHistory(
  client: RestClient,
  params: z.infer<typeof getOrderHistorySchema>,
) {
  return client.post("/orders/completed", filterBody(params));
}

// ===== get_open_positions =====
export const getOpenPositionsSchema = z.object({
  symbol: z.string().optional().describe("Filter by symbol"),
  limit: z.number().optional().describe("Max results to return"),
});

export async function getOpenPositions(
  client: RestClient,
  params: z.infer<typeof getOpenPositionsSchema>,
) {
  return client.post("/positions", filterBody(params));
}

// ===== get_trade_history =====
export const getTradeHistorySchema = z.object(historyFilter);

export async function getTradeHistory(
  client: RestClient,
  params: z.infer<typeof getTradeHistorySchema>,
) {
  return client.post("/trades", filterBody(params));
}

// ===== composites =====
type Position = { id: number; s: string; S: string; q: number };

async function queryPositions(client: RestClient): Promise<Position[]> {
  // Explicit large page size — avoid server default page limits hiding
  // positions from the close composites below.
  const result = (await client.post("/positions", { maxResults: 1000 })) as {
    positions?: Position[];
  };
  return result.positions ?? [];
}

export const closePositionSchema = z.object({
  positionId: z.number().describe("Position ID to close"),
  quantity: z
    .number()
    .positive()
    .optional()
    .describe("Partial close volume in lots. Omit for full close"),
});

export async function closePosition(
  client: RestClient,
  params: z.infer<typeof closePositionSchema>,
) {
  // Position state may change between this query and the close order (TOCTOU);
  // the server is the final authority on whether the close is still valid.
  const positions = await queryPositions(client);
  const position = positions.find((p) => p.id === params.positionId);
  if (!position) throw new Error(`Position ${params.positionId} not found`);
  try {
    return await client.post(
      "/order",
      {
        s: position.s,
        q: params.quantity ?? position.q,
        S: position.S === "buy" ? "sell" : "buy",
        t: "Market",
        tif: "IOC",
        pi: params.positionId,
      },
      NO_TRANSPORT_RETRY,
    );
  } catch (err) {
    if (err instanceof ApiError) {
      throw new Error(`close_position for position ${params.positionId}: ${err.message}`);
    }
    throw err;
  }
}

export const closeBySchema = z.object({
  positionId: z.number().describe("Position ID to close"),
  positionById: z.number().describe("Opposite position ID to close against"),
});

export async function closeBy(client: RestClient, params: z.infer<typeof closeBySchema>) {
  // Position state may change between this query and the order (TOCTOU);
  // the server is the final authority on whether the close-by is still valid.
  const positions = await queryPositions(client);
  const a = positions.find((p) => p.id === params.positionId);
  if (!a) throw new Error(`Position ${params.positionId} not found`);
  const b = positions.find((p) => p.id === params.positionById);
  if (!b) throw new Error(`Position ${params.positionById} not found`);
  if (a.s !== b.s) throw new Error(`Positions must be on the same symbol (got ${a.s} and ${b.s})`);
  if (a.S === b.S) throw new Error(`Positions must be on opposite sides (both are ${a.S})`);
  try {
    return await client.post(
      "/order",
      {
        s: a.s,
        q: Math.min(a.q, b.q),
        S: a.S === "buy" ? "sell" : "buy",
        t: "CloseBy",
        tif: "IOC",
        pi: params.positionId,
        pbi: params.positionById,
      },
      NO_TRANSPORT_RETRY,
    );
  } catch (err) {
    if (err instanceof ApiError) {
      throw new Error(
        `close_by for positions ${params.positionId}/${params.positionById}: ${err.message}`,
      );
    }
    throw err;
  }
}

export const cancelAllOrdersSchema = z.object({
  symbol: z.string().optional().describe("Only cancel orders for this symbol"),
});

export async function cancelAllOrders(
  client: RestClient,
  params: z.infer<typeof cancelAllOrdersSchema>,
) {
  const result = (await client.post("/orders/open", {})) as {
    orders?: Array<{ id: number; s: string }>;
  };
  let orders = result.orders ?? [];
  if (params.symbol) orders = orders.filter((o) => o.s === params.symbol);
  if (orders.length === 0) return { cancelled: 0, message: "No working orders found" };
  const results: Array<{ orderId: number; symbol: string; status: string }> = [];
  for (const order of orders) {
    try {
      await client.delete(`/order/${order.id}`);
      results.push({ orderId: order.id, symbol: order.s, status: "cancelled" });
    } catch (e) {
      results.push({
        orderId: order.id,
        symbol: order.s,
        status: `failed: ${e instanceof Error ? e.message : String(e)}`,
      });
    }
  }
  return {
    cancelled: results.filter((r) => r.status === "cancelled").length,
    total: orders.length,
    results,
  };
}

export const closeAllPositionsSchema = z.object({
  symbol: z.string().optional().describe("Only close positions for this symbol"),
});

export async function closeAllPositions(
  client: RestClient,
  params: z.infer<typeof closeAllPositionsSchema>,
) {
  let positions = await queryPositions(client);
  if (params.symbol) positions = positions.filter((p) => p.s === params.symbol);
  if (positions.length === 0) return { closed: 0, message: "No open positions found" };
  const results: Array<{
    positionId: number;
    symbol: string;
    side: string;
    quantity: number;
    status: string;
  }> = [];
  for (const pos of positions) {
    try {
      await client.post(
        "/order",
        {
          s: pos.s,
          q: pos.q,
          S: pos.S === "buy" ? "sell" : "buy",
          t: "Market",
          tif: "IOC",
          pi: pos.id,
        },
        NO_TRANSPORT_RETRY,
      );
      results.push({
        positionId: pos.id,
        symbol: pos.s,
        side: pos.S,
        quantity: pos.q,
        status: "closed",
      });
    } catch (e) {
      results.push({
        positionId: pos.id,
        symbol: pos.s,
        side: pos.S,
        quantity: pos.q,
        status: `failed: ${e instanceof Error ? e.message : String(e)}`,
      });
    }
  }
  return {
    closed: results.filter((r) => r.status === "closed").length,
    total: positions.length,
    results,
  };
}

// ===== close_position / close_by / close_all_positions preview/commit (E1a) =====
// Same shape as place_order: *_plan validates + previews + tokenizes WITHOUT executing;
// *_commit consumes the token and runs the unchanged close fn above.

export const closePositionPlanSchema = z.object({
  positionId: z.number().optional().describe("Position ID to close"),
  quantity: z
    .number()
    .positive()
    .optional()
    .describe("Partial close volume in lots. Omit for full close"),
});
const CLOSE_POSITION_DISCLOSURE =
  "You are confirming a LIVE position close via an AI assistant. Review the details, then call close_position_commit with this commitToken to execute. Nothing is sent until you commit.";

export async function closePositionPlan(
  client: RestClient,
  params: z.infer<typeof closePositionPlanSchema>,
) {
  const need = completenessMessage("close_position_plan", params, [
    { name: "positionId", label: "position ID" },
  ]);
  if (need) return { needMoreInfo: need };
  const preview = await buildOrderPreview(client, {
    action: "close",
    positionId: params.positionId,
    quantity: params.quantity,
  });
  const commitToken = issuePlan(params);
  return { preview, commitToken, disclosure: CLOSE_POSITION_DISCLOSURE };
}

export const closePositionCommitSchema = z.object({
  commitToken: z.string().describe("The commitToken returned by close_position_plan"),
});

export async function closePositionCommit(
  client: RestClient,
  params: z.infer<typeof closePositionCommitSchema>,
) {
  const order = closePositionSchema.parse(takeCommit(params.commitToken));
  return closePosition(client, order);
}

export const closeByPlanSchema = z.object({
  positionId: z.number().optional().describe("Position ID to close"),
  positionById: z.number().optional().describe("Opposite position ID to close against"),
});
const CLOSE_BY_DISCLOSURE =
  "You are confirming a LIVE hedged close via an AI assistant. Review the details, then call close_by_commit with this commitToken to execute. Nothing is sent until you commit.";

export async function closeByPlan(client: RestClient, params: z.infer<typeof closeByPlanSchema>) {
  const need = completenessMessage("close_by_plan", params, [
    { name: "positionId", label: "position ID" },
    { name: "positionById", label: "opposite position ID" },
  ]);
  if (need) return { needMoreInfo: need };
  const preview = await buildOrderPreview(client, {
    action: "close_by",
    positionId: params.positionId,
    positionById: params.positionById,
  });
  const commitToken = issuePlan(params);
  return { preview, commitToken, disclosure: CLOSE_BY_DISCLOSURE };
}

export const closeByCommitSchema = z.object({
  commitToken: z.string().describe("The commitToken returned by close_by_plan"),
});

export async function closeByCommit(
  client: RestClient,
  params: z.infer<typeof closeByCommitSchema>,
) {
  const order = closeBySchema.parse(takeCommit(params.commitToken));
  return closeBy(client, order);
}

export const closeAllPositionsPlanSchema = z.object({
  symbol: z.string().optional().describe("Only close positions for this symbol"),
});
const CLOSE_ALL_DISCLOSURE =
  "You are confirming that an AI assistant will CLOSE ALL of your open positions (optionally filtered by symbol). This is high-impact — review carefully. Call close_all_positions_commit with this commitToken to execute. Nothing is sent until you commit.";

export async function closeAllPositionsPlan(
  client: RestClient,
  params: z.infer<typeof closeAllPositionsPlanSchema>,
) {
  // No required fields — a token is always issued; the disclosure names the blast radius.
  const preview = await buildOrderPreview(client, { action: "close_all", symbol: params.symbol });
  const commitToken = issuePlan(params);
  return { preview, commitToken, disclosure: CLOSE_ALL_DISCLOSURE };
}

export const closeAllPositionsCommitSchema = z.object({
  commitToken: z.string().describe("The commitToken returned by close_all_positions_plan"),
});

export async function closeAllPositionsCommit(
  client: RestClient,
  params: z.infer<typeof closeAllPositionsCommitSchema>,
) {
  const order = closeAllPositionsSchema.parse(takeCommit(params.commitToken));
  return closeAllPositions(client, order);
}
