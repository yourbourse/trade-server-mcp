# Client Mode — the Trader's Guide

Client mode is for **traders**: you have a trading account with a broker who runs a YourBourse
Trade Server, and you want your AI to monitor it and trade on it. It exposes **26 tools and
1 MCP resource** (see the [Tools Reference](./TOOLS_REFERENCE.md#client-mode-26-tools) for
every parameter and example).

## The scoping model: your token *is* your account

When the server signs you in, the session token it issues is bound to your account. Every
tool call is made with that token, so the Trade Server itself enforces the scope — there is
no account parameter anywhere in client mode, and no way to ask about or act on anyone
else's account. "Show my positions" can only ever mean *your* positions.

This is also why client mode is the right choice for almost everyone: even if the AI is
confused or misled, the credentials it holds simply cannot reach beyond your account.

## Signing in: what happens automatically

You configure your credentials once (see [Configuration](./CONFIGURATION.md)) and the MCP
manages the session for you:

- **Automatic sign-in.** With `YB_LOGIN` + `YB_PASSWORD`, the server signs in when it starts.
  Your password is never sent over the network — it is only used locally to sign the sign-in
  request. On success you'll see `Trade Server MCP: client mode, signed in as account <login>`
  in the startup log.
- **Automatic refresh.** Session tokens expire. The MCP refreshes the token in the background
  at about 80% of its lifetime, so a long conversation never stalls on an expired session.
- **Automatic recovery.** If a request is rejected as unauthorized (for example after a
  server restart), the MCP signs in again and retries that request once — you usually never
  notice.
- **Token-pair setups skip all of this.** If your broker issued you a public API token pair
  (`YB_API_KEY` + `YB_SECRET_KEY` with `YB_MODE=client`), it is used as-is; there is no
  sign-in step or refresh cycle.

### When sign-in fails

A failed sign-in does **not** prevent the server from starting: all tools register anyway,
and each tool call retries the sign-in. While sign-in keeps failing, every tool result
carries a targeted hint telling you which of the three likely causes applies:

- Wrong credentials (the server rejected your login or password):

  > Sign-in to the Trade Server failed: check YB_LOGIN and YB_PASSWORD.

- Sign-in rejected — HTTP 400/404, an invalid request parameter (check the URL/port and any
  optional fields such as `YB_BROKER`):

  > Sign-in was rejected by the Trade Server (HTTP 400/404) — usually an invalid request parameter or wrong endpoint. Verify YB_BASE_URL points to the client (public) API (it can use a different port from the admin API), and that any optional fields (e.g. YB_BROKER) are correct or left unset. If the configuration is correct, the account may not be enabled for the client API on this server, or the server version may predate it — check with your broker.

- Connectivity (the server could not be reached at all):

  > Could not reach the Trade Server: check YB_BASE_URL and network connectivity.

For any other failure status, the hint is the generic
`Sign-in to the Trade Server failed (HTTP <status>).` The hint disappears as soon as a
sign-in succeeds. More symptom-by-symptom help is in
[Troubleshooting](./TROUBLESHOOTING.md).

## Safety behaviors you should know about

These are deliberate design decisions, in plain language:

- **Order placements are never retried automatically.** If the connection drops while an
  order is being placed, the MCP does *not* resend it — a dropped connection doesn't prove
  the server never received the order, and resending could fill you **twice**. If a
  placement fails with a connection error, check your working orders and positions before
  placing again. (Requests where a duplicate is harmless, such as modifications and most
  reads, may be retried once.)

- **Close tools tell you the truth about races.** `close_position` and `close_by` first look
  up the position(s), then send the closing order. The market doesn't wait: a stop loss or
  take profit can close the position in between. The MCP doesn't pretend otherwise — the
  server is the final authority, and if the position is already gone you get an error saying
  exactly which operation failed and why, never a fabricated success.

- **Bulk tools report per item.** `cancel_all_orders` and `close_all_positions` don't stop at
  the first problem. They attempt every order/position and return an itemized result — what
  was cancelled or closed, what failed and with which error — plus the totals, so a partial
  success is never mistaken for a complete one.

- **Your password stays on your machine.** It is used only as the local signing secret for
  the sign-in request — never transmitted, never logged, never echoed back into the
  conversation. Nothing is persisted to disk. See [Security](./SECURITY.md).

## Netting vs hedging accounts

Brokers configure accounts as either **netting** (one position per symbol — opposite orders
offset each other immediately) or **hedging** (buy and sell positions on the same symbol can
coexist). One tool cares about the difference: **`close_by`** closes two opposite positions
against each other, which only makes sense when opposite positions can exist — that is, on a
**hedging** account. On a netting account you'll never have two opposite positions to pair,
so `close_by` has nothing to act on; use `close_position` instead. Not sure which type your
account is? Ask your broker.

## Excluded by design

Some things are deliberately **not** available in client mode:

- **No password or account management.** Changing your password belongs in your broker's
  client portal, not in an AI conversation.
- **No deposits, withdrawals, or transfers.** Moving money is a broker-side operation
  (admin-mode `cash_transfer`); a trader session can only *read* its transfer history.
- **No admin tools.** Server configuration — routing rules, groups, liquidity connectors,
  other accounts — is invisible to a client session, both in this MCP and at the server's
  permission level.

The principle: the tool set your AI holds should match what *you* can do with your own
account, and nothing more.

## Where next

- [Tools Reference](./TOOLS_REFERENCE.md) — all 26 client tools with parameters and examples
- [Configuration](./CONFIGURATION.md) — credential setup for both client credential styles
- [Authentication](./AUTHENTICATION.md) — how sign-in, signing, and refresh work under the hood
- [Security](./SECURITY.md) — credential-handling guarantees and recommendations
- [Usage Examples](./USAGE_EXAMPLES.md) — realistic trading conversation patterns
- [FAQ](./FAQ.md) — common questions
