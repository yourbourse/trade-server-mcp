import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { RestClient } from "./rest-client.js";
import { WsClient } from "./ws-client.js";
import { toolHandler } from "./tool-handler.js";

// Tool imports
import {
  cancelOrderSchema,
  cancelOrder,
  modifyOrderSchema,
  modifyOrder,
  getWorkingOrdersSchema,
  getWorkingOrders,
  getOpenPositionsSchema,
  getOpenPositions,
  modifyPositionSltpSchema,
  modifyPositionSltp,
  getTradeHistorySchema,
  getTradeHistory,
  getOrderHistorySchema,
  getOrderHistory,
  cancelAllOrdersSchema,
  cancelAllOrders,
  modifyOrderSltpSchema,
  modifyOrderSltp,
  forceDeleteOrderSchema,
  forceDeleteOrder,
  getAccountSummarySchema,
  getAccountSummary,
  placeOrderPlanSchema,
  placeOrderPlan,
  placeOrderCommitSchema,
  placeOrderCommit,
  closePositionPlanSchema,
  closePositionPlan,
  closePositionCommitSchema,
  closePositionCommit,
  closeByPlanSchema,
  closeByPlan,
  closeByCommitSchema,
  closeByCommit,
  closeAllPositionsPlanSchema,
  closeAllPositionsPlan,
  closeAllPositionsCommitSchema,
  closeAllPositionsCommit,
} from "./tools/admin/trading.js";

import {
  getAccountStateSchema,
  getAccountState,
  getAccountInfoSchema,
  getAccountInfo,
  getAllAccountsSchema,
  getAllAccounts,
  cashTransferSchema,
  cashTransfer,
  getTransferHistorySchema,
  getTransferHistory,
  getBalancesSchema,
  getBalances,
} from "./tools/admin/account.js";

import {
  getQuoteSchema,
  getQuote,
  getQuotesSchema,
  getQuotes,
  getMarketDepthSchema,
  getMarketDepth,
  getSymbolsSchema,
  getSymbols,
  getCandlesSchema,
  getCandles,
  getConversionRateSchema,
  getConversionRate,
  getIndicatorSchema,
  getIndicator,
} from "./tools/admin/market-data.js";

import {
  getGroupsSchema,
  getGroups,
  getGroupSchema,
  getGroup,
  getClientsSchema,
  getClients,
  getOrderRoutingSchema,
  getOrderRouting,
  setOrderRoutingSchema,
  setOrderRouting,
  addRoutingRuleSchema,
  addRoutingRule,
  removeRoutingRuleSchema,
  removeRoutingRule,
  getLiquidityConnectorsSchema,
  getLiquidityConnectors,
  getSymbolDetailsSchema,
  getSymbolDetails,
  healthCheckSchema,
  healthCheck,
} from "./tools/admin/config.js";

export function registerAdminTools(
  server: McpServer,
  restClient: RestClient,
  wsClient: WsClient,
  managerAccount?: () => number | null,
) {
  // === TRADING TOOLS ===

  server.registerTool(
    "place_order_plan",
    {
      description:
        "STEP 1 of placing an order on a client account — preview WITHOUT executing. Validates and returns the order summary (including the target account) plus a commitToken; if required details are missing (account, symbol, side, quantity, order type, time-in-force) it returns exactly what's needed. Show the preview; only after the user confirms, call place_order_commit. Nothing is sent.",
      inputSchema: placeOrderPlanSchema.shape,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    toolHandler((params) => placeOrderPlan(restClient, params)),
  );
  server.registerTool(
    "place_order_commit",
    {
      description:
        "STEP 2 — execute the order previewed by place_order_plan on the client account. Requires the commitToken from that preview. Places a LIVE order via an AI assistant — only call after the user has reviewed the preview and explicitly confirmed.",
      inputSchema: placeOrderCommitSchema.shape,
      annotations: { destructiveHint: true, openWorldHint: true },
    },
    toolHandler((params) => placeOrderCommit(restClient, params)),
  );

  server.tool(
    "cancel_order",
    "Cancel a working (pending) order by its ID. Returns error if the order is already filled or cancelled.",
    cancelOrderSchema.shape,
    toolHandler((params) => cancelOrder(restClient, params)),
  );

  server.tool(
    "modify_order",
    "Modify a working order's price or quantity. Only pending orders (Limit/Stop/StopLimit) can be modified. Provide only the fields you want to change.",
    modifyOrderSchema.shape,
    toolHandler((params) => modifyOrder(restClient, params)),
  );

  server.tool(
    "get_working_orders",
    "Get all active/working (pending) orders. Optionally filter by accountId and/or symbol. Returns order ID, type, side, price, quantity, and status.",
    getWorkingOrdersSchema.shape,
    toolHandler((params) => getWorkingOrders(restClient, params)),
  );

  server.tool(
    "get_open_positions",
    "Get all open positions with unrealized P/L. Optionally filter by accountId and/or symbol. Each position shows ID, symbol, side, quantity, open price, and current P/L.",
    getOpenPositionsSchema.shape,
    toolHandler((params) => getOpenPositions(restClient, params)),
  );

  server.registerTool(
    "close_position_plan",
    {
      description:
        "STEP 1 — preview closing a client account's position WITHOUT executing; returns a commitToken. Needs accountId + positionId (optional quantity for a partial close). Show the preview; only after the user confirms, call close_position_commit. Nothing is sent.",
      inputSchema: closePositionPlanSchema.shape,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    toolHandler((params) => closePositionPlan(restClient, params)),
  );
  server.registerTool(
    "close_position_commit",
    {
      description:
        "STEP 2 — execute the close previewed by close_position_plan. Requires the commitToken. Places a LIVE closing order — only after explicit user confirmation.",
      inputSchema: closePositionCommitSchema.shape,
      annotations: { destructiveHint: true, openWorldHint: true },
    },
    toolHandler((params) => closePositionCommit(restClient, params)),
  );

  server.tool(
    "modify_position_sltp",
    "Set, modify, or remove stop loss and/or take profit on an open position. Set price to 0 to remove an existing SL/TP.",
    modifyPositionSltpSchema.shape,
    toolHandler((params) => modifyPositionSltp(restClient, params)),
  );

  server.tool(
    "get_trade_history",
    "Get historical trade executions (fills). Optionally filter by account, symbol, and time range. Times are in microseconds since epoch. Returns executed price, quantity, side, and timestamp.",
    getTradeHistorySchema.shape,
    toolHandler((params) => getTradeHistory(restClient, params)),
  );

  server.tool(
    "get_order_history",
    "Get historical orders (completed, cancelled, rejected). Optionally filter by account, symbol, and time range. Times are in microseconds since epoch.",
    getOrderHistorySchema.shape,
    toolHandler((params) => getOrderHistory(restClient, params)),
  );

  server.tool(
    "cancel_all_orders",
    "Cancel all working orders on an account in one call. Optionally filter by symbol to only cancel orders for a specific instrument. Returns count of cancelled orders.",
    cancelAllOrdersSchema.shape,
    toolHandler((params) => cancelAllOrders(restClient, params)),
  );

  server.registerTool(
    "close_all_positions_plan",
    {
      description:
        "STEP 1 — preview closing ALL of a client account's open positions (optionally filtered by symbol) WITHOUT executing; returns a commitToken. High-impact — needs accountId. Show the preview; only after the user confirms, call close_all_positions_commit. Nothing is sent.",
      inputSchema: closeAllPositionsPlanSchema.shape,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    toolHandler((params) => closeAllPositionsPlan(restClient, params)),
  );
  server.registerTool(
    "close_all_positions_commit",
    {
      description:
        "STEP 2 — execute the close-all previewed by close_all_positions_plan. Requires the commitToken. LIVE and high-impact (closes every matching position) — only after explicit user confirmation.",
      inputSchema: closeAllPositionsCommitSchema.shape,
      annotations: { destructiveHint: true, openWorldHint: true },
    },
    toolHandler((params) => closeAllPositionsCommit(restClient, params)),
  );

  server.registerTool(
    "close_by_plan",
    {
      description:
        "STEP 1 — preview a hedged close (two opposite positions on the same symbol) on a client account WITHOUT executing; returns a commitToken. Needs accountId + positionId + positionById. Show the preview; only after the user confirms, call close_by_commit. Nothing is sent.",
      inputSchema: closeByPlanSchema.shape,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    toolHandler((params) => closeByPlan(restClient, params)),
  );
  server.registerTool(
    "close_by_commit",
    {
      description:
        "STEP 2 — execute the hedged close previewed by close_by_plan. Requires the commitToken. Places a LIVE close — only after explicit user confirmation.",
      inputSchema: closeByCommitSchema.shape,
      annotations: { destructiveHint: true, openWorldHint: true },
    },
    toolHandler((params) => closeByCommit(restClient, params)),
  );

  server.tool(
    "modify_order_sltp",
    "Modify stop loss and/or take profit on a pending order. Omit a field to cancel that side's SL/TP.",
    modifyOrderSltpSchema.shape,
    toolHandler((params) => modifyOrderSltp(restClient, params)),
  );

  server.tool(
    "force_delete_order",
    "Force-delete a stuck or corrupted order that normal cancel cannot remove. Admin safety net — use only when cancel_order fails. This bypasses normal order lifecycle.",
    forceDeleteOrderSchema.shape,
    toolHandler((params) => forceDeleteOrder(restClient, params)),
  );

  server.tool(
    "get_account_summary",
    "Get a complete account snapshot in one call: balance/equity/margin state, all open positions, and all working orders. Saves 3 round-trips vs calling each individually.",
    getAccountSummarySchema.shape,
    toolHandler((params) => getAccountSummary(restClient, params)),
  );

  // === ACCOUNT TOOLS ===

  server.tool(
    "get_account_state",
    "Get account financial state: balance, equity, margin, free margin, margin level, unrealized P/L. Use get_account_summary for a full snapshot including positions and orders.",
    getAccountStateSchema.shape,
    toolHandler((params) => getAccountState(restClient, params)),
  );

  server.tool(
    "get_account_info",
    "Get trading account configuration: group assignment, client owner, leverage, read-only flag, and other settings. Does NOT include financial state (use get_account_state for that).",
    getAccountInfoSchema.shape,
    toolHandler((params) => getAccountInfo(restClient, params)),
  );

  server.tool(
    "get_all_accounts",
    "List all trading accounts on the server with their basic info (ID, group, client). For financial state of all accounts, use get_balances instead.",
    getAllAccountsSchema.shape,
    toolHandler(() => getAllAccounts(restClient)),
  );

  server.tool(
    "cash_transfer",
    "Make a cash deposit, withdrawal, or adjustment. Use positive amount for deposit, negative for withdrawal. Type 'Balance' is standard deposit/withdrawal. Supports: Balance, Credit, Fee, Adjustment, Bonus, Commission, Interest, Dividend, Tax.",
    cashTransferSchema.shape,
    toolHandler((params) => cashTransfer(restClient, params)),
  );

  server.tool(
    "get_transfer_history",
    "Get cash transfer history (deposits, withdrawals, adjustments). Optionally filter by account and time range. Times are in microseconds since epoch.",
    getTransferHistorySchema.shape,
    toolHandler((params) => getTransferHistory(restClient, params)),
  );

  server.tool(
    "get_balances",
    "Get financial state (balance, equity, margin, P/L) for ALL accounts at once. Useful for portfolio-level overview. For a single account use get_account_state.",
    getBalancesSchema.shape,
    toolHandler(() => getBalances(restClient)),
  );

  // === MARKET DATA TOOLS ===

  server.tool(
    "get_quote",
    "Get current bid/ask quote for a single symbol via WebSocket L1 feed. Returns latest bid, ask, and spread. For multiple symbols at once, use get_quotes.",
    getQuoteSchema.shape,
    toolHandler((params) => getQuote(wsClient, params)),
  );

  server.tool(
    "get_market_depth",
    "Get Level 2 order book (market depth) for a symbol via WebSocket. Returns multiple price levels of bids and asks with their volumes. Default 10 levels.",
    getMarketDepthSchema.shape,
    toolHandler((params) => getMarketDepth(wsClient, params)),
  );

  server.tool(
    "get_symbols",
    "List available trading symbols. Optionally filter by glob pattern (e.g. 'EUR*' for all EUR pairs, '*USD' for all USD pairs, '*' for all). Returns symbol name, ID, and basic config.",
    getSymbolsSchema.shape,
    toolHandler((params) => getSymbols(restClient, params)),
  );

  server.tool(
    "get_candles",
    "Get OHLCV candlestick chart data. Intervals: 1M, 5M, 15M, 30M, 1H, 4H, D (daily), W (weekly), M (monthly). Max 1000 candles per request. Specify symbol by ID or name+groupId.",
    getCandlesSchema.shape,
    toolHandler((params) => getCandles(restClient, params)),
  );

  server.tool(
    "get_conversion_rate",
    "Get currency conversion rate (e.g. EUR→USD) within a specific group context. The rate uses the group's configured price source.",
    getConversionRateSchema.shape,
    toolHandler((params) => getConversionRate(restClient, params)),
  );

  server.tool(
    "get_quotes",
    "Get live bid/ask quotes for multiple symbols at once in parallel. More efficient than calling get_quote in a loop. Returns array of {symbol, quote} objects.",
    getQuotesSchema.shape,
    toolHandler((params) => getQuotes(wsClient, params)),
  );

  server.tool(
    "get_indicator",
    "Calculate a technical indicator (RSI, MACD, EMA, SMA, BollingerBands, ATR, Stochastic, ADX, VWAP, CCI) on symbol candle data. Returns the current value and last 20 data points. Fetches candles internally — no need to call get_candles first.",
    getIndicatorSchema.shape,
    toolHandler((params) => getIndicator(restClient, params)),
  );

  // === CONFIGURATION TOOLS ===

  server.tool(
    "get_groups",
    "List all trading groups with their IDs and names. Groups define trading conditions (spreads, commissions, leverage) for accounts assigned to them.",
    getGroupsSchema.shape,
    toolHandler(() => getGroups(restClient)),
  );

  server.tool(
    "get_group",
    "Get detailed group configuration by ID: margin settings, commission rules, symbol overrides, and trading permissions.",
    getGroupSchema.shape,
    toolHandler((params) => getGroup(restClient, params)),
  );

  server.tool(
    "get_clients",
    "List all clients (account owners). Each client can own multiple trading accounts.",
    getClientsSchema.shape,
    toolHandler(() => getClients(restClient)),
  );

  server.tool(
    "get_order_routing",
    "Get current order routing configuration. Shows all routing rules with their filters and actions. Returns version number needed for set_order_routing.",
    getOrderRoutingSchema.shape,
    toolHandler(() => getOrderRouting(restClient)),
  );

  server.tool(
    "set_order_routing",
    "Replace ALL order routing rules at once. Requires the current version number (get from get_order_routing). CAUTION: this overwrites everything. Prefer add_routing_rule/remove_routing_rule for safe atomic changes.",
    setOrderRoutingSchema.shape,
    toolHandler((params) => setOrderRouting(restClient, params)),
  );

  server.tool(
    "add_routing_rule",
    "Add a single routing rule to the existing configuration without affecting other rules. Safer than set_order_routing. Automatically reads current version and appends.",
    addRoutingRuleSchema.shape,
    toolHandler((params) => addRoutingRule(restClient, params)),
  );

  server.tool(
    "remove_routing_rule",
    "Remove a single routing rule by its zero-based index. Use get_order_routing first to see current rules and their indices. Safer than set_order_routing.",
    removeRoutingRuleSchema.shape,
    toolHandler((params) => removeRoutingRule(restClient, params)),
  );

  server.tool(
    "get_liquidity_connectors",
    "List all configured liquidity connectors (LPs). Shows connector ID, name, type, and connection status.",
    getLiquidityConnectorsSchema.shape,
    toolHandler(() => getLiquidityConnectors(restClient)),
  );

  server.tool(
    "get_symbol_details",
    "Get complete symbol configuration by ID: trading sessions, swap rates, margin requirements, tick size, lot size, and all parameters. Use get_symbols to find the symbol ID first.",
    getSymbolDetailsSchema.shape,
    toolHandler((params) => getSymbolDetails(restClient, params)),
  );

  server.tool(
    "health_check",
    "Check if Trade Server is running and responsive. Returns current server time, which mode this server runs in (manager/admin) and, when signed in with a manager login/password, the account number. Use to verify connectivity before other operations.",
    healthCheckSchema.shape,
    toolHandler(async () => {
      const account = managerAccount?.() ?? null;
      return {
        ...((await healthCheck(restClient)) as Record<string, unknown>),
        mode: "admin",
        ...(account != null ? { account } : {}),
      };
    }),
  );

  // === RESOURCES ===

  server.resource(
    "symbols",
    "trade://symbols",
    { description: "List of all available trading symbols with IDs and names" },
    async () => {
      const result = await getSymbols(restClient, {});
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

  server.resource(
    "groups",
    "trade://groups",
    { description: "List of all trading groups" },
    async () => {
      const result = await getGroups(restClient);
      return {
        contents: [
          {
            uri: "trade://groups",
            text: JSON.stringify(result, null, 2),
            mimeType: "application/json",
          },
        ],
      };
    },
  );

  server.resource(
    "accounts",
    "trade://accounts",
    { description: "List of all trading accounts" },
    async () => {
      const result = await getAllAccounts(restClient);
      return {
        contents: [
          {
            uri: "trade://accounts",
            text: JSON.stringify(result, null, 2),
            mimeType: "application/json",
          },
        ],
      };
    },
  );

  server.resource(
    "connectors",
    "trade://connectors",
    { description: "List of all liquidity connectors" },
    async () => {
      const result = await getLiquidityConnectors(restClient);
      return {
        contents: [
          {
            uri: "trade://connectors",
            text: JSON.stringify(result, null, 2),
            mimeType: "application/json",
          },
        ],
      };
    },
  );
}
