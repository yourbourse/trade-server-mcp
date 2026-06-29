# Usage Examples

Realistic conversation patterns: what you say to your AI, which tools it calls (in order, with
realistic arguments), and what comes back. The first seven scenarios are **client (trader)
mode**; the last three are **admin (broker) mode only** and are marked as such.

Tool names and parameters below match the [Tools Reference](./TOOLS_REFERENCE.md) exactly —
every call shown is executable as written (substitute your own symbols, IDs, and amounts).
Your AI decides the wording of its answers; what's fixed is the tools and the data they
return.

One pattern recurs in the trading examples: anything that moves money — placing an order,
closing a position, a hedged close, closing everything — is **confirm-before-execute**. Your AI
calls the `*_plan` tool first to preview the order (and get a single-use `commitToken`), shows
you what it's about to do, and only calls the matching `*_commit` tool with that token after you
confirm. **Nothing reaches the market until you commit.**

---

## 1. Account check-in

**You say:** *"How's my account doing? Anything open?"*

**Tool calls:**

1. `get_account_summary` — `{}`

**What you get back:** one snapshot with your financial state (balance, equity, margin, free
margin, margin level, unrealized P/L), every open position, and every working order. Your AI
summarizes it: equity vs. balance, which positions are up or down, and what orders are still
waiting. One call instead of three.

## 2. Place a guarded market order

**You say:** *"Buy 0.1 lots of EURUSD at market, with a stop about 30 pips below the current
price and a take profit about 50 pips above."*

**Tool calls:**

1. `get_quote` — `{ "symbol": "EURUSD" }` — to anchor the SL/TP math on the live price.
2. `place_order_plan` —

   ```json
   {
     "symbol": "EURUSD",
     "side": "buy",
     "quantity": 0.1,
     "orderType": "Market",
     "timeInForce": "IOC",
     "stopLoss": 1.0820,
     "takeProfit": 1.0900
   }
   ```

   (SL/TP values computed from the quote it just fetched.) **Nothing is sent yet** — this returns
   a preview (plain-language summary, the live quote, your free margin) and a single-use
   `commitToken`.

3. *You review the preview and confirm.* Your AI shows you the order it's about to place; you
   say something like *"yes, go ahead."*
4. `place_order_commit` — `{ "commitToken": "plan_3f8e1c2a-9b4d-4e6f-8a1b-2c3d4e5f6a7b" }` — the token from step 2. This is
   the step that actually places the order.

**What you get back:** the quote first, then the preview to confirm against, and only after your
confirmation the order result with the order ID and execution details. Two safety properties to
note: **nothing reaches the market until you commit** (the plan step is read-only), and if the
connection drops mid-commit, the order is **not** automatically retried — your AI will tell you
the call failed and you should check `get_working_orders` / `get_open_positions` before sending
it again (see [Client Mode](./CLIENT_MODE.md#safety-behaviors-you-should-know-about)).

## 3. Scale out of a winner

**You say:** *"My EURUSD long is doing well — take half of it off the table."*

**Tool calls:**

1. `get_open_positions` — `{ "symbol": "EURUSD" }` — to find the position ID and its size.
2. `close_position_plan` — `{ "positionId": 67890, "quantity": 0.05 }` — half of the 0.1-lot
   position found in step 1. Returns a preview and a `commitToken`; **nothing is closed yet**.
3. *You confirm the partial close.*
4. `close_position_commit` — `{ "commitToken": "plan_7c1d2e3f-4a5b-4c6d-8e9f-0a1b2c3d4e5f" }` — executes the close.

**What you get back:** the list of matching positions with IDs, sizes, open prices and current
P/L, then a preview of the partial close to confirm, and only after you confirm the close result.
The remaining half stays open with its original SL/TP.

## 4. Flatten everything

**You say:** *"Get me flat — close everything and cancel all my pending orders."*

**Tool calls:**

1. `close_all_positions_plan` — `{}` — previews the flatten (it's high-impact) and returns a
   `commitToken`; **nothing is closed yet**.
2. *You confirm the flatten.*
3. `close_all_positions_commit` — `{ "commitToken": "plan_b4c5d6e7-8f9a-4b1c-9d3e-4f5a6b7c8d9e" }` — closes every position.
4. `cancel_all_orders` — `{}` — cancelling working orders is not a money-mover, so it runs in one
   step (no preview).

**What you get back:** a preview of what closing everything will do, then — after you confirm —
a count of closed positions, and finally a count of cancelled orders. The commit and
`cancel_all_orders` are both bulk tools that report **per-item** outcomes, so if one position
fails to close (e.g. the market is closed for that symbol), you're told exactly which one — the
others still went through. Add `"symbol": "EURUSD"` to the plan call (or to `cancel_all_orders`)
to flatten just one instrument.

## 5. Morning briefing

**You say:** *"Give me a morning briefing: majors overview, what EURUSD did overnight, and
where my account stands."*

**Tool calls:**

1. `get_quotes` — `{ "symbols": ["EURUSD", "GBPUSD", "USDJPY", "XAUUSD"] }`
2. `get_candles` — `{ "symbolName": "EURUSD", "interval": "1H", "maxResults": 24 }`
3. `get_account_state` — `{}`

**What you get back:** current bid/ask for each major in one call, 24 hourly OHLCV candles to
describe the overnight range and direction, and your balance/equity/margin picture. Your AI
stitches them into a narrative briefing.

## 6. Margin check before sizing a trade

**You say:** *"If I buy 0.5 lots of GBPUSD, do I have the margin for it — comfortably?"*

**Tool calls:**

1. `get_account_state` — `{}` — free margin and margin level right now.
2. `get_symbol_details` — `{ "symbolName": "GBPUSD" }` — contract size, margin requirements,
   lot constraints.
3. `get_quote` — `{ "symbol": "GBPUSD" }` — current price for the margin estimate.

**What you get back:** your free margin, the symbol's configuration, and the live price — from
which your AI estimates the margin the trade would consume and how much headroom you'd have
left. Treat it as an estimate: the server runs the authoritative margin check when the order
is placed.

## 7. Move stops to break-even

**You say:** *"Move the stop loss on all my winning positions to their open price."*

**Tool calls:**

1. `get_open_positions` — `{}` — find every position, its open price, and current P/L.
2. `modify_position_sltp` — `{ "positionId": 67890, "stopLoss": 1.0850, "takeProfit": 1.0950 }`
   — once per winning position, with `stopLoss` set to that position's open price and
   `takeProfit` re-sent with its current value. **Careful:** a field you omit (or set to `0`)
   is **removed** — so to keep an existing take profit, include it with its current price
   (which step 1 returned).

**What you get back:** the position list, then a confirmation per modified position. Omitting
a side or setting it to `0` removes it — e.g. `{ "positionId": 67890, "stopLoss": 1.0850 }`
alone would move the stop **and drop the TP entirely**.

---

## 8. Find a client's exposure across accounts — **admin mode only**

**You say:** *"Which accounts does client Smith own, and what positions are open on them?"*

**Tool calls:**

1. `get_clients` — `{}` — find the client and their ID.
2. `get_all_accounts` — `{}` — find the trading accounts owned by that client.
3. `get_open_positions` — `{ "accountId": 12345 }` — once per account found in step 2.

**What you get back:** the client list, the account list with group assignments, and per
account every open position with unrealized P/L — which your AI aggregates into a per-client
exposure view. Note `accountId` parameters exist only in admin mode; client mode never has
them.

## 9. Review and adjust order routing — **admin mode only**

**You say:** *"Show me the current order routing, and route EURUSD flow to connector 2."*

**Tool calls:**

1. `get_order_routing` — `{}` — current rules, their order, and the config version.
2. `add_routing_rule` —

   ```json
   {
     "actions": [{ "type": "Execute", "connectorId": 2 }],
     "filters": [{ "type": "Symbol", "value": "EURUSD" }]
   }
   ```

**What you get back:** the full rule list first (each rule's filters and actions, plus the
version number), then confirmation that the new rule was appended. `add_routing_rule` and
`remove_routing_rule` (by zero-based `index`) are the safe, atomic way to change routing —
they read the current version themselves. `set_order_routing` replaces **everything** at once
and is best reserved for restoring a known-good configuration.

## 10. Deposit funds to an account — **admin mode only**

**You say:** *"Deposit 5,000 USD to account 12345 and confirm the new balance."*

**Tool calls:**

1. `cash_transfer` —

   ```json
   {
     "accountId": 12345,
     "amount": 5000,
     "type": "Balance",
     "currency": "USD",
     "comment": "client deposit"
   }
   ```

2. `get_account_state` — `{ "accountId": 12345 }`

**What you get back:** the transfer confirmation, then the account's refreshed financial state
showing the new balance. `type: "Balance"` is the standard deposit/withdrawal (negative
`amount` withdraws); other types — Credit, Bonus, Commission, Adjustment, and more — are listed
under `cash_transfer` in the [Tools Reference](./TOOLS_REFERENCE.md) and explained in
[Admin Mode](./ADMIN_MODE.md#cash-transfer-types).

---

## Where next

- [Tools Reference](./TOOLS_REFERENCE.md) — every tool and parameter behind these examples
- [Client Mode](./CLIENT_MODE.md) — the trader's guide, including the safety behaviors
- [Admin Mode](./ADMIN_MODE.md) — the broker administrator's guide
- [Troubleshooting](./TROUBLESHOOTING.md) — when a call doesn't behave as expected
