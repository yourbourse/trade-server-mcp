# Tools Reference

The complete reference for every tool the Trade Server MCP exposes, in both modes:

- **[Client mode](#client-mode-30-tools)** — 30 tools, all scoped to your own trading account.
- **[Admin mode](#admin-mode-42-tools)** — 42 tools with server-wide scope, for broker
  administrators.

For each tool you'll find the description your AI sees (verbatim, as registered with the MCP
server), a parameter table, and one realistic example call. Tools are grouped by category.
Each mode also exposes [MCP resources](#resources-client-mode), listed at the end of its
section. Differences between same-named tools in the two modes are summarized in
[Cross-mode differences](#cross-mode-differences).

Setup is covered in [Getting Started](./GETTING_STARTED.md) and
[Configuration](./CONFIGURATION.md). Persona guides: [Admin Mode](./ADMIN_MODE.md),
[Client Mode](./CLIENT_MODE.md).

> **Conventions used below:** all times are **microseconds since epoch** unless stated
> otherwise. Quantities are in **lots**. Example values are placeholders — substitute your own
> account, order, and position IDs.

---

## Client mode (30 tools)

Every client-mode tool operates on **your account only** — there is no `accountId` parameter
anywhere, because your sign-in token already identifies the account.

### Trading (13 tools)

The four money-movers — placing an order, closing a position, a hedged close, and closing
everything — are **confirm-before-execute**: each is a `*_plan` + `*_commit` pair. The `*_plan`
tool validates the request and returns a plain-language preview (summary, live quote, free margin)
plus a single-use `commitToken` (valid ~5 minutes) **without touching the market**; the `*_commit`
tool takes only that token and executes the previewed order. Nothing reaches the market until you
commit.

#### `place_order_plan`

> STEP 1 of placing an order — preview a new order on YOUR account WITHOUT executing. Validates the request and returns a plain-language summary, the live quote, your free margin, and a commitToken. Show the preview to the user; ONLY after they confirm, call place_order_commit with that token. If required details are missing (symbol, side, quantity, order type, time-in-force) it returns exactly what's needed instead of guessing. Nothing is sent to the market.

All order parameters are optional at the plan step — if any required detail is missing, the tool reports exactly what's needed instead of guessing. On success it returns a `preview` (summary, live quote, free margin) and a single-use `commitToken`.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `symbol` | string | No | Symbol name, e.g. EURUSD |
| `side` | `"buy"` \| `"sell"` | No | Order side |
| `quantity` | number (positive) | No | Volume in lots, e.g. 0.1 |
| `orderType` | `"Market"` \| `"Limit"` \| `"Stop"` \| `"StopLimit"` | No | Order type |
| `timeInForce` | `"FOK"` \| `"IOC"` \| `"GTC"` \| `"GTD"` \| `"Day"` \| `"Ms"` | No | Time in force. Use IOC or FOK for Market orders |
| `limitPrice` | number | No | Limit price (for Limit/StopLimit) |
| `stopPrice` | number | No | Stop price (for Stop/StopLimit) |
| `stopLoss` | number | No | Stop loss price |
| `takeProfit` | number | No | Take profit price |
| `comment` | string | No | Order comment |

Example:

```json
{
  "symbol": "EURUSD",
  "side": "buy",
  "quantity": 0.1,
  "orderType": "Market",
  "timeInForce": "IOC",
  "stopLoss": 1.0750,
  "takeProfit": 1.0950,
  "comment": "breakout entry"
}
```

#### `place_order_commit`

> STEP 2 — execute the order previewed by place_order_plan. Requires the commitToken from that preview; the order is fixed at plan time and cannot be changed here. This places a LIVE order via an AI assistant — only call after the user has reviewed the preview and explicitly confirmed.

Executes the order previewed by `place_order_plan`. Takes only the token; the order details were fixed at plan time.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `commitToken` | string | Yes | The commitToken returned by place_order_plan |

Example:

```json
{
  "commitToken": "plan_3f8e1c2a-9b4d-4e6f-8a1b-2c3d4e5f6a7b"
}
```

#### `modify_order`

> Modify one of your working orders (price or quantity). Only pending orders (Limit/Stop/StopLimit) can be modified. Provide only the fields you want to change.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `orderId` | number | Yes | Order ID to modify |
| `quantity` | number | No | New remaining quantity in lots |
| `limitPrice` | number | No | New limit price |
| `stopPrice` | number | No | New stop price |

Example:

```json
{
  "orderId": 12345,
  "limitPrice": 1.0820
}
```

#### `cancel_order`

> Cancel one of your working (pending) orders by ID. Returns an error if the order is already filled or cancelled.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `orderId` | number | Yes | Order ID to cancel |

Example:

```json
{
  "orderId": 12345
}
```

#### `modify_order_sltp`

> Set or change stop loss / take profit on one of your pending orders. Omit a field to cancel that side.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `orderId` | number | Yes | Order ID to modify |
| `stopLoss` | number | No | New stop loss price. Omit to cancel existing SL. |
| `takeProfit` | number | No | New take profit price. Omit to cancel existing TP. |

Example:

```json
{
  "orderId": 12345,
  "stopLoss": 1.0750,
  "takeProfit": 1.0950
}
```

#### `modify_position_sltp`

> Set, modify or remove stop loss and/or take profit on one of your open positions. Pass 0 (or omit a field) to remove that side; omit both to remove both. To change only one side, re-send the other side's current value or it will be removed.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `positionId` | number | Yes | Position ID |
| `stopLoss` | number | No | New stop loss price (0 or omit to remove) |
| `takeProfit` | number | No | New take profit price (0 or omit to remove) |

Example:

```json
{
  "positionId": 67890,
  "stopLoss": 1.0780,
  "takeProfit": 0
}
```

#### `close_position_plan`

> STEP 1 of closing one of YOUR positions — preview WITHOUT executing; returns a commitToken. Needs positionId (optional quantity for a partial close). Show the preview; only after you confirm, call close_position_commit. Nothing is sent.

Both parameters are optional at the plan step; if `positionId` is missing the tool reports what's needed. On success it returns a `preview` and a single-use `commitToken`.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `positionId` | number | No | Position ID to close |
| `quantity` | number | No | Partial close volume in lots. Omit for full close |

Example:

```json
{
  "positionId": 67890,
  "quantity": 0.05
}
```

#### `close_position_commit`

> STEP 2 — execute the close previewed by close_position_plan. Requires the commitToken. Places a LIVE closing order — only after you have reviewed the preview and confirmed.

Executes the close previewed by `close_position_plan`. Takes only the token.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `commitToken` | string | Yes | The commitToken returned by close_position_plan |

Example:

```json
{
  "commitToken": "plan_7c1d2e3f-4a5b-4c6d-8e9f-0a1b2c3d4e5f"
}
```

#### `close_by_plan`

> STEP 1 of a hedged close (two opposite positions, same symbol) — preview WITHOUT executing; returns a commitToken. Needs positionId + positionById. Only meaningful on hedging accounts. Show the preview; only after you confirm, call close_by_commit. Nothing is sent.

Both parameters are optional at the plan step; any missing required field is reported back. On success it returns a `preview` and a single-use `commitToken`.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `positionId` | number | No | Position ID to close |
| `positionById` | number | No | Opposite position ID to close against |

Example:

```json
{
  "positionId": 67890,
  "positionById": 67891
}
```

#### `close_by_commit`

> STEP 2 — execute the hedged close previewed by close_by_plan. Requires the commitToken. Places a LIVE close — only after you have reviewed the preview and confirmed.

Executes the hedged close previewed by `close_by_plan`. Takes only the token.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `commitToken` | string | Yes | The commitToken returned by close_by_plan |

Example:

```json
{
  "commitToken": "plan_9a2b3c4d-5e6f-4a7b-8c9d-1e2f3a4b5c6d"
}
```

#### `cancel_all_orders`

> Cancel ALL of your working orders in one call. Optionally filter by symbol. Returns count of cancelled orders.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `symbol` | string | No | Only cancel orders for this symbol |

Example:

```json
{
  "symbol": "EURUSD"
}
```

#### `close_all_positions_plan`

> STEP 1 — preview closing ALL of YOUR open positions (optionally filtered by symbol) WITHOUT executing; returns a commitToken. High-impact. Show the preview; only after you confirm, call close_all_positions_commit. Nothing is sent.

No required fields — a `commitToken` is always issued. On success it returns a `preview` and a single-use `commitToken`. High-impact: the disclosure names the blast radius.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `symbol` | string | No | Only close positions for this symbol |

Example:

```json
{}
```

#### `close_all_positions_commit`

> STEP 2 — execute the close-all previewed by close_all_positions_plan. Requires the commitToken. LIVE and high-impact (closes every matching position) — only after you have reviewed the preview and confirmed.

Executes the close-all previewed by `close_all_positions_plan`. Takes only the token.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `commitToken` | string | Yes | The commitToken returned by close_all_positions_plan |

Example:

```json
{
  "commitToken": "plan_b4c5d6e7-8f9a-4b1c-9d3e-4f5a6b7c8d9e"
}
```

### Read trading (4 tools)

#### `get_working_orders`

> Get your active/working (pending) orders. Optionally filter by symbol.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `symbol` | string | No | Filter by symbol |
| `limit` | number | No | Max results to return |

Example:

```json
{
  "symbol": "EURUSD"
}
```

#### `get_order_history`

> Get your historical orders (completed, cancelled, rejected). Optionally filter by symbol and time range. Times are microseconds since epoch.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `symbol` | string | No | Filter by symbol |
| `from` | number | No | Start time (microseconds since epoch) |
| `to` | number | No | End time (microseconds since epoch) |
| `limit` | number | No | Max results to return |

Example:

```json
{
  "symbol": "EURUSD",
  "from": 1767225600000000,
  "to": 1769904000000000,
  "limit": 50
}
```

#### `get_open_positions`

> Get your open positions with unrealized P/L. Optionally filter by symbol.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `symbol` | string | No | Filter by symbol |
| `limit` | number | No | Max results to return |

Example:

```json
{}
```

#### `get_trade_history`

> Get your historical trade executions (fills). Optionally filter by symbol and time range. Times are microseconds since epoch.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `symbol` | string | No | Filter by symbol |
| `from` | number | No | Start time (microseconds since epoch) |
| `to` | number | No | End time (microseconds since epoch) |
| `limit` | number | No | Max results to return |

Example:

```json
{
  "from": 1767225600000000,
  "limit": 100
}
```

### Account (5 tools)

#### `get_account_state`

> Get your account's financial state: balance, equity, margin, free margin, margin level, unrealized P/L.

No parameters.

Example:

```json
{}
```

#### `get_account_summary`

> Get a complete snapshot of your account in one call: financial state, all open positions, and all working orders.

No parameters.

Example:

```json
{}
```

#### `get_balances`

> Get your account's balances/collateral per asset.

No parameters.

> **Note:** Specified in the Trade Server API but not yet implemented in server releases
> at the time of writing — the server closes the connection when called. All other tools
> work; this tool starts working automatically once a release ships the endpoint.

Example:

```json
{}
```

#### `get_transfer_history`

> Get your cash transfer history (deposits, withdrawals, adjustments). Times are microseconds since epoch.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `from` | number | No | Start time (microseconds since epoch) |
| `to` | number | No | End time (microseconds since epoch) |
| `limit` | number | No | Max results |

Example:

```json
{
  "from": 1767225600000000,
  "limit": 20
}
```

#### `get_limits`

> Get the API rate limits that apply to your session.

No parameters.

> **Note:** Specified in the Trade Server API but not yet implemented in server releases
> at the time of writing — the server closes the connection when called. All other tools
> work; this tool starts working automatically once a release ships the endpoint.

Example:

```json
{}
```

### Market data (7 tools)

#### `get_quote`

> Get the current bid/ask quote for a symbol.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `symbol` | string | Yes | Symbol name, e.g. EURUSD |

Example:

```json
{
  "symbol": "EURUSD"
}
```

#### `get_quotes`

> Get current bid/ask quotes for multiple symbols at once. More efficient than calling get_quote in a loop.

Accepts up to **50** symbols per call and runs at most 8 lookups concurrently. Requests with more than 50 symbols are rejected.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `symbols` | string[] (1–50) | Yes | Array of symbol names, e.g. ['EURUSD', 'GBPUSD'] (max 50) |

Example:

```json
{
  "symbols": ["EURUSD", "GBPUSD", "USDJPY"]
}
```

#### `get_market_depth`

> Get the Level 2 order book (market depth) for a symbol. Default 10 price levels.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `symbol` | string | Yes | Symbol name, e.g. EURUSD |
| `priceLevel` | number | No | Number of price levels (default 10) |

Example:

```json
{
  "symbol": "EURUSD",
  "priceLevel": 5
}
```

#### `get_symbols`

> List trading symbols available to your account. Optionally filter by glob pattern (e.g. 'EUR*').

| Parameter | Type | Required | Description |
|---|---|---|---|
| `filter` | string | No | Symbol name filter pattern (e.g. EUR*) |

Example:

```json
{
  "filter": "EUR*"
}
```

#### `get_symbol_details`

> Get complete configuration for a symbol: trading sessions, swap rates, tick size, lot size. Look up is by symbol name.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `symbolName` | string | Yes | Symbol name, e.g. EURUSD (client API looks up by name, not ID) |

Example:

```json
{
  "symbolName": "EURUSD"
}
```

#### `get_candles`

> Get OHLCV candlestick data. Intervals: 1M, 5M, 15M, 30M, 1H, 4H, D, W, M.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `symbolName` | string | Yes | Symbol name, e.g. EURUSD |
| `interval` | `"1M"` \| `"5M"` \| `"15M"` \| `"30M"` \| `"1H"` \| `"4H"` \| `"D"` \| `"W"` \| `"M"` | Yes | Candle interval |
| `from` | number | No | Start time (microseconds since epoch) |
| `to` | number | No | End time (microseconds since epoch) |
| `maxResults` | number | No | Max candles to return (1-1000) |

Example:

```json
{
  "symbolName": "EURUSD",
  "interval": "1H",
  "maxResults": 100
}
```

#### `get_conversion_rate`

> Get a currency conversion rate (e.g. EUR to USD) using your group's configured price source.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `from` | string | Yes | Source currency code, e.g. EUR |
| `to` | string | Yes | Target currency code, e.g. USD |

Example:

```json
{
  "from": "EUR",
  "to": "USD"
}
```

### Utility (1 tool)

#### `health_check`

> Check the Trade Server is running and responsive. Returns current server time, which mode this server runs in (trader/client vs manager/admin) and, when signed in with a login/password, the account number.

No parameters.

Example:

```json
{}
```

Example response:

```json
{
  "now": "2026-07-02T14:25:12.610779+00:00",
  "version": "25.1.167",
  "mode": "client",
  "account": 12345
}
```

`account` appears only for login/password sign-ins; static key/token setups report mode only.

### Resources (client mode)

Client mode registers **1 MCP resource**:

| Resource | URI | Description |
|---|---|---|
| `symbols` | `trade://symbols` | List of trading symbols available to your account |

---

## Admin mode (42 tools)

Admin-mode tools have **server-wide scope**: tools that act on an account take an `accountId`
parameter, and read tools can query across all accounts. See [Admin Mode](./ADMIN_MODE.md) for
the persona guide.

### Trading (19 tools)

The four money-movers — placing an order, closing a position, a hedged close, and closing
everything — are **confirm-before-execute**: each is a `*_plan` + `*_commit` pair. The `*_plan`
tool validates the request (admin money-movers always need the target `accountId`) and returns a
plain-language preview plus a single-use `commitToken` (valid ~5 minutes) **without touching the
market**; the `*_commit` tool takes only that token and executes the previewed order. Nothing
reaches the market until you commit.

#### `place_order_plan`

> STEP 1 of placing an order on a client account — preview WITHOUT executing. Validates and returns the order summary (including the target account) plus a commitToken; if required details are missing (account, symbol, side, quantity, order type, time-in-force) it returns exactly what's needed. Show the preview; only after the user confirms, call place_order_commit. Nothing is sent.

All parameters are optional at the plan step — if any required detail (including `accountId`) is missing, the tool reports exactly what's needed instead of guessing. On success it returns a `preview` (summary naming the target account, and, where available, live quote and free margin) and a single-use `commitToken`.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `accountId` | number | No | Trading account ID (login) |
| `symbol` | string | No | Symbol name, e.g. EURUSD |
| `side` | `"buy"` \| `"sell"` | No | Order side |
| `quantity` | number (positive) | No | Volume in lots, e.g. 0.1 |
| `orderType` | `"Market"` \| `"Limit"` \| `"Stop"` \| `"StopLimit"` | No | Order type |
| `timeInForce` | `"FOK"` \| `"IOC"` \| `"GTC"` \| `"GTD"` \| `"Day"` \| `"Ms"` | No | Time in force. Use IOC or FOK for Market orders |
| `limitPrice` | number | No | Limit price (for Limit/StopLimit) |
| `stopPrice` | number | No | Stop price (for Stop/StopLimit) |
| `stopLoss` | number | No | Stop loss price |
| `takeProfit` | number | No | Take profit price |
| `marginCheck` | boolean | No | Perform margin check. Default true |
| `comment` | string | No | Order comment |

Example:

```json
{
  "accountId": 12345,
  "symbol": "EURUSD",
  "side": "buy",
  "quantity": 0.1,
  "orderType": "Limit",
  "timeInForce": "GTC",
  "limitPrice": 1.0820,
  "takeProfit": 1.0950
}
```

#### `place_order_commit`

> STEP 2 — execute the order previewed by place_order_plan on the client account. Requires the commitToken from that preview. Places a LIVE order via an AI assistant — only call after the user has reviewed the preview and explicitly confirmed.

Executes the order previewed by `place_order_plan`. Takes only the token; the order details (including the target account) were fixed at plan time.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `commitToken` | string | Yes | The commitToken returned by place_order_plan |

Example:

```json
{
  "commitToken": "plan_d6e7f8a9-0b1c-4d2e-8f4a-5b6c7d8e9f0a"
}
```

#### `cancel_order`

> Cancel a working (pending) order by its ID. Returns error if the order is already filled or cancelled.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `accountId` | number | Yes | Trading account ID |
| `orderId` | number | Yes | Order ID to cancel |

Example:

```json
{
  "accountId": 12345,
  "orderId": 67890
}
```

#### `modify_order`

> Modify a working order's price or quantity. Only pending orders (Limit/Stop/StopLimit) can be modified. Provide only the fields you want to change.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `accountId` | number | Yes | Trading account ID |
| `orderId` | number | Yes | Order ID to modify |
| `quantity` | number | No | New remaining quantity in lots |
| `limitPrice` | number | No | New limit price |
| `stopPrice` | number | No | New stop price |

Example:

```json
{
  "accountId": 12345,
  "orderId": 67890,
  "limitPrice": 1.0815
}
```

#### `get_working_orders`

> Get all active/working (pending) orders. Optionally filter by accountId and/or symbol. Returns order ID, type, side, price, quantity, and status.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `accountId` | number | No | Filter by account ID |
| `symbol` | string | No | Filter by symbol |

Example:

```json
{
  "accountId": 12345
}
```

#### `get_open_positions`

> Get all open positions with unrealized P/L. Optionally filter by accountId and/or symbol. Each position shows ID, symbol, side, quantity, open price, and current P/L.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `accountId` | number | No | Filter by account ID |
| `symbol` | string | No | Filter by symbol |

Example:

```json
{
  "accountId": 12345,
  "symbol": "EURUSD"
}
```

#### `close_position_plan`

> STEP 1 — preview closing a client account's position WITHOUT executing; returns a commitToken. Needs accountId + positionId (optional quantity for a partial close). Show the preview; only after the user confirms, call close_position_commit. Nothing is sent.

All parameters are optional at the plan step; if `accountId` or `positionId` is missing the tool reports what's needed. On success it returns a `preview` and a single-use `commitToken`.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `accountId` | number | No | Trading account ID |
| `positionId` | number | No | Position ID to close |
| `quantity` | number | No | Partial close volume in lots. Omit for full close |

Example:

```json
{
  "accountId": 12345,
  "positionId": 67890
}
```

#### `close_position_commit`

> STEP 2 — execute the close previewed by close_position_plan. Requires the commitToken. Places a LIVE closing order — only after explicit user confirmation.

Executes the close previewed by `close_position_plan`. Takes only the token.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `commitToken` | string | Yes | The commitToken returned by close_position_plan |

Example:

```json
{
  "commitToken": "plan_e1f2a3b4-c5d6-4e7f-8a9b-0c1d2e3f4a5b"
}
```

#### `modify_position_sltp`

> Set, modify, or remove stop loss and/or take profit on an open position. Set price to 0 to remove an existing SL/TP.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `accountId` | number | Yes | Trading account ID |
| `positionId` | number | Yes | Position ID |
| `stopLoss` | number | No | New stop loss price (0 to remove) |
| `takeProfit` | number | No | New take profit price (0 to remove) |

Example:

```json
{
  "accountId": 12345,
  "positionId": 67890,
  "stopLoss": 1.0780
}
```

#### `get_trade_history`

> Get historical trade executions (fills). Optionally filter by account, symbol, and time range. Times are in microseconds since epoch. Returns executed price, quantity, side, and timestamp.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `accountId` | number | No | Filter by account ID |
| `symbol` | string | No | Filter by symbol |
| `from` | number | No | Start time (microseconds since epoch) |
| `to` | number | No | End time (microseconds since epoch) |
| `limit` | number | No | Max results to return |

Example:

```json
{
  "accountId": 12345,
  "from": 1767225600000000,
  "limit": 100
}
```

#### `get_order_history`

> Get historical orders (completed, cancelled, rejected). Optionally filter by account, symbol, and time range. Times are in microseconds since epoch.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `accountId` | number | No | Filter by account ID |
| `symbol` | string | No | Filter by symbol |
| `from` | number | No | Start time (microseconds since epoch) |
| `to` | number | No | End time (microseconds since epoch) |
| `limit` | number | No | Max results to return |

Example:

```json
{
  "accountId": 12345,
  "symbol": "EURUSD",
  "limit": 50
}
```

#### `cancel_all_orders`

> Cancel all working orders on an account in one call. Optionally filter by symbol to only cancel orders for a specific instrument. Returns count of cancelled orders.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `accountId` | number | Yes | Trading account ID |
| `symbol` | string | No | Only cancel orders for this symbol |

Example:

```json
{
  "accountId": 12345,
  "symbol": "EURUSD"
}
```

#### `close_all_positions_plan`

> STEP 1 — preview closing ALL of a client account's open positions (optionally filtered by symbol) WITHOUT executing; returns a commitToken. High-impact — needs accountId. Show the preview; only after the user confirms, call close_all_positions_commit. Nothing is sent.

Both parameters are optional at the plan step; if `accountId` is missing the tool reports what's needed. On success it returns a `preview` and a single-use `commitToken`. High-impact: the disclosure names the blast radius.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `accountId` | number | No | Trading account ID |
| `symbol` | string | No | Only close positions for this symbol |

Example:

```json
{
  "accountId": 12345
}
```

#### `close_all_positions_commit`

> STEP 2 — execute the close-all previewed by close_all_positions_plan. Requires the commitToken. LIVE and high-impact (closes every matching position) — only after explicit user confirmation.

Executes the close-all previewed by `close_all_positions_plan`. Takes only the token.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `commitToken` | string | Yes | The commitToken returned by close_all_positions_plan |

Example:

```json
{
  "commitToken": "plan_a7b8c9d0-1e2f-4a3b-9c6d-7e8f9a0b1c2d"
}
```

#### `close_by_plan`

> STEP 1 — preview a hedged close (two opposite positions on the same symbol) on a client account WITHOUT executing; returns a commitToken. Needs accountId + positionId + positionById. Show the preview; only after the user confirms, call close_by_commit. Nothing is sent.

All parameters are optional at the plan step; any missing required field is reported back. On success it returns a `preview` and a single-use `commitToken`.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `accountId` | number | No | Trading account ID |
| `positionId` | number | No | Position ID to close |
| `positionById` | number | No | Opposite position ID to close against |

Example:

```json
{
  "accountId": 12345,
  "positionId": 67890,
  "positionById": 67891
}
```

#### `close_by_commit`

> STEP 2 — execute the hedged close previewed by close_by_plan. Requires the commitToken. Places a LIVE close — only after explicit user confirmation.

Executes the hedged close previewed by `close_by_plan`. Takes only the token.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `commitToken` | string | Yes | The commitToken returned by close_by_plan |

Example:

```json
{
  "commitToken": "plan_c2d3e4f5-6a7b-4c8d-9e0f-1a2b3c4d5e6f"
}
```

#### `modify_order_sltp`

> Modify stop loss and/or take profit on a pending order. Omit a field to cancel that side's SL/TP.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `accountId` | number | Yes | Trading account ID |
| `orderId` | number | Yes | Order ID to modify |
| `stopLoss` | number | No | New stop loss price. Omit to cancel existing SL. |
| `takeProfit` | number | No | New take profit price. Omit to cancel existing TP. |

Example:

```json
{
  "accountId": 12345,
  "orderId": 67890,
  "takeProfit": 1.0950
}
```

#### `force_delete_order`

> Force-delete a stuck or corrupted order that normal cancel cannot remove. Admin safety net — use only when cancel_order fails. This bypasses normal order lifecycle.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `accountId` | number | Yes | Trading account ID |
| `orderId` | number | Yes | Order ID to force-delete (removes stuck/corrupted orders that normal cancel can't remove) |

Example:

```json
{
  "accountId": 12345,
  "orderId": 67890
}
```

#### `get_account_summary`

> Get a complete account snapshot in one call: balance/equity/margin state, all open positions, and all working orders. Saves 3 round-trips vs calling each individually.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `accountId` | number | Yes | Trading account ID |

Example:

```json
{
  "accountId": 12345
}
```

### Account (6 tools)

#### `get_account_state`

> Get account financial state: balance, equity, margin, free margin, margin level, unrealized P/L. Use get_account_summary for a full snapshot including positions and orders.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `accountId` | number | Yes | Trading account ID (login) |

Example:

```json
{
  "accountId": 12345
}
```

#### `get_account_info`

> Get trading account configuration: group assignment, client owner, leverage, read-only flag, and other settings. Does NOT include financial state (use get_account_state for that).

| Parameter | Type | Required | Description |
|---|---|---|---|
| `accountId` | number | Yes | Trading account ID (login) |

Example:

```json
{
  "accountId": 12345
}
```

#### `get_all_accounts`

> List all trading accounts on the server with their basic info (ID, group, client). For financial state of all accounts, use get_balances instead.

No parameters.

Example:

```json
{}
```

#### `cash_transfer`

> Make a cash deposit, withdrawal, or adjustment. Use positive amount for deposit, negative for withdrawal. Type 'Balance' is standard deposit/withdrawal. Supports: Balance, Credit, Fee, Adjustment, Bonus, Commission, Interest, Dividend, Tax.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `accountId` | number | Yes | Trading account ID |
| `amount` | number | Yes | Transfer amount |
| `type` | `"Balance"` \| `"Credit"` \| `"Fee"` \| `"Adjustment"` \| `"Bonus"` \| `"CreditBonus"` \| `"Commission"` \| `"Interest"` \| `"Dividend"` \| `"Tax"` | Yes | Transfer type (Balance = deposit/withdrawal, use negative amount for withdrawal) |
| `currency` | string | No (default `"USD"`) | Currency or asset name |
| `comment` | string | No | Transfer comment |

Example:

```json
{
  "accountId": 12345,
  "amount": 1000,
  "type": "Balance",
  "currency": "USD",
  "comment": "initial deposit"
}
```

#### `get_transfer_history`

> Get cash transfer history (deposits, withdrawals, adjustments). Optionally filter by account and time range. Times are in microseconds since epoch.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `accountId` | number | No | Filter by account ID |
| `from` | number | No | Start time (microseconds since epoch) |
| `to` | number | No | End time (microseconds since epoch) |
| `limit` | number | No | Max results |

Example:

```json
{
  "accountId": 12345,
  "limit": 20
}
```

#### `get_balances`

> Get financial state (balance, equity, margin, P/L) for ALL accounts at once. Useful for portfolio-level overview. For a single account use get_account_state.

No parameters.

Example:

```json
{}
```

### Market data (7 tools)

#### `get_quote`

> Get current bid/ask quote for a single symbol via WebSocket L1 feed. Returns latest bid, ask, and spread. For multiple symbols at once, use get_quotes.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `symbol` | string | Yes | Symbol name, e.g. EURUSD |
| `groupId` | number | No | Group ID (default 1) |

Example:

```json
{
  "symbol": "EURUSD"
}
```

#### `get_market_depth`

> Get Level 2 order book (market depth) for a symbol via WebSocket. Returns multiple price levels of bids and asks with their volumes. Default 10 levels.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `symbol` | string | Yes | Symbol name, e.g. EURUSD |
| `groupId` | number | No | Group ID (default 1) |
| `priceLevel` | number | No | Number of price levels (default 10) |

Example:

```json
{
  "symbol": "EURUSD",
  "priceLevel": 5
}
```

#### `get_symbols`

> List available trading symbols. Optionally filter by glob pattern (e.g. 'EUR*' for all EUR pairs, '*USD' for all USD pairs, '*' for all). Returns symbol name, ID, and basic config.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `filter` | string | No | Symbol name filter pattern (e.g. EUR*) |

Example:

```json
{
  "filter": "*USD"
}
```

#### `get_candles`

> Get OHLCV candlestick chart data. Intervals: 1M, 5M, 15M, 30M, 1H, 4H, D (daily), W (weekly), M (monthly). Max 1000 candles per request. Specify symbol by ID or name+groupId.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `symbolId` | number | No | Symbol ID (use this or symbolName+groupId) |
| `symbolName` | string | No | Symbol name (requires groupId) |
| `groupId` | number | No | Group ID (required with symbolName) |
| `interval` | `"1M"` \| `"5M"` \| `"15M"` \| `"30M"` \| `"1H"` \| `"4H"` \| `"D"` \| `"W"` \| `"M"` | Yes | Candle interval |
| `from` | number | No | Start time (microseconds since epoch) |
| `to` | number | No | End time (microseconds since epoch) |
| `maxResults` | number | No | Max candles to return (1-1000, default 1000) |

Example:

```json
{
  "symbolName": "EURUSD",
  "groupId": 1,
  "interval": "1H",
  "maxResults": 100
}
```

#### `get_conversion_rate`

> Get currency conversion rate (e.g. EUR→USD) within a specific group context. The rate uses the group's configured price source.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `groupId` | number | Yes | Group ID for conversion context |
| `from` | string | Yes | Source currency code, e.g. EUR |
| `to` | string | Yes | Target currency code, e.g. USD |

Example:

```json
{
  "groupId": 1,
  "from": "EUR",
  "to": "USD"
}
```

#### `get_quotes`

> Get live bid/ask quotes for multiple symbols at once in parallel. More efficient than calling get_quote in a loop. Returns array of {symbol, quote} objects.

Accepts up to **50** symbols per call and runs at most 8 lookups concurrently. Requests with more than 50 symbols are rejected.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `symbols` | string[] (1–50) | Yes | Array of symbol names, e.g. ['EURUSD', 'GBPUSD'] (max 50) |
| `groupId` | number | No | Group ID (default 1) |

Example:

```json
{
  "symbols": ["EURUSD", "GBPUSD", "USDJPY"]
}
```

#### `get_indicator`

> Calculate a technical indicator (RSI, MACD, EMA, SMA, BollingerBands, ATR, Stochastic, ADX, VWAP, CCI) on symbol candle data. Returns the current value and last 20 data points. Fetches candles internally — no need to call get_candles first.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `symbolName` | string | Yes | Symbol name, e.g. EURUSD |
| `groupId` | number | No | Group ID (default 1) |
| `interval` | `"1M"` \| `"5M"` \| `"15M"` \| `"30M"` \| `"1H"` \| `"4H"` \| `"D"` \| `"W"` \| `"M"` | Yes | Candle interval: 1M, 5M, 15M, 30M, 1H, 4H, D, W, M |
| `indicator` | `"RSI"` \| `"MACD"` \| `"EMA"` \| `"SMA"` \| `"BollingerBands"` \| `"ATR"` \| `"Stochastic"` \| `"ADX"` \| `"VWAP"` \| `"CCI"` | Yes | Indicator name |
| `period` | number | No | Lookback period (default 14) |
| `candles` | number | No | Number of candles to fetch (default 100, max 1000) |

Example:

```json
{
  "symbolName": "EURUSD",
  "interval": "1H",
  "indicator": "RSI",
  "period": 14
}
```

### Configuration (9 tools)

#### `get_groups`

> List all trading groups with their IDs and names. Groups define trading conditions (spreads, commissions, leverage) for accounts assigned to them.

No parameters.

Example:

```json
{}
```

#### `get_group`

> Get detailed group configuration by ID: margin settings, commission rules, symbol overrides, and trading permissions.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `groupId` | number | Yes | Group unique identifier |

Example:

```json
{
  "groupId": 1
}
```

#### `get_clients`

> List all clients (account owners). Each client can own multiple trading accounts.

No parameters.

Example:

```json
{}
```

#### `get_order_routing`

> Get current order routing configuration. Shows all routing rules with their filters and actions. Returns version number needed for set_order_routing.

No parameters.

Example:

```json
{}
```

#### `set_order_routing`

> Replace ALL order routing rules at once. Requires the current version number (get from get_order_routing). CAUTION: this overwrites everything. Prefer add_routing_rule/remove_routing_rule for safe atomic changes.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `version` | number | Yes | Current routing config version (get from get_order_routing) |
| `routing` | array of rule objects | Yes | Array of routing rules |
| `routing[].a` | array of objects | Yes | Actions array (e.g. [{type:'Execute',connectorId:1}]) |
| `routing[].f` | array of objects | No | Filters array (optional) |

Example:

```json
{
  "version": 7,
  "routing": [
    {
      "a": [{ "type": "Execute", "connectorId": 1 }],
      "f": [{ "type": "Symbol", "value": "EURUSD" }]
    }
  ]
}
```

#### `add_routing_rule`

> Add a single routing rule to the existing configuration without affecting other rules. Safer than set_order_routing. Automatically reads current version and appends.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `actions` | array of objects | Yes | Actions array (e.g. [{type:'Execute',connectorId:1}]) |
| `filters` | array of objects | No | Filters array (optional, e.g. [{type:'Symbol',value:'EURUSD'}]) |

Example:

```json
{
  "actions": [{ "type": "Execute", "connectorId": 1 }],
  "filters": [{ "type": "Symbol", "value": "EURUSD" }]
}
```

#### `remove_routing_rule`

> Remove a single routing rule by its zero-based index. Use get_order_routing first to see current rules and their indices. Safer than set_order_routing.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `index` | number | Yes | Zero-based index of the routing rule to remove (use get_order_routing to see current rules) |

Example:

```json
{
  "index": 2
}
```

#### `get_liquidity_connectors`

> List all configured liquidity connectors (LPs). Shows connector ID, name, type, and connection status.

No parameters.

Example:

```json
{}
```

#### `get_symbol_details`

> Get complete symbol configuration by ID: trading sessions, swap rates, margin requirements, tick size, lot size, and all parameters. Use get_symbols to find the symbol ID first.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `symbolId` | number | Yes | Symbol unique identifier |

Example:

```json
{
  "symbolId": 42
}
```

### Utility (1 tool)

#### `health_check`

> Check if Trade Server is running and responsive. Returns current server time, which mode this server runs in (manager/admin) and, when signed in with a manager login/password, the account number. Use to verify connectivity before other operations.

No parameters.

Example:

```json
{}
```

Example response (manager login/password sign-in):

```json
{
  "now": "2026-07-02T14:25:12.610779+00:00",
  "version": "25.1.167",
  "mode": "admin",
  "account": 1
}
```

`account` appears only for login/password sign-ins; static key/token setups report mode only.

### Resources (admin mode)

Admin mode registers **4 MCP resources**:

| Resource | URI | Description |
|---|---|---|
| `symbols` | `trade://symbols` | List of all available trading symbols with IDs and names |
| `groups` | `trade://groups` | List of all trading groups |
| `accounts` | `trade://accounts` | List of all trading accounts |
| `connectors` | `trade://connectors` | List of all liquidity connectors |

---

## Cross-mode differences

Many tools share a name across the two modes but are not identical. The differences that
matter in practice:

- **No `accountId` in client mode — ever.** Your sign-in token already identifies your
  account, so client-mode tools have no account parameter at all. In admin mode, every tool
  that acts on an account requires (or accepts as a filter) an `accountId`.

- **`get_balances` means different things.** In client mode it returns **your account's
  balances/collateral per asset**. In admin mode it returns the **financial state (balance,
  equity, margin, P/L) of every account on the server** — a portfolio-level overview.

- **`get_symbol_details` looks up by name vs by ID.** The client API looks symbols up by
  **name** (`symbolName`, e.g. `"EURUSD"`); the admin API looks them up by numeric
  **`symbolId`** (use `get_symbols` first to find it).

- **`get_quote`, `get_quotes`, and `get_market_depth` use different transports.** In client
  mode these are plain REST requests. In admin mode they stream from the server's
  **WebSocket** market-data feed (L1 for quotes, L2 for depth) and accept an optional
  `groupId` to select the pricing context (default 1).

- **`get_candles` symbol selection differs.** Client mode takes `symbolName` only. Admin mode
  takes either a `symbolId` or a `symbolName` + `groupId` pair.

- **`get_conversion_rate` group context.** Admin mode requires an explicit `groupId`; client
  mode uses your account's group automatically.

- **`marginCheck` is admin-only.** Admin `place_order_plan` can disable the margin check
  (`marginCheck: false`); client orders are always margin-checked by the server.

- **Client-only tool:** `get_limits` (your session's API rate limits) exists only in client
  mode. The 13 admin-only tools are listed in [Admin Mode](./ADMIN_MODE.md#admin-only-tools).

- **Resources:** client mode exposes 1 resource (`trade://symbols`, scoped to your account);
  admin mode exposes 4 (`trade://symbols`, `trade://groups`, `trade://accounts`,
  `trade://connectors`).

## Where next

- [Admin Mode](./ADMIN_MODE.md) — the broker administrator's guide
- [Client Mode](./CLIENT_MODE.md) — the trader's guide
- [Configuration](./CONFIGURATION.md) — environment variables and config examples
- [Usage Examples](./USAGE_EXAMPLES.md) — realistic conversation patterns
- [Troubleshooting](./TROUBLESHOOTING.md) — when a tool call fails
