# Admin Mode — the Broker Administrator's Guide

Admin mode is for the people who **run** the Trade Server: brokers and their operations teams.
Where a trader sees one account, admin mode sees the whole server — every account, every
group, every routing rule, every liquidity connector. It exposes **42 tools and 4 MCP
resources** (see the [Tools Reference](./TOOLS_REFERENCE.md#admin-mode-42-tools) for every
parameter and example).

What that means in practice:

- Trading and account tools take an **`accountId`** — you act *on behalf of* any account on
  the server.
- Read tools can sweep **across all accounts** (`get_all_accounts`, `get_balances`,
  `get_working_orders` and `get_open_positions` without an account filter).
- You can change server configuration: order routing rules and cash balances.

If you are a trader with a single account, you want [Client Mode](./CLIENT_MODE.md) instead.

## Credentials

Admin mode authenticates with a static **admin API key pair** — `YB_API_KEY` +
`YB_SECRET_KEY` — issued from your YourBourse server administration setup. The secret key
never leaves your machine; it is only used to sign requests locally. Full setup, including
copy-paste config for Claude Desktop and Claude Code, is in
[Configuration](./CONFIGURATION.md). How signing works is in
[Authentication](./AUTHENTICATION.md).

## Admin-only tools

Thirteen tools exist only in admin mode. When to reach for each:

| Tool | Use it when... |
|---|---|
| `get_all_accounts` | You need the list of every trading account on the server (IDs, groups, owners). |
| `get_account_info` | You want one account's *configuration* — group, owner, leverage, read-only flag — not its money. |
| `cash_transfer` | You are depositing, withdrawing, or adjusting an account's balance (see [transfer types](#cash-transfer-types) below). |
| `get_groups` | You need the list of trading groups and their IDs. |
| `get_group` | You are reviewing one group's margin settings, commission rules, or symbol overrides. |
| `get_clients` | You need the list of clients (account owners — each can own multiple accounts). |
| `get_order_routing` | You are reviewing the current routing rules — always the first step before any routing change. |
| `add_routing_rule` | You want to add one routing rule without touching the others (the safe default). |
| `remove_routing_rule` | You want to delete one routing rule by its index (the safe default). |
| `set_order_routing` | You intend to replace the **entire** routing table at once — use deliberately. |
| `get_liquidity_connectors` | You are checking which LP connectors exist and whether they are connected. |
| `get_indicator` | You want a technical indicator (RSI, MACD, EMA, ...) computed over a symbol's candles. |
| `force_delete_order` | **Last resort only:** a stuck or corrupted order survives `cancel_order`. This bypasses the normal order lifecycle. |

(Conversely, one tool is client-only: `get_limits`. Everything else exists in both modes —
with the scope and parameter differences listed in
[Cross-mode differences](./TOOLS_REFERENCE.md#cross-mode-differences).)

## Managing order routing

The routing tools are designed around a **read → small change** workflow:

1. **`get_order_routing`** first, always. It returns every rule (actions + filters) **and the
   current version number** of the routing configuration.
2. For a single change, prefer the atomic tools:
   - **`add_routing_rule`** appends one rule. It reads the current version itself and leaves
     all existing rules untouched.
   - **`remove_routing_rule`** deletes one rule by its zero-based index (as shown by
     `get_order_routing`) and reports what was removed.
3. **`set_order_routing`** replaces the **whole table** in one shot and requires you to pass
   the version number you got from `get_order_routing`. If the configuration changed since
   you read it, the version no longer matches and the edit is rejected — re-read and retry.
   Use this only when you genuinely mean to rewrite everything; for everyday changes the
   atomic tools are safer.

## Cash transfer types

`cash_transfer` moves money on an account. The sign of `amount` decides direction: positive =
deposit, negative = withdrawal. The `type` labels the transfer in the account's history:

- **`Balance`** — the standard deposit/withdrawal type. When in doubt, use this.
- **`Credit`** / **`CreditBonus`** — credit facilities granted by the broker.
- **`Bonus`** — promotional bonus.
- **`Fee`**, **`Commission`** — charges.
- **`Adjustment`** — manual corrections.
- **`Interest`**, **`Dividend`**, **`Tax`** — corporate-action and accrual entries.

Currency defaults to `USD`; set the `currency` parameter for any other currency or asset.
Review past movements with `get_transfer_history`.

## Operational notes

- **Quotes and depth stream over WebSocket.** In admin mode, `get_quote`, `get_quotes`, and
  `get_market_depth` take their data from the server's WebSocket market-data feed (L1 for
  quotes, L2 for depth) rather than REST. The connection is opened on first use and reused.
  Each accepts an optional `groupId` (default 1) selecting the pricing context — quote a
  symbol the way a specific group sees it.

- **`get_indicator` computes locally.** It fetches candles from the server, then calculates
  the indicator (RSI, MACD, EMA, SMA, BollingerBands, ATR, Stochastic, ADX, VWAP, CCI) on
  your machine and returns the current value plus the last 20 data points. No indicator
  configuration is needed on the server, and there is no need to call `get_candles` first.

- **Concurrency protection on reads and edits (ETag / If-Match).** The REST layer remembers
  the `ETag` a server response carries for each endpoint. On later requests to the same
  endpoint it sends that tag back — `If-None-Match` on reads, `If-Match` on writes. The
  practical effect: if someone else changed a configuration object between your read and your
  edit, the server can reject the write with a precondition failure (HTTP 412) instead of
  silently overwriting their change. Routing edits add an explicit version-number check on
  top (see [Managing order routing](#managing-order-routing)). If an edit is rejected this
  way, re-read the object and apply your change again.

- **Money-movers are confirm-before-execute.** Placing an order, closing a position, a hedged
  close, and closing everything are each split into a **preview** step and a **commit** step. The
  AI calls the `*_plan` tool first — it validates the request (admin money-movers always need the
  target `accountId`; `place_order_plan` also accepts the optional `marginCheck`) and returns a
  plain-language order summary naming the target account, plus a single-use `commitToken` good for
  five minutes, **without touching the market**. After you review the preview and confirm, the AI
  calls the matching `*_commit` tool with that token to execute. If a required detail is missing,
  the plan step says exactly what's needed rather than guessing — and there is no single-step,
  un-confirmed way to move money on an account.

- **Order placement is never retried on connection errors.** Like client mode, admin-mode
  order placements opt out of transport-level retries so a dropped connection can never turn
  into a duplicate fill. Read and modify calls retry once on a connection failure. Details in
  [Authentication](./AUTHENTICATION.md).

## Where next

- [Tools Reference](./TOOLS_REFERENCE.md) — all 42 admin tools with parameters and examples
- [Configuration](./CONFIGURATION.md) — admin credential setup
- [Authentication](./AUTHENTICATION.md) — request signing with the admin key pair
- [Security](./SECURITY.md) — key-handling guarantees and recommendations
- [Usage Examples](./USAGE_EXAMPLES.md) — including broker-side conversation patterns
