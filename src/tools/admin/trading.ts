import { z } from "zod";
import { RestClient } from "../../rest-client.js";
import { issuePlan, takeCommit } from "../../preview/plan-commit.js";
import { buildOrderPreview } from "../../preview/order-preview.js";
import { completenessMessage, orderPriceCompleteness } from "../../validation.js";
import { fetchRecord } from "./lookup.js";
import { queryAllPages } from "./paging.js";

// Order placement is non-idempotent: a connection reset does not prove the
// server never received the order, so a transport-level retry could fill twice.
const NO_TRANSPORT_RETRY = { retryOnConnectionError: false };

// The book endpoints are cursor-paginated (see paging.ts). A tool that reads one page reports
// success on a partial book — "closed 12, none left" with the rest still open — so every read
// that is counted, acted on, or shown as a complete answer walks all the pages.
interface BookPosition {
  id: number;
  A: number;
  s: string;
  S: string;
  q: number;
}
interface BookOrder {
  id: number;
  A: number;
  s: string;
  st: string;
}

const queryPositions = (client: RestClient, body: Record<string, unknown>) =>
  queryAllPages<BookPosition & Record<string, unknown>>(client, {
    path: "/admin/positions/query",
    method: "POST",
    body,
    collectionKey: "positions",
  });

const queryOrders = (client: RestClient, body: Record<string, unknown>) =>
  queryAllPages<BookOrder & Record<string, unknown>>(client, {
    path: "/admin/orders/active",
    method: "POST",
    body,
    collectionKey: "orders",
  });

/**
 * Keep only the rows that belong to `accountId`.
 *
 * The account filter is applied server-side, but a build that ignores it returns EVERY account's
 * records (verified live on the bare-{ A } filter this branch replaced), and these rows are used to
 * close positions and cancel orders. A row with no `A` at all means the wire shape is not what this
 * guard assumes — fail loudly rather than silently filter the whole book away, which would make a
 * close-all report success having done nothing.
 */
function ownedBy<T extends { A?: unknown }>(rows: T[], accountId: number, what: string): T[] {
  const missing = rows.filter((r) => r.A === undefined || r.A === null);
  if (missing.length > 0) {
    throw new Error(
      `Cannot verify ownership: ${missing.length} of ${rows.length} ${what} came back without an ` +
        `account field, so they cannot be matched against account ${accountId}. Refusing to act.`,
    );
  }
  return rows.filter((r) => Number(r.A) === Number(accountId));
}

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
  // The server expects `accountFilter` / `symbolNames`; a bare { A, s } filter is SILENTLY IGNORED
  // and the endpoint then returns EVERY record (verified live), so the wrong rows look like a match.
  if (params.accountId !== undefined) body.accountFilter = { accounts: [params.accountId] };
  if (params.symbol !== undefined) body.symbolNames = [params.symbol];

  const orders = await queryOrders(client, body);
  return {
    orders:
      params.accountId === undefined ? orders : ownedBy(orders, params.accountId, "working orders"),
  };
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
  // The server expects `accountFilter` / `symbolNames`; a bare { A, s } filter is SILENTLY IGNORED
  // and the endpoint then returns EVERY record (verified live), so the wrong rows look like a match.
  if (params.accountId !== undefined) body.accountFilter = { accounts: [params.accountId] };
  if (params.symbol !== undefined) body.symbolNames = [params.symbol];

  const positions = await queryPositions(client, body);
  return {
    positions:
      params.accountId === undefined
        ? positions
        : ownedBy(positions, params.accountId, "open positions"),
  };
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
  // Get position details first to know symbol and side. Scope with accountFilter — a bare
  // { A } body is silently ignored server-side and would return EVERY account's positions —
  // and double-check ownership before acting, so a stale/foreign id can never be closed.
  const owned = ownedBy(
    await queryPositions(client, { accountFilter: { accounts: [params.accountId] } }),
    params.accountId,
    "open positions",
  );

  const position = owned.find((p) => p.id === params.positionId);
  if (!position) {
    throw new Error(`Position ${params.positionId} not found on account ${params.accountId}`);
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
  // The server expects `accountFilter` / `symbolNames`; a bare { A, s } filter is SILENTLY IGNORED
  // and the endpoint then returns EVERY record (verified live), so the wrong rows look like a match.
  if (params.accountId !== undefined) body.accountFilter = { accounts: [params.accountId] };
  if (params.symbol !== undefined) body.symbolNames = [params.symbol];
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
  // The server expects `accountFilter` / `symbolNames`; a bare { A, s } filter is SILENTLY IGNORED
  // and the endpoint then returns EVERY record (verified live), so the wrong rows look like a match.
  if (params.accountId !== undefined) body.accountFilter = { accounts: [params.accountId] };
  if (params.symbol !== undefined) body.symbolNames = [params.symbol];
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
  // Scope with accountFilter (a bare { A } body is silently ignored server-side and would
  // return EVERY account's orders); the symbol filter stays client-side.
  // Ownership belt-and-braces: this loop DELETES every order it sees, so never act on a
  // record that does not belong to the requested account, whatever the server returned.
  let orders = ownedBy(
    await queryOrders(client, { accountFilter: { accounts: [params.accountId] } }),
    params.accountId,
    "working orders",
  );

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
      await client.post(
        "/admin/orders/delete",
        { A: params.accountId, id: order.id },
        NO_TRANSPORT_RETRY,
      );
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
  // Scope with accountFilter (a bare { A } body is silently ignored server-side and would
  // return EVERY account's positions); the symbol filter stays client-side.
  // Ownership belt-and-braces: this loop fires a closing MARKET order per row, so never act
  // on a record that does not belong to the requested account, whatever the server returned.
  let positions = ownedBy(
    await queryPositions(client, { accountFilter: { accounts: [params.accountId] } }),
    params.accountId,
    "open positions",
  );

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
  // Get position details to determine symbol and quantity. accountFilter scoping plus an
  // ownership check on BOTH legs — a bare { A } body is ignored server-side, and a close-by
  // must never pair a position with another account's record.
  const result = (await client.post("/admin/positions/query", {
    accountFilter: { accounts: [params.accountId] },
  })) as { positions: Array<{ id: number; A: number; s: string; S: string; q: number }> };

  const owned = (result.positions || []).filter((p) => p.A === params.accountId);
  const position = owned.find((p) => p.id === params.positionId);
  if (!position) {
    throw new Error(`Position ${params.positionId} not found on account ${params.accountId}`);
  }

  const byPosition = owned.find((p) => p.id === params.positionById);
  if (!byPosition) {
    throw new Error(`Position ${params.positionById} not found on account ${params.accountId}`);
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

export const cancelAllOrdersPlanSchema = z.object({
  accountId: z.number().optional().describe("Trading account ID"),
  symbol: z.string().optional().describe("Only cancel orders for this symbol"),
});
const CANCEL_ALL_DISCLOSURE =
  "You are confirming that an AI assistant will CANCEL ALL working orders on a client account (optionally filtered by symbol). This is high-impact — review the list carefully. Call cancel_all_orders_commit with this commitToken to execute. Nothing is sent until you commit.";

export async function cancelAllOrdersPlan(
  client: RestClient,
  params: z.infer<typeof cancelAllOrdersPlanSchema>,
) {
  const need = completenessMessage("cancel_all_orders_plan", params, [
    { name: "accountId", label: "account ID" },
  ]);
  if (need) return { needMoreInfo: need };

  const accountId = params.accountId as number;
  let orders = ownedBy(
    await queryOrders(client, { accountFilter: { accounts: [accountId] } }),
    accountId,
    "working orders",
  );
  if (params.symbol) orders = orders.filter((o) => o.s === params.symbol);

  if (orders.length === 0) {
    return {
      accountId,
      willCancel: 0,
      message: "No working orders found — nothing to cancel.",
    };
  }

  return {
    accountId,
    symbol: params.symbol,
    willCancel: orders.length,
    orders: orders.map((o) => ({ orderId: o.id, symbol: o.s, status: o.st })),
    commitToken: issuePlan(params, "cancel_all_orders"),
    disclosure: CANCEL_ALL_DISCLOSURE,
  };
}

export const cancelAllOrdersCommitSchema = z.object({
  commitToken: z.string().describe("The commitToken returned by cancel_all_orders_plan"),
});

export async function cancelAllOrdersCommit(
  client: RestClient,
  params: z.infer<typeof cancelAllOrdersCommitSchema>,
) {
  return cancelAllOrders(
    client,
    cancelAllOrdersSchema.parse(takeCommit(params.commitToken, "cancel_all_orders")),
  );
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
  // A summary of "account X" must not carry another account's rows, and must not stop at page 1:
  // either would be read back as this account's complete book.
  const filter = { accountFilter: { accounts: [params.accountId] } };
  const [states, positions, orders] = await Promise.all([
    queryAllPages(client, {
      path: "/admin/accounts/states/query",
      method: "POST",
      body: filter,
      collectionKey: "accountStates",
    }),
    queryPositions(client, filter),
    queryOrders(client, filter),
  ]);

  return {
    state: { accountStates: ownedBy(states, params.accountId, "account states") },
    positions: { positions: ownedBy(positions, params.accountId, "open positions") },
    orders: { orders: ownedBy(orders, params.accountId, "working orders") },
  };
}

export const getWorkingOrderSchema = z.object({
  orderId: z.number().describe("Order unique identifier"),
});

export async function getWorkingOrder(
  client: RestClient,
  params: z.infer<typeof getWorkingOrderSchema>,
) {
  return client.post("/admin/orders/active/single", { orderId: params.orderId });
}

export const getHistoricalOrderSchema = z.object({
  orderId: z.number().describe("Order unique identifier"),
});

export async function getHistoricalOrder(
  client: RestClient,
  params: z.infer<typeof getHistoricalOrderSchema>,
) {
  return client.post("/admin/orders/history/single", { orderId: params.orderId });
}

// === POSITION / TRADE RECORD MAINTENANCE (plan/commit) ===
//
// Unlike the config resources, these endpoints take a SPARSE update — { id, A, ...changed fields }
// — and carry no `version`/If-Match concurrency (PositionModify / TradeUpdate in the admin SDK).
// The account id `A` is required by the wire format but is read from the record, so callers only
// supply the position/trade id. Editing or deleting a record rewrites a client's book and P/L, so
// both are gated behind the repo's confirm-before-execute plan/commit pattern.

type BookRecord = Record<string, unknown>;

const positionSpec = (id: number, accountId?: number) => ({
  label: "position",
  getPath: `/admin/positions/get/${id}`,
  queryPath: "/admin/positions/query",
  queryBody: accountId === undefined ? {} : { accountFilter: { accounts: [accountId] } },
  collectionKey: "positions",
  accountId,
});
const tradeSpec = (id: number, accountId?: number) => ({
  label: "trade",
  getPath: `/admin/trades/get/${id}`,
  queryPath: "/admin/trades/query",
  queryBody: accountId === undefined ? {} : { accountFilter: { accounts: [accountId] } },
  collectionKey: "trades",
  accountId,
});

// friendly parameter name -> terse wire key
const POSITION_FIELD_MAP: Record<string, string> = {
  quantity: "q",
  openPrice: "p",
  swaps: "sw",
  commission: "c",
  fees: "f",
};
const TRADE_FIELD_MAP: Record<string, string> = {
  price: "p",
  quantity: "q",
  profit: "pl",
  swaps: "sw",
  commission: "c",
  fees: "f",
};

function buildSparseUpdate(
  current: BookRecord,
  updates: Record<string, unknown>,
  map: Record<string, string>,
) {
  const body: BookRecord = { id: current.id, A: current.A };
  const changes: Record<string, { from: unknown; to: unknown }> = {};
  for (const [friendly, wire] of Object.entries(map)) {
    const value = updates[friendly];
    if (value === undefined) continue;
    body[wire] = value;
    if (current[wire] !== value) changes[friendly] = { from: current[wire], to: value };
  }
  return { body, changes };
}

export const getPositionSchema = z.object({
  positionId: z.number().describe("Position unique identifier (from get_open_positions)"),
  accountId: z
    .number()
    .optional()
    .describe(
      "Owning account ID — narrows the lookup and is required on servers that do not serve get-by-id",
    ),
});

export async function getPosition(client: RestClient, params: z.infer<typeof getPositionSchema>) {
  return fetchRecord(client, positionSpec(params.positionId, params.accountId), params.positionId);
}

export const getTradeSchema = z.object({
  tradeId: z.number().describe("Trade unique identifier (from get_trade_history)"),
  accountId: z
    .number()
    .optional()
    .describe(
      "Owning account ID — narrows the lookup and is required on servers that do not serve get-by-id",
    ),
});

export async function getTrade(client: RestClient, params: z.infer<typeof getTradeSchema>) {
  return fetchRecord(client, tradeSpec(params.tradeId, params.accountId), params.tradeId);
}

export const updatePositionPlanSchema = z.object({
  positionId: z.number().describe("Position to correct (from get_open_positions)"),
  accountId: z
    .number()
    .optional()
    .describe(
      "Owning account ID — narrows the lookup and is required on servers that do not serve get-by-id",
    ),
  quantity: z.number().optional().describe("Volume in lots"),
  openPrice: z.number().optional().describe("Volume-weighted average open price (VWAP)"),
  swaps: z.number().optional().describe("Accrued swaps"),
  commission: z.number().optional().describe("Commission"),
  fees: z.number().optional().describe("Fees"),
});
const UPDATE_POSITION_DISCLOSURE =
  "You are confirming a LIVE correction to an open position on a client account via an AI assistant. This changes the client's book and P/L. Review the diff, then call update_position_commit with this commitToken. Nothing is written until you commit.";

export async function updatePositionPlan(
  client: RestClient,
  params: z.infer<typeof updatePositionPlanSchema>,
) {
  const current = await fetchRecord(
    client,
    positionSpec(params.positionId, params.accountId),
    params.positionId,
  );
  const { body, changes } = buildSparseUpdate(current, params, POSITION_FIELD_MAP);
  if (Object.keys(changes).length === 0) {
    return {
      positionId: params.positionId,
      noChanges: true,
      message: "No field was supplied with a value different from the position's current one.",
    };
  }
  return {
    positionId: params.positionId,
    account: current.A,
    symbol: current.s,
    changes,
    commitToken: issuePlan(body, "update_position"),
    disclosure: UPDATE_POSITION_DISCLOSURE,
  };
}

export const updatePositionCommitSchema = z.object({
  commitToken: z.string().describe("The commitToken returned by update_position_plan"),
});

export async function updatePositionCommit(
  client: RestClient,
  params: z.infer<typeof updatePositionCommitSchema>,
) {
  // This endpoint carries no ETag contract; clear anything a previous response left cached on
  // this path so RestClient does not attach a stray If-Match.
  client.setEtag("/admin/positions/edit", "");
  return client.post(
    "/admin/positions/edit",
    takeCommit(params.commitToken, "update_position"),
    NO_TRANSPORT_RETRY,
  );
}

export const deletePositionPlanSchema = z.object({
  positionId: z.number().describe("Position to delete (from get_open_positions)"),
  accountId: z
    .number()
    .optional()
    .describe(
      "Owning account ID — narrows the lookup and is required on servers that do not serve get-by-id",
    ),
});
const DELETE_POSITION_DISCLOSURE =
  "You are confirming the LIVE DELETION of an open position from a client account via an AI assistant. The position is removed from the client's book. Review the target, then call delete_position_commit with this commitToken. Nothing is deleted until you commit.";

export async function deletePositionPlan(
  client: RestClient,
  params: z.infer<typeof deletePositionPlanSchema>,
) {
  const current = await fetchRecord(
    client,
    positionSpec(params.positionId, params.accountId),
    params.positionId,
  );
  return {
    willDelete: {
      positionId: current.id,
      account: current.A,
      symbol: current.s,
      side: current.S,
      quantity: current.q,
      openPrice: current.p,
      unrealizedPl: current.pl,
    },
    commitToken: issuePlan({ id: current.id, A: current.A }, "delete_position"),
    disclosure: DELETE_POSITION_DISCLOSURE,
  };
}

export const deletePositionCommitSchema = z.object({
  commitToken: z.string().describe("The commitToken returned by delete_position_plan"),
});

export async function deletePositionCommit(
  client: RestClient,
  params: z.infer<typeof deletePositionCommitSchema>,
) {
  // This endpoint carries no ETag contract; clear anything a previous response left cached on
  // this path so RestClient does not attach a stray If-Match.
  client.setEtag("/admin/positions/delete", "");
  return client.post(
    "/admin/positions/delete",
    takeCommit(params.commitToken, "delete_position"),
    NO_TRANSPORT_RETRY,
  );
}

export const updateTradePlanSchema = z.object({
  tradeId: z.number().describe("Trade to correct (from get_trade_history)"),
  accountId: z
    .number()
    .optional()
    .describe(
      "Owning account ID — narrows the lookup and is required on servers that do not serve get-by-id",
    ),
  price: z.number().optional().describe("Execution price"),
  quantity: z.number().optional().describe("Volume in lots"),
  profit: z.number().optional().describe("Realized profit/loss"),
  swaps: z.number().optional().describe("Swaps"),
  commission: z.number().optional().describe("Commission"),
  fees: z.number().optional().describe("Fees"),
});
const UPDATE_TRADE_DISCLOSURE =
  "You are confirming a LIVE correction to an executed trade on a client account via an AI assistant. This rewrites trade history and the client's realized P/L. Review the diff, then call update_trade_commit with this commitToken. Nothing is written until you commit.";

export async function updateTradePlan(
  client: RestClient,
  params: z.infer<typeof updateTradePlanSchema>,
) {
  const current = await fetchRecord(
    client,
    tradeSpec(params.tradeId, params.accountId),
    params.tradeId,
  );
  const { body, changes } = buildSparseUpdate(current, params, TRADE_FIELD_MAP);
  if (Object.keys(changes).length === 0) {
    return {
      tradeId: params.tradeId,
      noChanges: true,
      message: "No field was supplied with a value different from the trade's current one.",
    };
  }
  return {
    tradeId: params.tradeId,
    account: current.A,
    symbol: current.s,
    changes,
    commitToken: issuePlan(body, "update_trade"),
    disclosure: UPDATE_TRADE_DISCLOSURE,
  };
}

export const updateTradeCommitSchema = z.object({
  commitToken: z.string().describe("The commitToken returned by update_trade_plan"),
});

export async function updateTradeCommit(
  client: RestClient,
  params: z.infer<typeof updateTradeCommitSchema>,
) {
  // This endpoint carries no ETag contract; clear anything a previous response left cached on
  // this path so RestClient does not attach a stray If-Match.
  client.setEtag("/admin/trades/edit", "");
  return client.post(
    "/admin/trades/edit",
    takeCommit(params.commitToken, "update_trade"),
    NO_TRANSPORT_RETRY,
  );
}

export const deleteTradePlanSchema = z.object({
  tradeId: z.number().describe("Trade to delete (from get_trade_history)"),
  accountId: z
    .number()
    .optional()
    .describe(
      "Owning account ID — narrows the lookup and is required on servers that do not serve get-by-id",
    ),
});
const DELETE_TRADE_DISCLOSURE =
  "You are confirming the LIVE DELETION of an executed trade from a client account via an AI assistant. This rewrites trade history. Review the target, then call delete_trade_commit with this commitToken. Nothing is deleted until you commit.";

export async function deleteTradePlan(
  client: RestClient,
  params: z.infer<typeof deleteTradePlanSchema>,
) {
  const current = await fetchRecord(
    client,
    tradeSpec(params.tradeId, params.accountId),
    params.tradeId,
  );
  return {
    willDelete: {
      tradeId: current.id,
      account: current.A,
      symbol: current.s,
      quantity: current.q,
      price: current.p,
      profit: current.pl,
    },
    commitToken: issuePlan({ id: current.id, A: current.A }, "delete_trade"),
    disclosure: DELETE_TRADE_DISCLOSURE,
  };
}

export const deleteTradeCommitSchema = z.object({
  commitToken: z.string().describe("The commitToken returned by delete_trade_plan"),
});

export async function deleteTradeCommit(
  client: RestClient,
  params: z.infer<typeof deleteTradeCommitSchema>,
) {
  // This endpoint carries no ETag contract; clear anything a previous response left cached on
  // this path so RestClient does not attach a stray If-Match.
  client.setEtag("/admin/trades/delete", "");
  return client.post(
    "/admin/trades/delete",
    takeCommit(params.commitToken, "delete_trade"),
    NO_TRANSPORT_RETRY,
  );
}
