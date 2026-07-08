import { z } from "zod";
import { RestClient } from "../../rest-client.js";
import { issuePlan, takeCommit } from "../../preview/plan-commit.js";
import { buildOrderPreview } from "../../preview/order-preview.js";
import { completenessMessage, orderPriceCompleteness } from "../../validation.js";

// Order placement is non-idempotent: a connection reset does not prove the
// server never received the order, so a transport-level retry could fill twice.
const NO_TRANSPORT_RETRY = { retryOnConnectionError: false };

export const placeOrderSchema = z.object({
  accountId: z.number().describe("Trading account ID (login)"),
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
  marginCheck: z.boolean().optional().describe("Perform margin check. Default true"),
  comment: z.string().optional().describe("Order comment"),
});

export async function placeOrder(client: RestClient, params: z.infer<typeof placeOrderSchema>) {
  const body: Record<string, unknown> = {
    A: params.accountId,
    s: params.symbol,
    S: params.side,
    q: params.quantity,
    t: params.orderType,
    tif: params.timeInForce,
  };

  if (params.limitPrice !== undefined) body.lp = params.limitPrice;
  if (params.stopPrice !== undefined) body.sp = params.stopPrice;
  if (params.stopLoss !== undefined) body.sl = params.stopLoss;
  if (params.takeProfit !== undefined) body.tp = params.takeProfit;
  if (params.marginCheck !== undefined) body.mc = params.marginCheck;
  if (params.comment !== undefined) body.ct = params.comment;

  return client.post("/admin/orders/edit", body, NO_TRANSPORT_RETRY);
}

export const cancelOrderSchema = z.object({
  accountId: z.number().describe("Trading account ID"),
  orderId: z.number().describe("Order ID to cancel"),
});

export async function cancelOrder(client: RestClient, params: z.infer<typeof cancelOrderSchema>) {
  return client.post("/admin/orders/delete", {
    A: params.accountId,
    id: params.orderId,
  });
}

export const modifyOrderSchema = z.object({
  accountId: z.number().describe("Trading account ID"),
  orderId: z.number().describe("Order ID to modify"),
  quantity: z.number().optional().describe("New remaining quantity in lots"),
  limitPrice: z.number().optional().describe("New limit price"),
  stopPrice: z.number().optional().describe("New stop price"),
});

export async function modifyOrder(client: RestClient, params: z.infer<typeof modifyOrderSchema>) {
  const body: Record<string, unknown> = {
    id: params.orderId,
    A: params.accountId,
  };
  if (params.quantity !== undefined) body.q = params.quantity;
  if (params.limitPrice !== undefined) body.lp = params.limitPrice;
  if (params.stopPrice !== undefined) body.sp = params.stopPrice;

  return client.post("/admin/orders/edit", body);
}

export const getWorkingOrdersSchema = z.object({
  accountId: z.number().optional().describe("Filter by account ID"),
  symbol: z.string().optional().describe("Filter by symbol"),
});

export async function getWorkingOrders(
  client: RestClient,
  params: z.infer<typeof getWorkingOrdersSchema>,
) {
  const body: Record<string, unknown> = {};
  if (params.accountId !== undefined) body.A = params.accountId;
  if (params.symbol !== undefined) body.s = params.symbol;

  return client.post("/admin/orders/active", body);
}

export const getOpenPositionsSchema = z.object({
  accountId: z.number().optional().describe("Filter by account ID"),
  symbol: z.string().optional().describe("Filter by symbol"),
});

export async function getOpenPositions(
  client: RestClient,
  params: z.infer<typeof getOpenPositionsSchema>,
) {
  const body: Record<string, unknown> = {};
  if (params.accountId !== undefined) body.A = params.accountId;
  if (params.symbol !== undefined) body.s = params.symbol;

  return client.post("/admin/positions/query", body);
}

export const closePositionSchema = z.object({
  accountId: z.number().describe("Trading account ID"),
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
  // Get position details first to know symbol and side
  const result = (await client.post("/admin/positions/query", {
    A: params.accountId,
  })) as { positions: Array<{ id: number; s: string; S: string; q: number }> };

  const position = (result.positions || []).find((p) => p.id === params.positionId);
  if (!position) {
    throw new Error(`Position ${params.positionId} not found`);
  }

  // Place opposite market order to close
  const closeSide = position.S === "buy" ? "sell" : "buy";
  const qty = params.quantity ?? position.q;

  return client.post(
    "/admin/orders/edit",
    {
      A: params.accountId,
      s: position.s,
      S: closeSide,
      q: qty,
      t: "Market",
      tif: "IOC",
      pi: params.positionId,
      mc: false,
    },
    NO_TRANSPORT_RETRY,
  );
}

export const modifyPositionSltpSchema = z.object({
  accountId: z.number().describe("Trading account ID"),
  positionId: z.number().describe("Position ID"),
  stopLoss: z.number().optional().describe("New stop loss price (0 to remove)"),
  takeProfit: z.number().optional().describe("New take profit price (0 to remove)"),
});

export async function modifyPositionSltp(
  client: RestClient,
  params: z.infer<typeof modifyPositionSltpSchema>,
) {
  const body: Record<string, unknown> = {
    A: params.accountId,
    id: params.positionId,
  };
  if (params.stopLoss !== undefined) body.sl = params.stopLoss;
  if (params.takeProfit !== undefined) body.tp = params.takeProfit;

  return client.post("/admin/positions/sltp", body);
}

export const getTradeHistorySchema = z.object({
  accountId: z.number().optional().describe("Filter by account ID"),
  symbol: z.string().optional().describe("Filter by symbol"),
  from: z.number().optional().describe("Start time (microseconds since epoch)"),
  to: z.number().optional().describe("End time (microseconds since epoch)"),
  limit: z.number().optional().describe("Max results to return"),
});

export async function getTradeHistory(
  client: RestClient,
  params: z.infer<typeof getTradeHistorySchema>,
) {
  const body: Record<string, unknown> = {};
  if (params.accountId !== undefined) body.A = params.accountId;
  if (params.symbol !== undefined) body.s = params.symbol;
  if (params.from !== undefined) body.from = params.from;
  if (params.to !== undefined) body.to = params.to;
  if (params.limit !== undefined) body.limit = params.limit;

  return client.post("/admin/trades/query", body);
}

export const getOrderHistorySchema = z.object({
  accountId: z.number().optional().describe("Filter by account ID"),
  symbol: z.string().optional().describe("Filter by symbol"),
  from: z.number().optional().describe("Start time (microseconds since epoch)"),
  to: z.number().optional().describe("End time (microseconds since epoch)"),
  limit: z.number().optional().describe("Max results to return"),
});

export async function getOrderHistory(
  client: RestClient,
  params: z.infer<typeof getOrderHistorySchema>,
) {
  const body: Record<string, unknown> = {};
  if (params.accountId !== undefined) body.A = params.accountId;
  if (params.symbol !== undefined) body.s = params.symbol;
  if (params.from !== undefined) body.from = params.from;
  if (params.to !== undefined) body.to = params.to;
  if (params.limit !== undefined) body.limit = params.limit;

  return client.post("/admin/orders/history", body);
}

// === ORDER SL/TP MODIFICATION ===

export const modifyOrderSltpSchema = z.object({
  accountId: z.number().describe("Trading account ID"),
  orderId: z.number().describe("Order ID to modify"),
  stopLoss: z.number().optional().describe("New stop loss price. Omit to cancel existing SL."),
  takeProfit: z.number().optional().describe("New take profit price. Omit to cancel existing TP."),
});

export async function modifyOrderSltp(
  client: RestClient,
  params: z.infer<typeof modifyOrderSltpSchema>,
) {
  const body: Record<string, unknown> = {
    A: params.accountId,
    id: params.orderId,
  };
  if (params.stopLoss !== undefined) body.sl = params.stopLoss;
  if (params.takeProfit !== undefined) body.tp = params.takeProfit;

  return client.post("/admin/orders/sltp", body);
}

// === BULK OPERATIONS ===

export const cancelAllOrdersSchema = z.object({
  accountId: z.number().describe("Trading account ID"),
  symbol: z.string().optional().describe("Only cancel orders for this symbol"),
});

export async function cancelAllOrders(
  client: RestClient,
  params: z.infer<typeof cancelAllOrdersSchema>,
) {
  // Always fetch all orders for the account (server-side symbol filter is unreliable)
  const result = (await client.post("/admin/orders/active", { A: params.accountId })) as {
    orders: Array<{ id: number; s: string; st: string }>;
  };

  let orders = result.orders || [];

  // Client-side symbol filter
  if (params.symbol) {
    orders = orders.filter((o) => o.s === params.symbol);
  }

  if (orders.length === 0) {
    return { cancelled: 0, message: "No working orders found" };
  }

  const results: Array<{ orderId: number; symbol: string; status: string }> = [];
  for (const order of orders) {
    try {
      await client.post("/admin/orders/delete", { A: params.accountId, id: order.id });
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
  accountId: z.number().describe("Trading account ID"),
  symbol: z.string().optional().describe("Only close positions for this symbol"),
});

export async function closeAllPositions(
  client: RestClient,
  params: z.infer<typeof closeAllPositionsSchema>,
) {
  // Always fetch all positions for the account (server-side symbol filter is unreliable)
  const result = (await client.post("/admin/positions/query", { A: params.accountId })) as {
    positions: Array<{ id: number; s: string; S: string; q: number }>;
  };

  let positions = result.positions || [];

  // Client-side symbol filter
  if (params.symbol) {
    positions = positions.filter((p) => p.s === params.symbol);
  }

  if (positions.length === 0) {
    return { closed: 0, message: "No open positions found" };
  }

  const results: Array<{
    positionId: number;
    symbol: string;
    side: string;
    quantity: number;
    status: string;
  }> = [];
  for (const pos of positions) {
    try {
      const closeSide = pos.S === "buy" ? "sell" : "buy";
      await client.post(
        "/admin/orders/edit",
        {
          A: params.accountId,
          s: pos.s,
          S: closeSide,
          q: pos.q,
          t: "Market",
          tif: "IOC",
          pi: pos.id,
          mc: false,
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

export const closeBySchema = z.object({
  accountId: z.number().describe("Trading account ID"),
  positionId: z.number().describe("Position ID to close"),
  positionById: z.number().describe("Opposite position ID to close against"),
});

export async function closeBy(client: RestClient, params: z.infer<typeof closeBySchema>) {
  // Get position details to determine symbol and quantity
  const result = (await client.post("/admin/positions/query", {
    A: params.accountId,
  })) as { positions: Array<{ id: number; s: string; S: string; q: number }> };

  const position = (result.positions || []).find((p) => p.id === params.positionId);
  if (!position) {
    throw new Error(`Position ${params.positionId} not found`);
  }

  const byPosition = (result.positions || []).find((p) => p.id === params.positionById);
  if (!byPosition) {
    throw new Error(`Position ${params.positionById} not found`);
  }

  if (position.s !== byPosition.s) {
    throw new Error(`Positions must be on the same symbol (got ${position.s} and ${byPosition.s})`);
  }

  if (position.S === byPosition.S) {
    throw new Error(`Positions must be on opposite sides (both are ${position.S})`);
  }

  // Use the smaller quantity
  const qty = Math.min(position.q, byPosition.q);

  return client.post(
    "/admin/orders/edit",
    {
      A: params.accountId,
      s: position.s,
      S: position.S === "buy" ? "sell" : "buy",
      q: qty,
      t: "CloseBy",
      tif: "IOC",
      pi: params.positionId,
      pbi: params.positionById,
      mc: false,
    },
    NO_TRANSPORT_RETRY,
  );
}

// ===== money-mover preview/commit (E1a: confirm-before-execute) =====
// *_plan validates + previews + tokenizes WITHOUT executing; *_commit consumes the token and runs
// the unchanged admin execution fn. Preview enrichment hits client-API endpoints (which differ in
// admin mode), so it gracefully degrades to the order echo — which names the target account.

export const placeOrderPlanSchema = z.object({
  accountId: z.number().optional().describe("Trading account ID (login)"),
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
  marginCheck: z.boolean().optional().describe("Perform margin check. Default true"),
  comment: z.string().optional().describe("Order comment"),
});
const PLACE_ORDER_DISCLOSURE =
  "You are confirming a LIVE order placed on a client account via an AI assistant. Review the details, then call place_order_commit with this commitToken to execute. Nothing is sent until you commit.";

export async function placeOrderPlan(
  client: RestClient,
  params: z.infer<typeof placeOrderPlanSchema>,
) {
  const need = completenessMessage("place_order_plan", params, [
    { name: "accountId", label: "account ID" },
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
    accountId: params.accountId,
    symbol: params.symbol,
    side: params.side,
    quantity: params.quantity,
    orderType: params.orderType,
    timeInForce: params.timeInForce,
    limitPrice: params.limitPrice,
    stopPrice: params.stopPrice,
    stopLoss: params.stopLoss,
    takeProfit: params.takeProfit,
    marginCheck: params.marginCheck,
  });
  const commitToken = issuePlan(params, "place_order");
  return { preview, commitToken, disclosure: PLACE_ORDER_DISCLOSURE };
}

export const placeOrderCommitSchema = z.object({
  commitToken: z.string().describe("The commitToken returned by place_order_plan"),
});

export async function placeOrderCommit(
  client: RestClient,
  params: z.infer<typeof placeOrderCommitSchema>,
) {
  return placeOrder(client, placeOrderSchema.parse(takeCommit(params.commitToken, "place_order")));
}

export const closePositionPlanSchema = z.object({
  accountId: z.number().optional().describe("Trading account ID"),
  positionId: z.number().optional().describe("Position ID to close"),
  quantity: z
    .number()
    .positive()
    .optional()
    .describe("Partial close volume in lots. Omit for full close"),
});
const CLOSE_POSITION_DISCLOSURE =
  "You are confirming a LIVE position close on a client account via an AI assistant. Review the details, then call close_position_commit with this commitToken to execute. Nothing is sent until you commit.";

export async function closePositionPlan(
  client: RestClient,
  params: z.infer<typeof closePositionPlanSchema>,
) {
  const need = completenessMessage("close_position_plan", params, [
    { name: "accountId", label: "account ID" },
    { name: "positionId", label: "position ID" },
  ]);
  if (need) return { needMoreInfo: need };
  const preview = await buildOrderPreview(client, {
    action: "close",
    accountId: params.accountId,
    positionId: params.positionId,
    quantity: params.quantity,
  });
  const commitToken = issuePlan(params, "close_position");
  return { preview, commitToken, disclosure: CLOSE_POSITION_DISCLOSURE };
}

export const closePositionCommitSchema = z.object({
  commitToken: z.string().describe("The commitToken returned by close_position_plan"),
});

export async function closePositionCommit(
  client: RestClient,
  params: z.infer<typeof closePositionCommitSchema>,
) {
  return closePosition(
    client,
    closePositionSchema.parse(takeCommit(params.commitToken, "close_position")),
  );
}

export const closeByPlanSchema = z.object({
  accountId: z.number().optional().describe("Trading account ID"),
  positionId: z.number().optional().describe("Position ID to close"),
  positionById: z.number().optional().describe("Opposite position ID to close against"),
});
const CLOSE_BY_DISCLOSURE =
  "You are confirming a LIVE hedged close on a client account via an AI assistant. Review the details, then call close_by_commit with this commitToken to execute. Nothing is sent until you commit.";

export async function closeByPlan(client: RestClient, params: z.infer<typeof closeByPlanSchema>) {
  const need = completenessMessage("close_by_plan", params, [
    { name: "accountId", label: "account ID" },
    { name: "positionId", label: "position ID" },
    { name: "positionById", label: "opposite position ID" },
  ]);
  if (need) return { needMoreInfo: need };
  const preview = await buildOrderPreview(client, {
    action: "close_by",
    accountId: params.accountId,
    positionId: params.positionId,
    positionById: params.positionById,
  });
  const commitToken = issuePlan(params, "close_by");
  return { preview, commitToken, disclosure: CLOSE_BY_DISCLOSURE };
}

export const closeByCommitSchema = z.object({
  commitToken: z.string().describe("The commitToken returned by close_by_plan"),
});

export async function closeByCommit(
  client: RestClient,
  params: z.infer<typeof closeByCommitSchema>,
) {
  return closeBy(client, closeBySchema.parse(takeCommit(params.commitToken, "close_by")));
}

export const closeAllPositionsPlanSchema = z.object({
  accountId: z.number().optional().describe("Trading account ID"),
  symbol: z.string().optional().describe("Only close positions for this symbol"),
});
const CLOSE_ALL_DISCLOSURE =
  "You are confirming that an AI assistant will CLOSE ALL open positions on a client account (optionally filtered by symbol). This is high-impact — review carefully. Call close_all_positions_commit with this commitToken to execute. Nothing is sent until you commit.";

export async function closeAllPositionsPlan(
  client: RestClient,
  params: z.infer<typeof closeAllPositionsPlanSchema>,
) {
  const need = completenessMessage("close_all_positions_plan", params, [
    { name: "accountId", label: "account ID" },
  ]);
  if (need) return { needMoreInfo: need };
  const preview = await buildOrderPreview(client, {
    action: "close_all",
    accountId: params.accountId,
    symbol: params.symbol,
  });
  const commitToken = issuePlan(params, "close_all_positions");
  return { preview, commitToken, disclosure: CLOSE_ALL_DISCLOSURE };
}

export const closeAllPositionsCommitSchema = z.object({
  commitToken: z.string().describe("The commitToken returned by close_all_positions_plan"),
});

export async function closeAllPositionsCommit(
  client: RestClient,
  params: z.infer<typeof closeAllPositionsCommitSchema>,
) {
  return closeAllPositions(
    client,
    closeAllPositionsSchema.parse(takeCommit(params.commitToken, "close_all_positions")),
  );
}

// === FORCE DELETE ===

export const forceDeleteOrderSchema = z.object({
  accountId: z.number().describe("Trading account ID"),
  orderId: z
    .number()
    .describe(
      "Order ID to force-delete (removes stuck/corrupted orders that normal cancel can't remove)",
    ),
});

export async function forceDeleteOrder(
  client: RestClient,
  params: z.infer<typeof forceDeleteOrderSchema>,
) {
  return client.post("/admin/orders/force/delete", {
    A: params.accountId,
    id: params.orderId,
  });
}

// === ACCOUNT SUMMARY ===

export const getAccountSummarySchema = z.object({
  accountId: z.number().describe("Trading account ID"),
});

export async function getAccountSummary(
  client: RestClient,
  params: z.infer<typeof getAccountSummarySchema>,
) {
  const [state, positions, orders] = await Promise.all([
    client.post("/admin/accounts/states/query", { A: [params.accountId] }),
    client.post("/admin/positions/query", { A: params.accountId }),
    client.post("/admin/orders/active", { A: params.accountId }),
  ]);

  return { state, positions, orders };
}
