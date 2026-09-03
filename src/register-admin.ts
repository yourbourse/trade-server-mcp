import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { RestClient } from "./rest-client.js";
import { WsClient } from "./ws-client.js";
import { toolHandler } from "./tool-handler.js";
import {
  bulkUpdatePlanSchema,
  bulkUpdatePlan,
  bulkUpdateCommitSchema,
  bulkUpdateCommit,
  bulkDeletePlanSchema,
  bulkDeletePlan,
  bulkDeleteCommitSchema,
  bulkDeleteCommit,
} from "./tools/admin/bulk.js";

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
  cancelAllOrdersPlanSchema,
  cancelAllOrdersPlan,
  cancelAllOrdersCommitSchema,
  cancelAllOrdersCommit,
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
  getWorkingOrderSchema,
  getWorkingOrder,
  getHistoricalOrderSchema,
  getHistoricalOrder,
  getPositionSchema,
  getPosition,
  getTradeSchema,
  getTrade,
  updatePositionPlanSchema,
  updatePositionPlan,
  updatePositionCommitSchema,
  updatePositionCommit,
  deletePositionPlanSchema,
  deletePositionPlan,
  deletePositionCommitSchema,
  deletePositionCommit,
  updateTradePlanSchema,
  updateTradePlan,
  updateTradeCommitSchema,
  updateTradeCommit,
  deleteTradePlanSchema,
  deleteTradePlan,
  deleteTradeCommitSchema,
  deleteTradeCommit,
} from "./tools/admin/trading.js";

import {
  getAccountStateSchema,
  getAccountState,
  getAccountInfoSchema,
  getAccountInfo,
  getAllAccountsSchema,
  getAllAccounts,
  cashTransferPlanSchema,
  cashTransferPlan,
  cashTransferCommitSchema,
  cashTransferCommit,
  getTransferHistorySchema,
  getTransferHistory,
  getBalancesSchema,
  getBalances,
  getTransferSchema,
  getTransfer,
  getMarginCallAccountsSchema,
  getMarginCallAccounts,
  setAccountPasswordPlanSchema,
  setAccountPasswordPlan,
  setAccountPasswordCommitSchema,
  setAccountPasswordCommit,
  changeMyPasswordPlanSchema,
  changeMyPasswordPlan,
  changeMyPasswordCommitSchema,
  changeMyPasswordCommit,
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
  getConversionRatesBatchSchema,
  getConversionRatesBatch,
  updateCandlePlanSchema,
  updateCandlePlan,
  updateCandleCommitSchema,
  updateCandleCommit,
  deleteCandlePlanSchema,
  deleteCandlePlan,
  deleteCandleCommitSchema,
  deleteCandleCommit,
  bulkUpdateCandlesPlanSchema,
  bulkUpdateCandlesPlan,
  bulkUpdateCandlesCommitSchema,
  bulkUpdateCandlesCommit,
  bulkDeleteCandlesPlanSchema,
  bulkDeleteCandlesPlan,
  bulkDeleteCandlesCommitSchema,
  bulkDeleteCandlesCommit,
} from "./tools/admin/market-data.js";

import {
  getGroupsSchema,
  getGroups,
  getGroupSchema,
  getGroup,
  updateGroupPlanSchema,
  updateGroupPlan,
  updateGroupCommitSchema,
  updateGroupCommit,
  deleteGroupPlanSchema,
  deleteGroupPlan,
  deleteGroupCommitSchema,
  deleteGroupCommit,
  getClientsSchema,
  getClients,
  getOrderRoutingSchema,
  getOrderRouting,
  setOrderRoutingPlanSchema,
  setOrderRoutingPlan,
  setOrderRoutingCommitSchema,
  setOrderRoutingCommit,
  addRoutingRulePlanSchema,
  addRoutingRulePlan,
  addRoutingRuleCommitSchema,
  addRoutingRuleCommit,
  removeRoutingRulePlanSchema,
  removeRoutingRulePlan,
  removeRoutingRuleCommitSchema,
  removeRoutingRuleCommit,
  getLiquidityConnectorsSchema,
  getLiquidityConnectors,
  getSymbolDetailsSchema,
  getSymbolDetails,
  updateSymbolPlanSchema,
  updateSymbolPlan,
  updateSymbolCommitSchema,
  updateSymbolCommit,
  deleteSymbolPlanSchema,
  deleteSymbolPlan,
  deleteSymbolCommitSchema,
  deleteSymbolCommit,
  updateAccountPlanSchema,
  updateAccountPlan,
  updateAccountCommitSchema,
  updateAccountCommit,
  deleteAccountPlanSchema,
  deleteAccountPlan,
  deleteAccountCommitSchema,
  deleteAccountCommit,
  getClientSchema,
  getClient,
  updateClientPlanSchema,
  updateClientPlan,
  updateClientCommitSchema,
  updateClientCommit,
  deleteClientPlanSchema,
  deleteClientPlan,
  deleteClientCommitSchema,
  deleteClientCommit,
  getLiquidityConnectorSchema,
  getLiquidityConnector,
  updateLiquidityConnectorPlanSchema,
  updateLiquidityConnectorPlan,
  updateLiquidityConnectorCommitSchema,
  updateLiquidityConnectorCommit,
  deleteLiquidityConnectorPlanSchema,
  deleteLiquidityConnectorPlan,
  deleteLiquidityConnectorCommitSchema,
  deleteLiquidityConnectorCommit,
  getHolidaysSchema,
  getHolidays,
  getHolidaySchema,
  getHoliday,
  updateHolidayPlanSchema,
  updateHolidayPlan,
  updateHolidayCommitSchema,
  updateHolidayCommit,
  deleteHolidayPlanSchema,
  deleteHolidayPlan,
  deleteHolidayCommitSchema,
  deleteHolidayCommit,
  getManagersSchema,
  getManagers,
  getManagerSchema,
  getManager,
  getManagerSelfSchema,
  getManagerSelf,
  updateManagerPlanSchema,
  updateManagerPlan,
  updateManagerCommitSchema,
  updateManagerCommit,
  deleteManagerPlanSchema,
  deleteManagerPlan,
  deleteManagerCommitSchema,
  deleteManagerCommit,
  getTokensSchema,
  getTokens,
  createSymbolPlanSchema,
  createSymbolPlan,
  createSymbolCommitSchema,
  createSymbolCommit,
  createGroupPlanSchema,
  createGroupPlan,
  createGroupCommitSchema,
  createGroupCommit,
  createHolidayPlanSchema,
  createHolidayPlan,
  createHolidayCommitSchema,
  createHolidayCommit,
  createClientPlanSchema,
  createClientPlan,
  createClientCommitSchema,
  createClientCommit,
  createAccountPlanSchema,
  createAccountPlan,
  createAccountCommitSchema,
  createAccountCommit,
  healthCheckSchema,
  healthCheck,
  getJournalSchema,
  getJournal,
  getStatementsSchema,
  getStatements,
  getEmailServicesSchema,
  getEmailServices,
  findClientByExternalIdSchema,
  findClientByExternalId,
  createManagerPlanSchema,
  createManagerPlan,
  createManagerCommitSchema,
  createManagerCommit,
  createLiquidityConnectorPlanSchema,
  createLiquidityConnectorPlan,
  createLiquidityConnectorCommitSchema,
  createLiquidityConnectorCommit,
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

  server.registerTool(
    "cancel_all_orders_plan",
    {
      description:
        "STEP 1 — preview cancelling ALL working orders on a client account (optionally filtered by symbol) WITHOUT executing; returns a commitToken. High-impact — needs accountId. Show the preview; only after the user confirms, call cancel_all_orders_commit. Nothing is sent.",
      inputSchema: cancelAllOrdersPlanSchema.shape,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    toolHandler((params) => cancelAllOrdersPlan(restClient, params)),
  );
  server.registerTool(
    "cancel_all_orders_commit",
    {
      description:
        "STEP 2 — execute the cancel-all previewed by cancel_all_orders_plan. Requires the commitToken. LIVE and high-impact (cancels every matching working order) — only after explicit user confirmation.",
      inputSchema: cancelAllOrdersCommitSchema.shape,
      annotations: { destructiveHint: true, openWorldHint: true },
    },
    toolHandler((params) => cancelAllOrdersCommit(restClient, params)),
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

  server.registerTool(
    "cash_transfer_plan",
    {
      description:
        "STEP 1 of a cash transfer (deposit / withdrawal / adjustment) on a client account — preview WITHOUT executing. Validates and returns the account, amount, direction, and type plus a commitToken; if required details are missing (account, amount, type) it returns exactly what's needed. Positive amount = deposit, negative = withdrawal. Show the preview; only after the user confirms, call cash_transfer_commit. Nothing is moved.",
      inputSchema: cashTransferPlanSchema.shape,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    toolHandler((params) => cashTransferPlan(restClient, params)),
  );
  server.registerTool(
    "cash_transfer_commit",
    {
      description:
        "STEP 2 — execute the cash transfer previewed by cash_transfer_plan. Requires the commitToken from that preview. This moves REAL money irreversibly via an AI assistant — only call after the user has reviewed the preview and explicitly confirmed.",
      inputSchema: cashTransferCommitSchema.shape,
      annotations: { destructiveHint: true, openWorldHint: true },
    },
    toolHandler((params) => cashTransferCommit(restClient, params)),
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

  server.registerTool(
    "update_group_plan",
    {
      description:
        "STEP 1 of editing a trading group's server-wide configuration — preview WITHOUT writing. Reads the current group (by groupId from get_groups), applies your partial `updates` (any top-level fields, e.g. defaultLeverage, marginCall, stopout), and returns a field-by-field diff plus a commitToken. Show the diff; only after the user confirms, call update_group_commit. Nothing is written.",
      inputSchema: updateGroupPlanSchema.shape,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    toolHandler((params) => updateGroupPlan(restClient, params)),
  );
  server.registerTool(
    "update_group_commit",
    {
      description:
        "STEP 2 — apply the group edit previewed by update_group_plan. Requires the commitToken from that preview. Writes a LIVE, server-wide change to the group via an AI assistant — only call after the user has reviewed the diff and explicitly confirmed.",
      inputSchema: updateGroupCommitSchema.shape,
      annotations: { destructiveHint: true, openWorldHint: true },
    },
    toolHandler((params) => updateGroupCommit(restClient, params)),
  );
  server.registerTool(
    "delete_group_plan",
    {
      description:
        "STEP 1 of deleting a trading group — preview WITHOUT deleting. Reads the target group (by groupId from get_groups) and returns what will be deleted plus a commitToken. Show it; only after the user confirms, call delete_group_commit. Nothing is deleted.",
      inputSchema: deleteGroupPlanSchema.shape,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    toolHandler((params) => deleteGroupPlan(restClient, params)),
  );
  server.registerTool(
    "delete_group_commit",
    {
      description:
        "STEP 2 — delete the group previewed by delete_group_plan. Requires the commitToken from that preview. Permanently removes a trading group server-wide via an AI assistant — only call after the user has reviewed the target and explicitly confirmed.",
      inputSchema: deleteGroupCommitSchema.shape,
      annotations: { destructiveHint: true, openWorldHint: true },
    },
    toolHandler((params) => deleteGroupCommit(restClient, params)),
  );

  server.tool(
    "get_clients",
    "List all clients (account owners). Each client can own multiple trading accounts.",
    getClientsSchema.shape,
    toolHandler(() => getClients(restClient)),
  );

  server.tool(
    "get_client",
    "Get one client's full record by ID (type, status, person/company details). Use get_clients to find the ID.",
    getClientSchema.shape,
    toolHandler((params) => getClient(restClient, params)),
  );
  server.registerTool(
    "update_client_plan",
    {
      description:
        "STEP 1 of editing a client — preview WITHOUT writing. Reads the client (by clientId from get_clients), applies your partial `updates`, and returns a diff plus a commitToken. Show it; only after the user confirms, call update_client_commit.",
      inputSchema: updateClientPlanSchema.shape,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    toolHandler((params) => updateClientPlan(restClient, params)),
  );
  server.registerTool(
    "update_client_commit",
    {
      description:
        "STEP 2 — apply the client edit previewed by update_client_plan. Requires its commitToken. Writes a LIVE change via an AI assistant — only after explicit user confirmation.",
      inputSchema: updateClientCommitSchema.shape,
      annotations: { destructiveHint: true, openWorldHint: true },
    },
    toolHandler((params) => updateClientCommit(restClient, params)),
  );
  server.registerTool(
    "delete_client_plan",
    {
      description:
        "STEP 1 of deleting a client — preview WITHOUT deleting. Reads the target (by clientId) and returns what will be removed plus a commitToken. Only after the user confirms, call delete_client_commit.",
      inputSchema: deleteClientPlanSchema.shape,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    toolHandler((params) => deleteClientPlan(restClient, params)),
  );
  server.registerTool(
    "delete_client_commit",
    {
      description:
        "STEP 2 — delete the client previewed by delete_client_plan. Requires its commitToken. Permanently removes the client via an AI assistant — only after explicit user confirmation.",
      inputSchema: deleteClientCommitSchema.shape,
      annotations: { destructiveHint: true, openWorldHint: true },
    },
    toolHandler((params) => deleteClientCommit(restClient, params)),
  );

  server.registerTool(
    "update_account_plan",
    {
      description:
        "STEP 1 of editing a trading account — preview WITHOUT writing. Reads the account (by accountId from get_all_accounts / get_account_info), applies your partial `updates` (e.g. leverage, enabled, allowTrading, groupId), and returns a diff plus a commitToken. Only after the user confirms, call update_account_commit.",
      inputSchema: updateAccountPlanSchema.shape,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    toolHandler((params) => updateAccountPlan(restClient, params)),
  );
  server.registerTool(
    "update_account_commit",
    {
      description:
        "STEP 2 — apply the account edit previewed by update_account_plan. Requires its commitToken. Writes a LIVE change via an AI assistant — only after explicit user confirmation.",
      inputSchema: updateAccountCommitSchema.shape,
      annotations: { destructiveHint: true, openWorldHint: true },
    },
    toolHandler((params) => updateAccountCommit(restClient, params)),
  );
  server.registerTool(
    "delete_account_plan",
    {
      description:
        "STEP 1 of deleting a trading account — preview WITHOUT deleting. Reads the target (by accountId) and returns what will be removed plus a commitToken. Only after the user confirms, call delete_account_commit.",
      inputSchema: deleteAccountPlanSchema.shape,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    toolHandler((params) => deleteAccountPlan(restClient, params)),
  );
  server.registerTool(
    "delete_account_commit",
    {
      description:
        "STEP 2 — delete the account previewed by delete_account_plan. Requires its commitToken. Permanently removes the trading account via an AI assistant — only after explicit user confirmation.",
      inputSchema: deleteAccountCommitSchema.shape,
      annotations: { destructiveHint: true, openWorldHint: true },
    },
    toolHandler((params) => deleteAccountCommit(restClient, params)),
  );

  server.tool(
    "get_liquidity_connector",
    "Get one liquidity connector's full configuration by ID (type, priority, enabled, session parameters, symbols). Use get_liquidity_connectors to find the ID.",
    getLiquidityConnectorSchema.shape,
    toolHandler((params) => getLiquidityConnector(restClient, params)),
  );
  server.registerTool(
    "update_liquidity_connector_plan",
    {
      description:
        "STEP 1 of editing a liquidity connector (LP) — preview WITHOUT writing. Reads the connector (by connectorId from get_liquidity_connectors), applies your partial `updates` (e.g. isEnabled, priority, sessionParameters, symbols), and returns a diff plus a commitToken. Only after the user confirms, call update_liquidity_connector_commit.",
      inputSchema: updateLiquidityConnectorPlanSchema.shape,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    toolHandler((params) => updateLiquidityConnectorPlan(restClient, params)),
  );
  server.registerTool(
    "update_liquidity_connector_commit",
    {
      description:
        "STEP 2 — apply the connector edit previewed by update_liquidity_connector_plan. Requires its commitToken. Writes a LIVE change via an AI assistant — only after explicit user confirmation.",
      inputSchema: updateLiquidityConnectorCommitSchema.shape,
      annotations: { destructiveHint: true, openWorldHint: true },
    },
    toolHandler((params) => updateLiquidityConnectorCommit(restClient, params)),
  );
  server.registerTool(
    "delete_liquidity_connector_plan",
    {
      description:
        "STEP 1 of deleting a liquidity connector — preview WITHOUT deleting. Reads the target (by connectorId) and returns what will be removed plus a commitToken. Only after the user confirms, call delete_liquidity_connector_commit.",
      inputSchema: deleteLiquidityConnectorPlanSchema.shape,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    toolHandler((params) => deleteLiquidityConnectorPlan(restClient, params)),
  );
  server.registerTool(
    "delete_liquidity_connector_commit",
    {
      description:
        "STEP 2 — delete the connector previewed by delete_liquidity_connector_plan. Requires its commitToken. Permanently removes the liquidity connector via an AI assistant — only after explicit user confirmation.",
      inputSchema: deleteLiquidityConnectorCommitSchema.shape,
      annotations: { destructiveHint: true, openWorldHint: true },
    },
    toolHandler((params) => deleteLiquidityConnectorCommit(restClient, params)),
  );

  server.registerTool(
    "delete_symbol_plan",
    {
      description:
        "STEP 1 of deleting a symbol — preview WITHOUT deleting. Reads the target (by symbolId from get_symbols) and returns what will be removed plus a commitToken. Only after the user confirms, call delete_symbol_commit.",
      inputSchema: deleteSymbolPlanSchema.shape,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    toolHandler((params) => deleteSymbolPlan(restClient, params)),
  );
  server.registerTool(
    "delete_symbol_commit",
    {
      description:
        "STEP 2 — delete the symbol previewed by delete_symbol_plan. Requires its commitToken. Permanently removes the symbol server-wide via an AI assistant — only after explicit user confirmation.",
      inputSchema: deleteSymbolCommitSchema.shape,
      annotations: { destructiveHint: true, openWorldHint: true },
    },
    toolHandler((params) => deleteSymbolCommit(restClient, params)),
  );

  server.tool(
    "get_holidays",
    "List all trading-calendar holidays (server-wide market closures / special hours). Each holiday has a date (year 0 = every year), enabled flag, symbol mask, and optional working hours.",
    getHolidaysSchema.shape,
    toolHandler(() => getHolidays(restClient)),
  );
  server.tool(
    "get_holiday",
    "Get one holiday's full record by ID. Use get_holidays to find the ID.",
    getHolidaySchema.shape,
    toolHandler((params) => getHoliday(restClient, params)),
  );
  server.registerTool(
    "update_holiday_plan",
    {
      description:
        "STEP 1 of editing a holiday (or creating one via edit) — preview WITHOUT writing. Reads the holiday (by holidayId from get_holidays), applies your partial `updates` (date, enabled, symbolMask, workingHours), and returns a diff plus a commitToken. Only after the user confirms, call update_holiday_commit.",
      inputSchema: updateHolidayPlanSchema.shape,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    toolHandler((params) => updateHolidayPlan(restClient, params)),
  );
  server.registerTool(
    "update_holiday_commit",
    {
      description:
        "STEP 2 — apply the holiday edit previewed by update_holiday_plan. Requires its commitToken. Writes a LIVE change to the trading calendar via an AI assistant — only after explicit user confirmation.",
      inputSchema: updateHolidayCommitSchema.shape,
      annotations: { destructiveHint: true, openWorldHint: true },
    },
    toolHandler((params) => updateHolidayCommit(restClient, params)),
  );
  server.registerTool(
    "delete_holiday_plan",
    {
      description:
        "STEP 1 of deleting a holiday — preview WITHOUT deleting. Reads the target (by holidayId) and returns what will be removed plus a commitToken. Only after the user confirms, call delete_holiday_commit.",
      inputSchema: deleteHolidayPlanSchema.shape,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    toolHandler((params) => deleteHolidayPlan(restClient, params)),
  );
  server.registerTool(
    "delete_holiday_commit",
    {
      description:
        "STEP 2 — delete the holiday previewed by delete_holiday_plan. Requires its commitToken. Permanently removes the calendar entry via an AI assistant — only after explicit user confirmation.",
      inputSchema: deleteHolidayCommitSchema.shape,
      annotations: { destructiveHint: true, openWorldHint: true },
    },
    toolHandler((params) => deleteHolidayCommit(restClient, params)),
  );

  server.tool(
    "get_managers",
    "List all manager accounts and their permission flags (view/configure symbols, groups, holidays, cluster, etc.).",
    getManagersSchema.shape,
    toolHandler(() => getManagers(restClient)),
  );
  server.tool(
    "get_manager",
    "Get one manager's permissions by their account ID. Use get_managers to find the ID.",
    getManagerSchema.shape,
    toolHandler((params) => getManager(restClient, params)),
  );
  server.tool(
    "get_manager_self",
    "Get the currently signed-in manager's own account ID and permissions.",
    getManagerSelfSchema.shape,
    toolHandler(() => getManagerSelf(restClient)),
  );
  server.registerTool(
    "update_manager_plan",
    {
      description:
        "STEP 1 of editing a manager's permissions (or granting a new manager via edit) — preview WITHOUT writing. Reads the manager (by accountId from get_managers), applies your partial `updates` (permission flags), and returns a diff plus a commitToken. Only after the user confirms, call update_manager_commit.",
      inputSchema: updateManagerPlanSchema.shape,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    toolHandler((params) => updateManagerPlan(restClient, params)),
  );
  server.registerTool(
    "update_manager_commit",
    {
      description:
        "STEP 2 — apply the manager-permission edit previewed by update_manager_plan. Requires its commitToken. Writes a LIVE permission change via an AI assistant — only after explicit user confirmation.",
      inputSchema: updateManagerCommitSchema.shape,
      annotations: { destructiveHint: true, openWorldHint: true },
    },
    toolHandler((params) => updateManagerCommit(restClient, params)),
  );
  server.registerTool(
    "delete_manager_plan",
    {
      description:
        "STEP 1 of revoking a manager (deleting their permissions) — preview WITHOUT deleting. Reads the target (by accountId) and returns what will be removed plus a commitToken. Only after the user confirms, call delete_manager_commit.",
      inputSchema: deleteManagerPlanSchema.shape,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    toolHandler((params) => deleteManagerPlan(restClient, params)),
  );
  server.registerTool(
    "delete_manager_commit",
    {
      description:
        "STEP 2 — revoke the manager previewed by delete_manager_plan. Requires its commitToken. Permanently removes the manager's permissions via an AI assistant — only after explicit user confirmation.",
      inputSchema: deleteManagerCommitSchema.shape,
      annotations: { destructiveHint: true, openWorldHint: true },
    },
    toolHandler((params) => deleteManagerCommit(restClient, params)),
  );

  server.tool(
    "get_tokens",
    "List issued API access tokens (metadata: which login, expiration, etc. — not the secret values).",
    getTokensSchema.shape,
    toolHandler(() => getTokens(restClient)),
  );

  server.registerTool(
    "create_symbol_plan",
    {
      description:
        "STEP 1 of creating a NEW symbol — preview WITHOUT writing. Clone an existing symbol as a template via `fromId` (recommended) and/or pass a full `object`, then set `overrides` (at least a unique name/path). id and version are forced to 0. Returns the object that will be created plus a commitToken. Only after the user confirms, call create_symbol_commit.",
      inputSchema: createSymbolPlanSchema.shape,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    toolHandler((params) => createSymbolPlan(restClient, params)),
  );
  server.registerTool(
    "create_symbol_commit",
    {
      description:
        "STEP 2 — create the symbol previewed by create_symbol_plan. Requires its commitToken. Adds a LIVE symbol server-wide via an AI assistant — only after explicit user confirmation.",
      inputSchema: createSymbolCommitSchema.shape,
      annotations: { destructiveHint: true, openWorldHint: true },
    },
    toolHandler((params) => createSymbolCommit(restClient, params)),
  );
  server.registerTool(
    "create_group_plan",
    {
      description:
        "STEP 1 of creating a NEW trading group — preview WITHOUT writing. Clone a template via `fromId` and/or pass a full `object`, then set `overrides` (name, currency, leverage, …). id/version forced to 0. Returns the object + a commitToken. Only after the user confirms, call create_group_commit.",
      inputSchema: createGroupPlanSchema.shape,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    toolHandler((params) => createGroupPlan(restClient, params)),
  );
  server.registerTool(
    "create_group_commit",
    {
      description:
        "STEP 2 — create the group previewed by create_group_plan. Requires its commitToken. Adds a LIVE group via an AI assistant — only after explicit user confirmation.",
      inputSchema: createGroupCommitSchema.shape,
      annotations: { destructiveHint: true, openWorldHint: true },
    },
    toolHandler((params) => createGroupCommit(restClient, params)),
  );
  server.registerTool(
    "create_holiday_plan",
    {
      description:
        "STEP 1 of creating a NEW holiday (trading-calendar entry) — preview WITHOUT writing. Pass a full `object` and/or clone via `fromId`, then `overrides` (description, year/month/day, symbolMask, enabled). id/version forced to 0. Returns the object + a commitToken. Only after the user confirms, call create_holiday_commit.",
      inputSchema: createHolidayPlanSchema.shape,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    toolHandler((params) => createHolidayPlan(restClient, params)),
  );
  server.registerTool(
    "create_holiday_commit",
    {
      description:
        "STEP 2 — create the holiday previewed by create_holiday_plan. Requires its commitToken. Adds a LIVE calendar entry via an AI assistant — only after explicit user confirmation.",
      inputSchema: createHolidayCommitSchema.shape,
      annotations: { destructiveHint: true, openWorldHint: true },
    },
    toolHandler((params) => createHolidayCommit(restClient, params)),
  );
  server.registerTool(
    "create_client_plan",
    {
      description:
        "STEP 1 of creating a NEW client (account owner) — preview WITHOUT writing. Clone via `fromId` and/or pass a full `object`, then `overrides` (clientType, status, person/company details). id/version forced to 0. Returns the object + a commitToken. Only after the user confirms, call create_client_commit.",
      inputSchema: createClientPlanSchema.shape,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    toolHandler((params) => createClientPlan(restClient, params)),
  );
  server.registerTool(
    "create_client_commit",
    {
      description:
        "STEP 2 — create the client previewed by create_client_plan. Requires its commitToken. Adds a LIVE client via an AI assistant — only after explicit user confirmation.",
      inputSchema: createClientCommitSchema.shape,
      annotations: { destructiveHint: true, openWorldHint: true },
    },
    toolHandler((params) => createClientCommit(restClient, params)),
  );
  server.registerTool(
    "create_account_plan",
    {
      description:
        "STEP 1 of creating a NEW trading account — preview WITHOUT writing. Clone via `fromId` and/or pass a full `object`, then `overrides` (groupId, clientId, leverage, enabled). A new account REQUIRES a `password` (supplied by the user in overrides/object). id/version forced to 0. Returns the object + a commitToken. Only after the user confirms, call create_account_commit.",
      inputSchema: createAccountPlanSchema.shape,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    toolHandler((params) => createAccountPlan(restClient, params)),
  );
  server.registerTool(
    "create_account_commit",
    {
      description:
        "STEP 2 — create the trading account previewed by create_account_plan. Requires its commitToken. Adds a LIVE trading account via an AI assistant — only after explicit user confirmation, and only when the user has supplied the account password.",
      inputSchema: createAccountCommitSchema.shape,
      annotations: { destructiveHint: true, openWorldHint: true },
    },
    toolHandler((params) => createAccountCommit(restClient, params)),
  );

  server.tool(
    "get_order_routing",
    "Get current order routing configuration. Shows all routing rules with their filters and actions. Returns version number needed for set_order_routing.",
    getOrderRoutingSchema.shape,
    toolHandler(() => getOrderRouting(restClient)),
  );

  server.registerTool(
    "set_order_routing_plan",
    {
      description:
        "STEP 1 — preview REPLACING ALL order routing rules WITHOUT executing; returns a commitToken. Requires the current version number (get from get_order_routing). CAUTION: this overwrites every rule — prefer add_routing_rule_plan/remove_routing_rule_plan for atomic changes. Show the before/after; only after the user confirms, call set_order_routing_commit. Nothing is sent.",
      inputSchema: setOrderRoutingPlanSchema.shape,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    toolHandler((params) => setOrderRoutingPlan(restClient, params)),
  );
  server.registerTool(
    "set_order_routing_commit",
    {
      description:
        "STEP 2 — execute the routing replacement previewed by set_order_routing_plan. Requires the commitToken. LIVE and high-impact (decides how every client order is executed) — only after explicit user confirmation.",
      inputSchema: setOrderRoutingCommitSchema.shape,
      annotations: { destructiveHint: true, openWorldHint: true },
    },
    toolHandler((params) => setOrderRoutingCommit(restClient, params)),
  );

  server.registerTool(
    "add_routing_rule_plan",
    {
      description:
        "STEP 1 — preview adding a single routing rule to the existing configuration WITHOUT executing; returns a commitToken. Other rules are untouched. Show the preview; only after the user confirms, call add_routing_rule_commit. Nothing is sent.",
      inputSchema: addRoutingRulePlanSchema.shape,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    toolHandler((params) => addRoutingRulePlan(restClient, params)),
  );
  server.registerTool(
    "add_routing_rule_commit",
    {
      description:
        "STEP 2 — execute the rule addition previewed by add_routing_rule_plan. Requires the commitToken. LIVE (changes how client orders are executed) — only after explicit user confirmation.",
      inputSchema: addRoutingRuleCommitSchema.shape,
      annotations: { destructiveHint: true, openWorldHint: true },
    },
    toolHandler((params) => addRoutingRuleCommit(restClient, params)),
  );

  server.registerTool(
    "remove_routing_rule_plan",
    {
      description:
        "STEP 1 — preview removing one routing rule by its zero-based index WITHOUT executing; returns a commitToken. Use get_order_routing first to see the rules and their indices. Show which rule would go; only after the user confirms, call remove_routing_rule_commit. Nothing is sent.",
      inputSchema: removeRoutingRulePlanSchema.shape,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    toolHandler((params) => removeRoutingRulePlan(restClient, params)),
  );
  server.registerTool(
    "remove_routing_rule_commit",
    {
      description:
        "STEP 2 — execute the rule removal previewed by remove_routing_rule_plan. Requires the commitToken. LIVE (changes how client orders are executed) — only after explicit user confirmation.",
      inputSchema: removeRoutingRuleCommitSchema.shape,
      annotations: { destructiveHint: true, openWorldHint: true },
    },
    toolHandler((params) => removeRoutingRuleCommit(restClient, params)),
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

  server.registerTool(
    "update_symbol_plan",
    {
      description:
        "STEP 1 of editing a symbol's server-wide configuration — preview WITHOUT writing. Reads the current symbol (by symbolId from get_symbols), applies your partial changes (any top-level fields via `updates`, and/or full `quoteSessions`/`tradeSessions` replacement lists), and returns a field-by-field diff plus a commitToken. Show the diff; only after the user confirms, call update_symbol_commit. Nothing is written.",
      inputSchema: updateSymbolPlanSchema.shape,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    toolHandler((params) => updateSymbolPlan(restClient, params)),
  );
  server.registerTool(
    "update_symbol_commit",
    {
      description:
        "STEP 2 — apply the symbol edit previewed by update_symbol_plan. Requires the commitToken from that preview. Writes a LIVE, server-wide change to the symbol via an AI assistant — only call after the user has reviewed the diff and explicitly confirmed.",
      inputSchema: updateSymbolCommitSchema.shape,
      annotations: { destructiveHint: true, openWorldHint: true },
    },
    toolHandler((params) => updateSymbolCommit(restClient, params)),
  );

  server.registerTool(
    "create_liquidity_connector_plan",
    {
      description:
        "STEP 1 of adding a NEW liquidity connector (LP feed) — preview WITHOUT writing. Clone an existing connector with `fromId` (recommended: copies type, session parameters and symbol list) and/or pass a full `object`, then set `overrides` such as sessionParameters (Host, Port, SenderCompID, TargetCompID, Password), symbols and priority. id/version forced to 0. Only after the user confirms, call create_liquidity_connector_commit.",
      inputSchema: createLiquidityConnectorPlanSchema.shape,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    toolHandler((params) => createLiquidityConnectorPlan(restClient, params)),
  );
  server.registerTool(
    "create_liquidity_connector_commit",
    {
      description:
        "STEP 2 — create the liquidity connector previewed by create_liquidity_connector_plan. Requires its commitToken. Adds a LIVE LP session via an AI assistant — only after explicit user confirmation.",
      inputSchema: createLiquidityConnectorCommitSchema.shape,
      annotations: { destructiveHint: true, openWorldHint: true },
    },
    toolHandler((params) => createLiquidityConnectorCommit(restClient, params)),
  );

  // === BULK (BATCH) OPERATIONS ===

  server.registerTool(
    "bulk_update_plan",
    {
      description:
        "STEP 1 of changing the SAME fields on MANY records at once — preview WITHOUT writing. Pick the record kind with `resource` (symbols, groups, accounts, clients, holidays, managers, liquidity), select with `ids` or a `namePattern` glob ('EUR*', 'Real/*', '*'), and give the fields in `updates`. Returns how many records match, how many actually change (already-matching ones are skipped), the affected names and a commitToken. Only after the user confirms, call bulk_update_commit.",
      inputSchema: bulkUpdatePlanSchema.shape,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    toolHandler((params) => bulkUpdatePlan(restClient, params)),
  );
  server.registerTool(
    "bulk_update_commit",
    {
      description:
        "STEP 2 — apply the bulk change previewed by bulk_update_plan in one batch call. Requires its commitToken. Rewrites MANY LIVE server-wide records via an AI assistant — only after explicit user confirmation.",
      inputSchema: bulkUpdateCommitSchema.shape,
      annotations: { destructiveHint: true, openWorldHint: true },
    },
    toolHandler((params) => bulkUpdateCommit(restClient, params)),
  );
  server.registerTool(
    "bulk_delete_plan",
    {
      description:
        "STEP 1 of deleting MANY records at once — preview WITHOUT deleting. Pick the record kind with `resource` and select with `ids` or a `namePattern` glob. Returns the exact count and the affected names plus a commitToken. Only after the user confirms, call bulk_delete_commit.",
      inputSchema: bulkDeletePlanSchema.shape,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    toolHandler((params) => bulkDeletePlan(restClient, params)),
  );
  server.registerTool(
    "bulk_delete_commit",
    {
      description:
        "STEP 2 — delete everything previewed by bulk_delete_plan in one batch call. Requires its commitToken. Permanently removes MANY LIVE server-wide records via an AI assistant — only after explicit user confirmation.",
      inputSchema: bulkDeleteCommitSchema.shape,
      annotations: { destructiveHint: true, openWorldHint: true },
    },
    toolHandler((params) => bulkDeleteCommit(restClient, params)),
  );
  server.registerTool(
    "bulk_update_candles_plan",
    {
      description:
        "STEP 1 of writing MANY price bars for one symbol and interval in a single call — preview WITHOUT writing. Returns the bar count and time range plus a commitToken. For a single bar use update_candle_plan. Only after the user confirms, call bulk_update_candles_commit.",
      inputSchema: bulkUpdateCandlesPlanSchema.shape,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    toolHandler((params) => bulkUpdateCandlesPlan(restClient, params)),
  );
  server.registerTool(
    "bulk_update_candles_commit",
    {
      description:
        "STEP 2 — write the bars previewed by bulk_update_candles_plan. Requires its commitToken. Rewrites LIVE stored price history via an AI assistant — only after explicit user confirmation.",
      inputSchema: bulkUpdateCandlesCommitSchema.shape,
      annotations: { destructiveHint: true, openWorldHint: true },
    },
    toolHandler((params) => bulkUpdateCandlesCommit(restClient, params)),
  );
  server.registerTool(
    "bulk_delete_candles_plan",
    {
      description:
        "STEP 1 of deleting MANY price bars for one symbol and interval — preview WITHOUT deleting. Returns the bar count and time range plus a commitToken. For a single bar use delete_candle_plan. Only after the user confirms, call bulk_delete_candles_commit.",
      inputSchema: bulkDeleteCandlesPlanSchema.shape,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    toolHandler((params) => bulkDeleteCandlesPlan(restClient, params)),
  );
  server.registerTool(
    "bulk_delete_candles_commit",
    {
      description:
        "STEP 2 — delete the bars previewed by bulk_delete_candles_plan. Requires its commitToken. Permanently removes bars from LIVE price history via an AI assistant — only after explicit user confirmation.",
      inputSchema: bulkDeleteCandlesCommitSchema.shape,
      annotations: { destructiveHint: true, openWorldHint: true },
    },
    toolHandler((params) => bulkDeleteCandlesCommit(restClient, params)),
  );

  // === CHART HISTORY / PASSWORDS ===

  server.registerTool(
    "update_candle_plan",
    {
      description:
        "STEP 1 of rewriting a stored price bar (e.g. to erase a bad-tick spike) — preview WITHOUT writing. Reads the bar currently stored for that symbol/interval/time and shows it next to the values you supplied, plus a commitToken. Bar time is the bar's START, in microseconds since epoch. Only after the user confirms, call update_candle_commit.",
      inputSchema: updateCandlePlanSchema.shape,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    toolHandler((params) => updateCandlePlan(restClient, params)),
  );
  server.registerTool(
    "update_candle_commit",
    {
      description:
        "STEP 2 — write the bar previewed by update_candle_plan. Requires its commitToken. Rewrites LIVE stored price history via an AI assistant — only after explicit user confirmation.",
      inputSchema: updateCandleCommitSchema.shape,
      annotations: { destructiveHint: true, openWorldHint: true },
    },
    toolHandler((params) => updateCandleCommit(restClient, params)),
  );
  server.registerTool(
    "delete_candle_plan",
    {
      description:
        "STEP 1 of deleting a stored price bar — preview WITHOUT deleting. Shows the bar currently stored at that symbol/interval/time plus a commitToken. Only after the user confirms, call delete_candle_commit.",
      inputSchema: deleteCandlePlanSchema.shape,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    toolHandler((params) => deleteCandlePlan(restClient, params)),
  );
  server.registerTool(
    "delete_candle_commit",
    {
      description:
        "STEP 2 — delete the bar previewed by delete_candle_plan. Requires its commitToken. Permanently removes a bar from LIVE price history via an AI assistant — only after explicit user confirmation.",
      inputSchema: deleteCandleCommitSchema.shape,
      annotations: { destructiveHint: true, openWorldHint: true },
    },
    toolHandler((params) => deleteCandleCommit(restClient, params)),
  );
  server.registerTool(
    "set_account_password_plan",
    {
      description:
        "STEP 1 of resetting ANOTHER trading account's password (manager operation) — preview WITHOUT writing. The user must supply the new password; it is never echoed back. Returns the target account plus a commitToken. To change the password of the account this MCP signs in as, use change_my_password_plan instead. Only after the user confirms, call set_account_password_commit.",
      inputSchema: setAccountPasswordPlanSchema.shape,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    toolHandler((params) => setAccountPasswordPlan(restClient, params)),
  );
  server.registerTool(
    "set_account_password_commit",
    {
      description:
        "STEP 2 — apply the password reset previewed by set_account_password_plan. Requires its commitToken. Locks out anyone using the old password — only after explicit user confirmation.",
      inputSchema: setAccountPasswordCommitSchema.shape,
      annotations: { destructiveHint: true, openWorldHint: true },
    },
    toolHandler((params) => setAccountPasswordCommit(restClient, params)),
  );
  server.registerTool(
    "change_my_password_plan",
    {
      description:
        "STEP 1 of changing the password of THE ACCOUNT THIS MCP IS SIGNED IN AS — preview WITHOUT writing. POST /password takes no account id, so this cannot target a client: use set_account_password_plan for that. Committing will break this MCP's stored configuration until YB_PASSWORD is updated. Only after the user confirms, call change_my_password_commit.",
      inputSchema: changeMyPasswordPlanSchema.shape,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    toolHandler((params) => changeMyPasswordPlan(restClient, params)),
  );
  server.registerTool(
    "change_my_password_commit",
    {
      description:
        "STEP 2 — change the signed-in account's own password, as previewed by change_my_password_plan. Requires its commitToken. The MCP configuration must then be updated with the new password or the server stops connecting — only after explicit user confirmation.",
      inputSchema: changeMyPasswordCommitSchema.shape,
      annotations: { destructiveHint: true, openWorldHint: true },
    },
    toolHandler((params) => changeMyPasswordCommit(restClient, params)),
  );

  // === POSITION / TRADE RECORD MAINTENANCE ===

  server.tool(
    "get_position",
    "Get ONE open position by its ID, with symbol, side, volume, open price and unrealized P/L. For a list, use get_open_positions.",
    getPositionSchema.shape,
    toolHandler((params) => getPosition(restClient, params)),
  );
  server.tool(
    "get_trade",
    "Get ONE executed trade by its ID. For a list, use get_trade_history.",
    getTradeSchema.shape,
    toolHandler((params) => getTrade(restClient, params)),
  );
  server.registerTool(
    "update_position_plan",
    {
      description:
        "STEP 1 of correcting an open position's record (volume, open price, swaps, commission, fees) — preview WITHOUT writing. Reads the position by ID, returns a field-by-field diff plus a commitToken. This is a back-office correction, NOT a way to close or trade: use close_position_plan to close. Only after the user confirms, call update_position_commit.",
      inputSchema: updatePositionPlanSchema.shape,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    toolHandler((params) => updatePositionPlan(restClient, params)),
  );
  server.registerTool(
    "update_position_commit",
    {
      description:
        "STEP 2 — apply the position correction previewed by update_position_plan. Requires its commitToken. Rewrites a LIVE client position and its P/L via an AI assistant — only after explicit user confirmation.",
      inputSchema: updatePositionCommitSchema.shape,
      annotations: { destructiveHint: true, openWorldHint: true },
    },
    toolHandler((params) => updatePositionCommit(restClient, params)),
  );
  server.registerTool(
    "delete_position_plan",
    {
      description:
        "STEP 1 of deleting an open position from a client's book — preview WITHOUT deleting. Reads the position and returns what will be removed plus a commitToken. This ERASES the position rather than closing it (use close_position_plan to close at market). Only after the user confirms, call delete_position_commit.",
      inputSchema: deletePositionPlanSchema.shape,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    toolHandler((params) => deletePositionPlan(restClient, params)),
  );
  server.registerTool(
    "delete_position_commit",
    {
      description:
        "STEP 2 — delete the position previewed by delete_position_plan. Requires its commitToken. Permanently removes a LIVE client position via an AI assistant — only after explicit user confirmation.",
      inputSchema: deletePositionCommitSchema.shape,
      annotations: { destructiveHint: true, openWorldHint: true },
    },
    toolHandler((params) => deletePositionCommit(restClient, params)),
  );
  server.registerTool(
    "update_trade_plan",
    {
      description:
        "STEP 1 of correcting an executed trade's record (price, volume, realized profit, swaps, commission, fees) — preview WITHOUT writing. Reads the trade by ID and returns a diff plus a commitToken. Only after the user confirms, call update_trade_commit.",
      inputSchema: updateTradePlanSchema.shape,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    toolHandler((params) => updateTradePlan(restClient, params)),
  );
  server.registerTool(
    "update_trade_commit",
    {
      description:
        "STEP 2 — apply the trade correction previewed by update_trade_plan. Requires its commitToken. Rewrites LIVE trade history and realized P/L via an AI assistant — only after explicit user confirmation.",
      inputSchema: updateTradeCommitSchema.shape,
      annotations: { destructiveHint: true, openWorldHint: true },
    },
    toolHandler((params) => updateTradeCommit(restClient, params)),
  );
  server.registerTool(
    "delete_trade_plan",
    {
      description:
        "STEP 1 of deleting an executed trade from history — preview WITHOUT deleting. Reads the trade and returns what will be removed plus a commitToken. Only after the user confirms, call delete_trade_commit.",
      inputSchema: deleteTradePlanSchema.shape,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    toolHandler((params) => deleteTradePlan(restClient, params)),
  );
  server.registerTool(
    "delete_trade_commit",
    {
      description:
        "STEP 2 — delete the trade previewed by delete_trade_plan. Requires its commitToken. Permanently rewrites LIVE trade history via an AI assistant — only after explicit user confirmation.",
      inputSchema: deleteTradeCommitSchema.shape,
      annotations: { destructiveHint: true, openWorldHint: true },
    },
    toolHandler((params) => deleteTradeCommit(restClient, params)),
  );
  server.registerTool(
    "create_manager_plan",
    {
      description:
        "STEP 1 of granting manager (admin) permissions to a trading account — preview WITHOUT writing. Optionally copy an existing manager's permissions via fromId, then set `permissions` flags. Returns the manager record that will be created plus a commitToken. Use update_manager_plan to change an EXISTING manager. Only after the user confirms, call create_manager_commit.",
      inputSchema: createManagerPlanSchema.shape,
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    toolHandler((params) => createManagerPlan(restClient, params)),
  );
  server.registerTool(
    "create_manager_commit",
    {
      description:
        "STEP 2 — create the manager previewed by create_manager_plan. Requires its commitToken. Grants LIVE server-wide admin permissions via an AI assistant — only after explicit user confirmation.",
      inputSchema: createManagerCommitSchema.shape,
      annotations: { destructiveHint: true, openWorldHint: true },
    },
    toolHandler((params) => createManagerCommit(restClient, params)),
  );

  // === REPORTING / LOOKUPS (read-only) ===

  server.tool(
    "get_journal",
    "Search the server audit journal over a time range: who changed what, plus server events. Filter by severity and a message mask. Times are microseconds since epoch. Use this to answer who modified a symbol or group, and when.",
    getJournalSchema.shape,
    toolHandler((params) => getJournal(restClient, params)),
  );
  server.tool(
    "get_statements",
    "Get daily or monthly account statements for a date, optionally including orders and positions. Scope with accounts, groups, or groupMasks (defaults to all groups).",
    getStatementsSchema.shape,
    toolHandler((params) => getStatements(restClient, params)),
  );
  server.tool(
    "get_email_services",
    "List configured email-service (notification) configurations on the server.",
    getEmailServicesSchema.shape,
    toolHandler(() => getEmailServices(restClient)),
  );
  server.tool(
    "find_client_by_external_id",
    "Find a client by the external identifier your systems assigned them (not the internal client ID). Use get_clients or get_client for internal-ID lookups.",
    findClientByExternalIdSchema.shape,
    toolHandler((params) => findClientByExternalId(restClient, params)),
  );
  server.tool(
    "get_margin_call_accounts",
    "List trading accounts currently in margin call. Scope with accounts, groups, or groupMasks; omit the filter for all accounts.",
    getMarginCallAccountsSchema.shape,
    toolHandler((params) => getMarginCallAccounts(restClient, params)),
  );
  server.tool(
    "get_transfer",
    "Get a single cash transfer (deposit/withdrawal/adjustment) by its ID. Use get_transfer_history to find IDs.",
    getTransferSchema.shape,
    toolHandler((params) => getTransfer(restClient, params)),
  );
  server.tool(
    "get_working_order",
    "Get ONE currently working (pending) order by its ID. For a list, use get_working_orders; for an already completed order, use get_historical_order.",
    getWorkingOrderSchema.shape,
    toolHandler((params) => getWorkingOrder(restClient, params)),
  );
  server.tool(
    "get_historical_order",
    "Get ONE completed/cancelled/rejected order by its ID. For a list, use get_order_history; for a still-pending order, use get_working_order.",
    getHistoricalOrderSchema.shape,
    toolHandler((params) => getHistoricalOrder(restClient, params)),
  );
  server.tool(
    "get_conversion_rates_batch",
    "Resolve several currency conversion rates in one call. For a single pair use get_conversion_rate.",
    getConversionRatesBatchSchema.shape,
    toolHandler((params) => getConversionRatesBatch(restClient, params)),
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
