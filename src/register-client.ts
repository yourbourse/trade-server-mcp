import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { RestClient } from "./rest-client.js";
import { ClientAuth } from "./auth/client-auth.js";
import { toolHandler } from "./tool-handler.js";
import * as t from "./tools/client/trading.js";
import * as a from "./tools/client/account.js";
import * as m from "./tools/client/market-data.js";

// E1a: all 4 money-movers (place_order, close_position, close_by, close_all_positions) are split
// into *_plan + *_commit pairs (26 − 4 + 8 = 30). No un-gated execution path remains.
export const CLIENT_TOOL_COUNT = 30;

export function registerClientTools(server: McpServer, client: RestClient, auth?: ClientAuth) {
  // While sign-in is failing (authFailureHint non-null), append the targeted hint
  // (bad credentials vs old server version vs connectivity) to EVERY tool error so
  // the failure is actionable from the tool result. Old servers may answer client-API
  // endpoints with a 401 — or simply close the connection (observed on older servers) — so the
  // hint must not be gated on ApiError 401. The hint clears on successful sign-in.
  const withHint =
    <T>(fn: (p: T) => Promise<unknown>) =>
    async (p: T) => {
      try {
        return await fn(p);
      } catch (err) {
        const hint = auth?.authFailureHint();
        if (hint && err instanceof Error) {
          throw new Error(`${err.message}\n${hint}`, { cause: err.cause });
        }
        throw err;
      }
    };

  // Trading (10: place_order is split into plan/commit for confirm-before-execute)
  server.registerTool(
    "place_order_plan",
    {
      description:
        "STEP 1 of placing an order — preview a new order on YOUR account WITHOUT executing. Validates the request and returns a plain-language summary, the live quote, your free margin, and a commitToken. Show the preview to the user; ONLY after they confirm, call place_order_commit with that token. If required details are missing (symbol, side, quantity, order type, time-in-force) it returns exactly what's needed instead of guessing. Nothing is sent to the market.",
      inputSchema: t.placeOrderPlanSchema.shape,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    toolHandler(withHint((p) => t.placeOrderPlan(client, p))),
  );
  server.registerTool(
    "place_order_commit",
    {
      description:
        "STEP 2 — execute the order previewed by place_order_plan. Requires the commitToken from that preview; the order is fixed at plan time and cannot be changed here. This places a LIVE order via an AI assistant — only call after the user has reviewed the preview and explicitly confirmed.",
      inputSchema: t.placeOrderCommitSchema.shape,
      annotations: { destructiveHint: true, openWorldHint: true },
    },
    toolHandler(withHint((p) => t.placeOrderCommit(client, p))),
  );
  server.tool(
    "modify_order",
    "Modify one of your working orders (price or quantity). Only pending orders (Limit/Stop/StopLimit) can be modified. Provide only the fields you want to change.",
    t.modifyOrderSchema.shape,
    toolHandler(withHint((p) => t.modifyOrder(client, p))),
  );
  server.tool(
    "cancel_order",
    "Cancel one of your working (pending) orders by ID. Returns an error if the order is already filled or cancelled.",
    t.cancelOrderSchema.shape,
    toolHandler(withHint((p) => t.cancelOrder(client, p))),
  );
  server.tool(
    "modify_order_sltp",
    "Set or change stop loss / take profit on one of your pending orders. Omit a field to cancel that side.",
    t.modifyOrderSltpSchema.shape,
    toolHandler(withHint((p) => t.modifyOrderSltp(client, p))),
  );
  server.tool(
    "modify_position_sltp",
    "Set, modify or remove stop loss and/or take profit on one of your open positions. Pass 0 (or omit a field) to remove that side; omit both to remove both. To change only one side, re-send the other side's current value or it will be removed.",
    t.modifyPositionSltpSchema.shape,
    toolHandler(withHint((p) => t.modifyPositionSltp(client, p))),
  );
  server.registerTool(
    "close_position_plan",
    {
      description:
        "STEP 1 of closing one of YOUR positions — preview WITHOUT executing; returns a commitToken. Needs positionId (optional quantity for a partial close). Show the preview; only after you confirm, call close_position_commit. Nothing is sent.",
      inputSchema: t.closePositionPlanSchema.shape,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    toolHandler(withHint((p) => t.closePositionPlan(client, p))),
  );
  server.registerTool(
    "close_position_commit",
    {
      description:
        "STEP 2 — execute the close previewed by close_position_plan. Requires the commitToken. Places a LIVE closing order — only after you have reviewed the preview and confirmed.",
      inputSchema: t.closePositionCommitSchema.shape,
      annotations: { destructiveHint: true, openWorldHint: true },
    },
    toolHandler(withHint((p) => t.closePositionCommit(client, p))),
  );
  server.registerTool(
    "close_by_plan",
    {
      description:
        "STEP 1 of a hedged close (two opposite positions, same symbol) — preview WITHOUT executing; returns a commitToken. Needs positionId + positionById. Only meaningful on hedging accounts. Show the preview; only after you confirm, call close_by_commit. Nothing is sent.",
      inputSchema: t.closeByPlanSchema.shape,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    toolHandler(withHint((p) => t.closeByPlan(client, p))),
  );
  server.registerTool(
    "close_by_commit",
    {
      description:
        "STEP 2 — execute the hedged close previewed by close_by_plan. Requires the commitToken. Places a LIVE close — only after you have reviewed the preview and confirmed.",
      inputSchema: t.closeByCommitSchema.shape,
      annotations: { destructiveHint: true, openWorldHint: true },
    },
    toolHandler(withHint((p) => t.closeByCommit(client, p))),
  );
  server.tool(
    "cancel_all_orders",
    "Cancel ALL of your working orders in one call. Optionally filter by symbol. Returns count of cancelled orders.",
    t.cancelAllOrdersSchema.shape,
    toolHandler(withHint((p) => t.cancelAllOrders(client, p))),
  );
  server.registerTool(
    "close_all_positions_plan",
    {
      description:
        "STEP 1 — preview closing ALL of YOUR open positions (optionally filtered by symbol) WITHOUT executing; returns a commitToken. High-impact. Show the preview; only after you confirm, call close_all_positions_commit. Nothing is sent.",
      inputSchema: t.closeAllPositionsPlanSchema.shape,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    toolHandler(withHint((p) => t.closeAllPositionsPlan(client, p))),
  );
  server.registerTool(
    "close_all_positions_commit",
    {
      description:
        "STEP 2 — execute the close-all previewed by close_all_positions_plan. Requires the commitToken. LIVE and high-impact (closes every matching position) — only after you have reviewed the preview and confirmed.",
      inputSchema: t.closeAllPositionsCommitSchema.shape,
      annotations: { destructiveHint: true, openWorldHint: true },
    },
    toolHandler(withHint((p) => t.closeAllPositionsCommit(client, p))),
  );

  // Read trading (4)
  server.tool(
    "get_working_orders",
    "Get your active/working (pending) orders. Optionally filter by symbol.",
    t.getWorkingOrdersSchema.shape,
    toolHandler(withHint((p) => t.getWorkingOrders(client, p))),
  );
  server.tool(
    "get_order_history",
    "Get your historical orders (completed, cancelled, rejected). Optionally filter by symbol and time range. Times are microseconds since epoch.",
    t.getOrderHistorySchema.shape,
    toolHandler(withHint((p) => t.getOrderHistory(client, p))),
  );
  server.tool(
    "get_open_positions",
    "Get your open positions with unrealized P/L. Optionally filter by symbol.",
    t.getOpenPositionsSchema.shape,
    toolHandler(withHint((p) => t.getOpenPositions(client, p))),
  );
  server.tool(
    "get_trade_history",
    "Get your historical trade executions (fills). Optionally filter by symbol and time range. Times are microseconds since epoch.",
    t.getTradeHistorySchema.shape,
    toolHandler(withHint((p) => t.getTradeHistory(client, p))),
  );

  // Account (5)
  server.tool(
    "get_account_state",
    "Get your account's financial state: balance, equity, margin, free margin, margin level, unrealized P/L.",
    a.getAccountStateSchema.shape,
    toolHandler(withHint(() => a.getAccountState(client))),
  );
  server.tool(
    "get_account_summary",
    "Get a complete snapshot of your account in one call: financial state, all open positions, and all working orders.",
    a.getAccountSummarySchema.shape,
    toolHandler(withHint(() => a.getAccountSummary(client))),
  );
  server.tool(
    "get_balances",
    "Get your account's balances/collateral per asset.",
    a.getBalancesSchema.shape,
    toolHandler(withHint(() => a.getBalances(client))),
  );
  server.tool(
    "get_transfer_history",
    "Get your cash transfer history (deposits, withdrawals, adjustments). Times are microseconds since epoch.",
    a.getTransferHistorySchema.shape,
    toolHandler(withHint((p) => a.getTransferHistory(client, p))),
  );
  server.tool(
    "get_limits",
    "Get the API rate limits that apply to your session.",
    a.getLimitsSchema.shape,
    toolHandler(withHint(() => a.getLimits(client))),
  );

  // Market data (7) + utility (1)
  server.tool(
    "get_quote",
    "Get the current bid/ask quote for a symbol.",
    m.getQuoteSchema.shape,
    toolHandler(withHint((p) => m.getQuote(client, p))),
  );
  server.tool(
    "get_quotes",
    "Get current bid/ask quotes for multiple symbols at once. More efficient than calling get_quote in a loop.",
    m.getQuotesSchema.shape,
    toolHandler(withHint((p) => m.getQuotes(client, p))),
  );
  server.tool(
    "get_market_depth",
    "Get the Level 2 order book (market depth) for a symbol. Default 10 price levels.",
    m.getMarketDepthSchema.shape,
    toolHandler(withHint((p) => m.getMarketDepth(client, p))),
  );
  server.tool(
    "get_symbols",
    "List trading symbols available to your account. Optionally filter by glob pattern (e.g. 'EUR*').",
    m.getSymbolsSchema.shape,
    toolHandler(withHint((p) => m.getSymbols(client, p))),
  );
  server.tool(
    "get_symbol_details",
    "Get complete configuration for a symbol: trading sessions, swap rates, tick size, lot size. Look up is by symbol name.",
    m.getSymbolDetailsSchema.shape,
    toolHandler(withHint((p) => m.getSymbolDetails(client, p))),
  );
  server.tool(
    "get_candles",
    "Get OHLCV candlestick data. Intervals: 1M, 5M, 15M, 30M, 1H, 4H, D, W, M.",
    m.getCandlesSchema.shape,
    toolHandler(withHint((p) => m.getCandles(client, p))),
  );
  server.tool(
    "get_conversion_rate",
    "Get a currency conversion rate (e.g. EUR to USD) using your group's configured price source.",
    m.getConversionRateSchema.shape,
    toolHandler(withHint((p) => m.getConversionRate(client, p))),
  );
  server.tool(
    "health_check",
    "Check the Trade Server is running and responsive. Returns current server time, which mode this server runs in (trader/client vs manager/admin) and, when signed in with a login/password, the account number.",
    m.healthCheckSchema.shape,
    toolHandler(
      withHint(async () => ({
        ...((await m.healthCheck(client)) as Record<string, unknown>),
        mode: "client",
        ...(auth?.account != null ? { account: auth.account } : {}),
      })),
    ),
  );

  server.resource(
    "symbols",
    "trade://symbols",
    { description: "List of trading symbols available to your account" },
    async () => {
      const result = await m.getSymbols(client, {});
      return {
        contents: [
          {
            uri: "trade://symbols",
            text: JSON.stringify(result, null, 2),
            mimeType: "application/json",
          },
        ],
      };
    },
  );
}
