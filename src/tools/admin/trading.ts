import { z } from "zod";
import { RestClient } from "../../rest-client.js";

// Order placement is non-idempotent: a connection reset does not prove the
// server never received the order, so a transport-level retry could fill twice.
const NO_TRANSPORT_RETRY = { retryOnConnectionError: false };

export const placeOrderSchema = z.object({
  accountId: z.number().describe("Trading account ID (login)"),
  symbol: z.string().describe("Symbol name, e.g. EURUSD"),
  side: z.enum(["buy", "sell"]).describe("Order side"),
  quantity: z.number().positive().describe("Volume in lots, e.g. 0.1"),
  orderType: z.enum(["Market", "Limit", "Stop", "StopLimit", "CloseBy"]).describe("Order type"),
  timeInForce: z
    .enum(["FOK", "IOC", "GTC", "GTD", "Day", "Ms"])
    .describe("Time in force. Use IOC or FOK for Market orders"),
  limitPrice: z.number().optional().describe("Limit price (for Limit/StopLimit)"),
  stopPrice: z.number().optional().describe("Stop price (for Stop/StopLimit)"),
  stopLoss: z.number().optional().describe("Stop loss price"),
  takeProfit: z.number().optional().describe("Take profit price"),
  positionId: z.number().optional().describe("Position ID (for closing specific position)"),
  positionById: z.number().optional().describe("PositionBy ID (for CloseBy)"),
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
  if (params.positionId !== undefined) body.pi = params.positionId;
  if (params.positionById !== undefined) body.pbi = params.positionById;
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
  quantity: z.number().optional().describe("Partial close volume in lots. Omit for full close"),
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
