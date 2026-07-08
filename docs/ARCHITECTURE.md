# Architecture

How the Trade Server MCP is put together: the components, the module layout, how a mode is
selected at startup, what happens to a tool call from the moment your AI issues it, and the
design decisions behind it all.

## Component overview

```
+--------------------+        stdio (JSON-RPC / MCP)
|     MCP client     | <----------------------------------+
| (Claude Desktop,   |                                    |
|  Claude Code, ...) |                                    v
+--------------------+                          +------------------+
                                                |    index.ts      |
                                                |  parse config,   |
                                                |  pick a mode     |
                                                +--------+---------+
                                                         |
                                  +----------------------+----------------------+
                                  |                                             |
                                  v                                             v
                       +--------------------+                       +---------------------+
                       | register-admin.ts  |                       | register-client.ts  |
                       | 43 tools           |                       | 30 tools            |
                       | 4 resources        |                       | 1 resource          |
                       +---------+----------+                       +----------+----------+
                                 |                                             |
                                 v                                             v
                       +--------------------+                       +---------------------+
                       | tools/admin/*      |                       | tools/client/*      |
                       | zod schema + fn    |                       | zod schema + fn     |
                       +----+----------+----+                       +----------+----------+
                            |          |                                       |
              quotes/depth  |          | everything else                       |
                            v          v                                       v
                   +-----------+   +--------------------------------------------------+
                   | WsClient  |   |                   RestClient                     |
                   | (admin    |   |  signed requests, ApiError mapping, ETag cache,  |
                   |  only)    |   |  withAuthRetry (401 -> renew -> retry once)      |
                   +-----+-----+   +------------------------+-------------------------+
                         |                                  |
                         |                                  |  CredentialsProvider
                         |                                  |  - StaticCredentials (admin,
                         |                                  |    client token mode)
                         |                                  |  - ClientAuth (client login
                         |                                  |    mode: /authorize, /refresh,
                         |                                  |    auto-refresh at 80%)
                         v                                  v
                   +---------------------------------------------------+
                   |            YourBourse Trade Server                |
                   |        /api/v1 (REST)   and   /ws/v1 (WS)         |
                   +---------------------------------------------------+
```

One process, one mode. The MCP client launches `dist/index.js` over stdio; depending on
configuration, either the admin tool set or the client tool set is registered — never both in
the same process. (You can run two instances under different names if you want both; see the
[FAQ](./FAQ.md).)

## Module map

Everything under `src/`:

| File | Responsibility |
|---|---|
| `index.ts` | Entry point: parse env config, construct the auth provider and clients for the selected mode, register tools, connect the stdio transport, log the startup line. |
| `config.ts` | Environment-variable parsing: mode selection and inference, whitespace trimming, validation, and every startup error message. |
| `register-admin.ts` | Registers the 43 admin tools and 4 MCP resources, wiring each tool name + description + schema to its implementation. |
| `register-client.ts` | Registers the 30 client tools and 1 MCP resource; exports `CLIENT_TOOL_COUNT`; wraps every tool so sign-in failure hints surface in tool errors. |
| `tool-handler.ts` | Wraps each tool function for MCP: serializes results to JSON text, converts thrown errors into a structured `{ error, message }` result with `isError: true`. |
| `rest-client.ts` | Signed REST client for `/api/v1`: header construction, HMAC signing, ETag caching (`If-None-Match` / `If-Match`), semantic error mapping (`ApiError`), 401 renew-and-retry (`withAuthRetry`), and the transport retry policy. |
| `ws-client.ts` | WebSocket client for `/ws/v1` (admin mode only): live quotes (L1) and market depth (L2), ping/pong keepalive, bounded reconnect. Takes a `CredentialsProvider` and reads the current API key at send time. |
| `auth/admin-auth.ts` | `generateSignature` (HMAC-SHA256, base64url), the `CredentialsProvider` interface, and `StaticCredentials` for static key pairs. |
| `auth/client-auth.ts` | `ClientAuth`: login-based sign-in via `POST /authorize`, token rotation via `/refresh`, auto-refresh scheduling at 80% of token lifetime (single-flight), 401 recovery hook, and targeted sign-in failure hints. |
| `auth/detect-mode.ts` | `detectManager`: the startup role probe for login/password sign-ins — calls `GET /admin/managers/get/{account}`; 200 means manager (admin tools), any failure means trader (fail-closed to client mode). |
| `tools/admin/trading.ts` | Admin trading tools: order placement/modification/cancel, positions, close composites, history, account summary. The four money-movers (place order, close position, close-by, close all) are exposed as `*_plan` + `*_commit` pairs (confirm-before-execute). |
| `tools/admin/account.ts` | Admin account tools: account state/info, all accounts, cash transfers, transfer history, balances. |
| `tools/admin/market-data.ts` | Admin market data: WS quotes and depth, symbols, candles, conversion rate, locally computed indicators, health check. |
| `tools/admin/config.ts` | Admin configuration tools: groups, clients, order routing (get/set/add/remove), liquidity connectors, symbol details. |
| `tools/client/trading.ts` | Client trading tools: place/modify/cancel orders, SL/TP, close composites, working orders, history. The four money-movers (place order, close position, close-by, close all) are exposed as `*_plan` + `*_commit` pairs (confirm-before-execute). |
| `tools/client/account.ts` | Client account tools (5): account state, summary, balances, transfer history, rate limits. |
| `tools/client/market-data.ts` | Client market data (7 + health check): quotes, depth, symbols, symbol details, candles, conversion rate. |
| `preview/plan-commit.ts` | Single-use commit-token store backing the preview/commit flow: `issuePlan()` stashes a validated order and returns a short opaque token (5-minute TTL); `takeCommit()` consumes it exactly once, so a retried commit can never double-fill. |
| `preview/order-preview.ts` | Order preview builder: turns a planned order into a plain-language summary plus best-effort live quote and free margin (degrades gracefully if the data endpoints blip). |
| `validation.ts` | Parameter-completeness messages: when a `*_plan` request is missing required fields, returns exactly what's needed (with valid options) instead of guessing or surfacing a raw schema error. |
| `test/*.ts` | Test suite (node:test): golden HMAC vectors, config parsing, REST client behavior, client auth lifecycle, endpoint-mapping tests per tool module, registration counts. |

Each tool module exports pairs: a zod schema (the parameter contract your AI sees) and an async
function that maps the friendly parameters onto the Trade Server's REST API. The register files
are the single place where tool names and descriptions live.

Most tools are registered with `server.tool`. The money-movers are the exception: their `*_plan`
and `*_commit` tools are registered with `server.registerTool` so they can carry behavior
annotations — plan tools are marked `readOnlyHint` (they only preview), commit tools `destructiveHint`
(they place a live order), and commit descriptions carry an AI-execution disclosure.

## Mode selection

`config.ts` resolves the mode at startup, before anything connects:

1. **Explicit wins.** If `YB_MODE` is set (`admin` or `client`), that's the mode and no
   role detection runs. Any other value is a startup error.
2. **Login/password means auto-detection.** Login-style variables (`YB_LOGIN` /
   `YB_PASSWORD`) without `YB_MODE` resolve to **auto** mode: the server signs in
   (`/authorize`), then probes the admin `getManager` endpoint to learn the account's role —
   a manager gets the admin tool set, a trader the client tool set. Detection is
   **fail-closed**: any probe failure (HTTP error, network drop, timeout) yields client
   mode, never admin.
3. **Key pair means admin.** Key-style variables (`YB_API_KEY` / `YB_SECRET_KEY`) without
   `YB_MODE` imply admin mode.
4. **No credentials at all** is a startup error with a help text listing the valid
   combinations.

Admin mode accepts either credential style: a static **key pair**, or a **manager session**
(`YB_LOGIN` + `YB_PASSWORD` — the same auto-refreshing sign-in flow traders use). Within
client mode there are two credential styles: **login** (`YB_LOGIN` + `YB_PASSWORD`, optional
`YB_BROKER`) and **token** (`YB_API_KEY` + `YB_SECRET_KEY` with `YB_MODE=client`). Mixing
both credential styles is rejected at startup. All values are whitespace-trimmed, and an
empty string counts as unset. The full variable reference and every error message are in
[Configuration](./CONFIGURATION.md).

`index.ts` then builds the matching wiring:

- **Admin, key pair:** `StaticCredentials` + `RestClient` + `WsClient`, then `registerAdminTools`.
- **Admin, manager session:** `ClientAuth` signs in immediately (auto-refreshing session
  token) and backs both `RestClient` and `WsClient`; if sign-in fails, the admin tools are
  registered anyway and each call retries sign-in.
- **Auto (login/password, no `YB_MODE`):** `ClientAuth` signs in, then `detectManager` probes
  `GET /admin/managers/get/{account}` through a retry-free facade provider — capped at
  5 seconds, and deliberately without the 401-renewal hook, so a rejected probe resolves to
  "trader" instead of triggering a re-authorize loop. A 200 selects the admin wiring above;
  anything else selects the client wiring below.
- **Client, login style:** `ClientAuth` signs in immediately; if sign-in fails, tools are
  registered anyway and every call carries a targeted failure hint until sign-in succeeds.
- **Client, token style:** `StaticCredentials` + `RestClient` — no timers, no sign-in step.

## Request lifecycle

What happens when your AI calls a tool, end to end:

1. **Validation.** The MCP SDK validates the arguments against the tool's zod schema. Bad
   arguments never reach the network.
2. **Mapping.** The tool function translates friendly parameters (`symbol`, `quantity`,
   `stopLoss`, …) into the Trade Server's wire format and picks the endpoint under
   `/api/v1`.
3. **Headers and signing** (`RestClient.buildHeaders`):
   - `X-YB-API-Key` — the current API key from the `CredentialsProvider` (in client login
     mode this is the session token).
   - For anything other than GET: `X-YB-Timestamp` (microseconds) and `X-YB-Sign` — an
     HMAC-SHA256 (base64url) over `Content=<body>\nTimestamp=<timestamp>`. Details and a
     worked example are in [Authentication](./AUTHENTICATION.md).
   - ETags: GETs send `If-None-Match` when a cached ETag exists; writes send `If-Match`, so
     concurrent config edits fail loudly instead of clobbering each other.
4. **Send, with a deliberate retry policy.** Connection-level failures (reset, hang-up) on
   POST/PUT are retried exactly once — **except order placement**, which opts out: a dropped
   connection does not prove the server never received the order, and retrying could fill
   twice. HTTP errors are never retried at this layer.
5. **Error mapping.** A non-2xx response becomes an `ApiError` with a semantic code
   (`UNAUTHORIZED`, `NOT_FOUND`, `PRECONDITION_FAILED`, `RATE_LIMITED`, …) parsed from the
   response when possible.
6. **401 recovery** (`withAuthRetry`). On a 401, the credentials provider is asked to renew —
   in client login mode that means one fresh `/authorize` — and the request is re-run exactly
   once. A second 401 propagates; there is no loop.
7. **Result wrapping** (`toolHandler`). Success becomes pretty-printed JSON in the tool
   result. Any error becomes a structured `{ error: <code>, message: <text> }` result with
   `isError: true` — the AI always gets something it can act on, never a crash. In client
   mode, while sign-in is failing, the targeted hint (bad credentials vs. old server vs.
   connectivity) is appended to every tool error.

Admin-mode quotes and market depth take a different path: they subscribe via the
`WsClient` WebSocket feed instead of REST, grab a snapshot, and unsubscribe.

## Design decisions

**Hand-written tools, not OpenAPI codegen.** The Trade Server API is large and terse;
generating one tool per endpoint would produce dozens of cryptic, parameter-heavy tools that
AIs use badly. Instead, every tool is task-shaped and hand-tuned: intent-rich descriptions,
friendly parameter names, and composites (like `get_account_summary` or `close_position`) that
do what a person actually asks for. `reference/openapi.json` is kept in the repo as the
contract to verify against — it is the source of truth for endpoints, not a code generator
input. See [Contributing](./CONTRIBUTING.md) for the policy.

**One server, two modes.** Broker administrators and traders need different tools, different
scoping, and different safety rails. Registering per mode (rather than one tool set with an
"admin flag") means a trader's session physically does not contain the `cash_transfer_plan`/`cash_transfer_commit` or routing
tools, and no client tool even has an `accountId` parameter to misuse. The registration counts
are pinned by tests.

**The `CredentialsProvider` abstraction.** `RestClient` doesn't know how credentials work —
it asks a provider for the current key and signing secret, and offers it a single
`handleUnauthorized` hook. Static key pairs (admin, client token) and the full login lifecycle
(authorize, refresh timers, single-flight rotation) plug into the same client without special
cases.

**Per-call retry policy.** Retry behavior is decided where the consequences are understood:
the transport layer retries idempotent-ish calls once on connection failures, but order
placement explicitly opts out (duplicate-fill protection), and 401 recovery is bounded to one
attempt. Nothing retries in a loop. The reasoning is spelled out for traders in
[Client Mode](./CLIENT_MODE.md#safety-behaviors-you-should-know-about).

## Where next

- [Authentication](./AUTHENTICATION.md) — the signing scheme and token lifecycle in depth
- [Tools Reference](./TOOLS_REFERENCE.md) — every tool in both modes
- [Contributing](./CONTRIBUTING.md) — how to work on the codebase
- [Security](./SECURITY.md) — credential handling and supply-chain stance
