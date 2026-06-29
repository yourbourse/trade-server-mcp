# Troubleshooting

This guide is organized by **symptom**: find what you are seeing in the index below and jump
to the matching section. Almost every problem leaves a precise trace in the server's log
output, so if you are not sure what is happening, start with
[Where to find the MCP logs](#where-to-find-the-mcp-logs).

## Symptom index

| What you are seeing | Go to |
|---|---|
| The server never appears in your MCP client, or shows as failed/disconnected | [The server won't start](#the-server-wont-start-configuration-errors) |
| Log shows `sign-in FAILED` at startup | [Sign-in fails in client mode](#sign-in-fails-in-client-mode-loginpassword) |
| Sign-in fails with HTTP 400 or 404 (invalid parameter) | [Sign-in rejected with HTTP 400/404](#sign-in-rejected-with-http-400-or-404-invalid-parameter) |
| Tool calls fail with connection drops (`fetch failed`, `socket hang up`, `ECONNRESET`) | [Older Trade Server versions](#older-trade-server-versions-server-compatibility) |
| Every tool error ends with the same extra hint line | [Tool errors carry a sign-in hint](#tool-errors-carry-a-sign-in-hint) |
| `get_symbols` returns an empty list | [get_symbols returns an empty list](#get_symbols-returns-an-empty-list) |
| `close_by` keeps failing on your account | [close_by fails on my account](#close_by-fails-on-my-account) |
| An order failed with a connection error and was not retried | [Order placements are never retried](#an-order-failed-with-a-connection-error-and-was-not-retried) |

## Where to find the MCP logs

The Trade Server MCP writes every diagnostic line — startup mode, sign-in results, and each
tool error — to **stderr**. Where stderr ends up depends on your MCP client:

- **Claude Desktop.** Open **Settings → Developer** to see each configured server's status
  and open the logs folder. The log files live at:
  - Windows: `%APPDATA%\Claude\logs`
  - macOS: `~/Library/Logs/Claude`

  Look for the per-server file (named after your server entry, e.g.
  `mcp-server-trade-server.log`) for this server's stderr, and `mcp.log` for
  connection-lifecycle events.
- **Claude Code.** Run `claude --debug` to see MCP server stderr in the session output. Use
  `claude mcp list` to check each server's connection status, and `claude doctor` (or
  `/doctor` inside a session) for general diagnostics.
- **Other MCP clients.** Check your client's documentation for where it sends a stdio
  server's stderr.

The exact log lines a healthy startup produces are listed in
[Configuration → Startup log lines](./CONFIGURATION.md#startup-log-lines).

## The server won't start (configuration errors)

**Symptom:** your MCP client reports the server as failed or disconnected, and the log shows
`Fatal error:` followed by a configuration message; the process exits with code 1.

This means an environment variable is missing, empty, or inconsistent. Every possible
message, with the exact fix for each, is listed in
[Configuration → Startup error messages](./CONFIGURATION.md#startup-error-messages).
The two that catch people most often:

- A token pair without `YB_MODE=client` is interpreted as **admin** mode — client token
  setups must set `YB_MODE=client` explicitly.
- A variable set to an empty or whitespace-only string counts as **unset**.

After fixing the configuration, restart your MCP client so it relaunches the server.

## Sign-in fails in client mode (login/password)

**Symptom:** the startup log shows

```
Trade Server MCP: client mode — sign-in FAILED. <hint> Tools are registered; calls will retry sign-in.
```

This is not fatal: the server starts anyway, registers all tools, and retries the sign-in on
each tool call. The `<hint>` is a targeted diagnosis. There are four possible hints:

| Hint (exact text) | Meaning | What to do |
|---|---|---|
| `Sign-in to the Trade Server failed: check YB_LOGIN and YB_PASSWORD.` | The server answered 401 or 403: it understood the request but rejected the credentials. | Verify your account number and password (the sign-in request is signed with your password — a wrong password makes the signature invalid). If your server hosts more than one broker, you may also need `YB_BROKER` — ask your broker. |
| `Sign-in was rejected by the Trade Server (HTTP <status>) — usually an invalid request parameter or wrong endpoint. Verify YB_BASE_URL points to the client (public) API (it can use a different port from the admin API), and that any optional fields (e.g. YB_BROKER) are correct or left unset. If the configuration is correct, the account may not be enabled for the client API on this server, or the server version may predate it — check with your broker.` | The server answered 400 or 404: it did not accept the sign-in request at all (an invalid parameter or wrong endpoint). | See [Sign-in rejected with HTTP 400/404](#sign-in-rejected-with-http-400-or-404-invalid-parameter) below. |
| `Could not reach the Trade Server: check YB_BASE_URL and network connectivity.` | No HTTP response at all — wrong URL or port, DNS failure, firewall, VPN, or the sign-in timed out (10 seconds). | Confirm `YB_BASE_URL` (scheme, host, and port) with your broker, then check basic connectivity to that host from your machine. |
| `Sign-in to the Trade Server failed (HTTP <status>).` | Any other HTTP status (for example a 5xx server error). | Check the full log line for the response body, and contact your broker if it persists. |

The log also contains the raw failure line, e.g.
`POST /authorize failed (401): <response body>`, which includes the server's error body —
useful for the error-code semantics below.

### What the status and error codes mean

The Trade Server's error responses carry a numeric error code (the `e` field in the response
body). Two combinations cover almost all sign-in failures:

| HTTP status | Server error code | Meaning |
|---|---|---|
| **401** | `1` | Bad credentials — in practice, a wrong password (the request signature did not verify). |
| **400** | `3` | The server rejected the sign-in request as an invalid parameter — check the URL/port and any optional fields (e.g. `YB_BROKER`), then an older server. See below. |

## Sign-in rejected with HTTP 400 or 404 (invalid parameter)

HTTP 400/404 (server error code `3`) means the Trade Server did not accept the sign-in
request itself — an **invalid parameter** or wrong endpoint. Check these, in order:

1. **An invalid or stray optional field.** The sign-in body needs only your login; an
   optional field carrying a bad value gets the whole request rejected. In particular, leave
   `YB_BROKER` **unset** unless your broker told you to set it. (An empty or
   placeholder-only value is treated as unset, so a blank optional field is safe.)
2. **Wrong port.** The client (public) API and the admin API are served on **different ports
   of the same Trade Server**. If `YB_BASE_URL` points at the admin port, trading-account
   sign-ins are rejected with 400 even on a perfectly current server. Ask your broker for the
   **client** API port and fix it in `YB_BASE_URL`.
3. **Older server version.** If the configuration is confirmed correct and sign-in is still
   rejected, the server version may predate the public client API — see
   [Older Trade Server versions](#older-trade-server-versions-server-compatibility) below.

## Older Trade Server versions (server compatibility)

The login/password sign-in and the client-mode data endpoints belong to the Trade Server's
**public client API**. Before concluding the server is too old, rule out the wrong-port case
above — pointing at the admin port produces similar symptoms on a fully current server. On
genuinely older builds, incompatibility shows up in two distinct ways:

- **Sign-in fails with HTTP 400** (server error code 3) at the correct client port with the
  configuration confirmed, and the hint reads:

  > Sign-in was rejected by the Trade Server (HTTP 400) — usually an invalid request parameter or wrong endpoint. Verify YB_BASE_URL points to the client (public) API (it can use a different port from the admin API), and that any optional fields (e.g. YB_BROKER) are correct or left unset. If the configuration is correct, the account may not be enabled for the client API on this server, or the server version may predate it — check with your broker.

- **`get_balances` and `get_limits` drop the connection.** Sign-in may succeed and
  everything else works — but these two tools fail with transport-level errors such as
  `fetch failed`, `socket hang up`, or `ECONNRESET` instead of a proper HTTP error. The
  Trade Server closes the connection for routes it does not implement, and as of the time
  of writing these two endpoints are documented in the API specification but not yet
  available in Trade Server releases.

**Remedy:** this cannot be fixed from your side. Everything else keeps working; the two
tools will start working automatically once a Trade Server release ships those endpoints —
ask your broker (or whoever operates the Trade Server) about availability. Admin mode uses
a different, longer-established API surface and is not affected.

## Tool errors carry a sign-in hint

**Symptom:** in client mode, every failing tool call ends with the same extra line — one of
the four hints from the [sign-in table](#sign-in-fails-in-client-mode-loginpassword) above.

This is deliberate. While sign-in is failing, the targeted hint is appended to **every** tool
error so the root cause is visible right in the conversation, not only in a log file you may
never open. The hint is attached regardless of how the individual call failed, because old
servers answer client-API endpoints inconsistently — sometimes with a 401, sometimes by
closing the connection. As soon as a sign-in succeeds, the hint disappears from subsequent
errors.

So: if tool errors carry a hint, **fix the sign-in first** — the per-call errors are usually
just consequences of it.

## get_symbols returns an empty list

**Symptom:** `get_symbols` succeeds but returns `[]`, even though the account clearly has
tradable symbols (for example, `get_quote` on a known symbol works).

The tool expects the server to wrap the symbol list in a `{"symbols": [...]}` response
envelope. An incompatible (typically older) server may answer with a different envelope or an
unexpected page limit, which surfaces as an empty list rather than an error. Two checks:

1. If you passed a `filter` pattern, try the call without it — the pattern must match the
   **full** symbol name (use `EUR*`, not `EUR`).
2. If the unfiltered call is still empty while quotes work, suspect
   [server compatibility](#older-trade-server-versions-server-compatibility) and ask your
   broker to confirm the server version supports the public client API.

## close_by fails on my account

**Symptom:** `close_by` returns errors such as `Position <id> not found`,
`Positions must be on opposite sides`, or a server rejection prefixed with
`close_by for positions <id>/<id>:`.

`close_by` closes two **opposite** positions on the same symbol against each other — which
requires that opposite positions can coexist, i.e. a **hedging** account. On a **netting**
account (one position per symbol; opposite orders offset immediately) there are never two
opposite positions to pair, so `close_by` has nothing valid to act on. Use `close_position`
instead. The account type is your broker's group configuration — if you are not sure which
you have, ask your broker. See
[Client Mode → Netting vs hedging accounts](./CLIENT_MODE.md#netting-vs-hedging-accounts).

## An order failed with a connection error and was not retried

**Symptom:** a money-mover commit (`place_order_commit`, `close_position_commit`,
`close_by_commit`, or `close_all_positions_commit`) failed with a connection-level error
(`fetch failed`, `socket hang up`, `ECONNRESET`) and the MCP did **not** resend it, even though
other calls retry such errors automatically.

This is the duplicate-fill protection, and it is intentional: a dropped connection does not
prove the server never received the order. If the order *was* received and filled, resending
it would fill you **twice**. Requests where a duplicate is harmless (such as modifications
and most reads) may be retried once; order placements never are.

**What to do:** before placing the order again, check what actually happened —
`get_working_orders`, `get_open_positions`, and `get_order_history` will show whether the
original order arrived. The full retry rules are in
[Authentication → Timeouts and retries](./AUTHENTICATION.md#timeouts-and-retries).

## Where next

- [Configuration](./CONFIGURATION.md) — every variable, startup errors, and healthy log lines
- [Client Mode](./CLIENT_MODE.md) — the sign-in lifecycle and safety behaviors
- [Authentication](./AUTHENTICATION.md) — signing, refresh, and retry rules in depth
- [FAQ](./FAQ.md) — common questions
