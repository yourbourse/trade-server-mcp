# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **Symbol writes (admin):** `update_symbol_plan` / `update_symbol_commit` — edit a symbol's server-wide configuration (any top-level fields via `updates`, and/or full `quoteSessions`/`tradeSessions` replacement lists) through a confirm-before-write flow. The plan reads the current symbol and returns a field-by-field diff plus a commit token; the commit applies it via `POST /admin/symbols/edit` (carrying the resource ETag as `If-Match` for optimistic concurrency).
- **Group writes (admin):** `update_group_plan` / `update_group_commit` (edit a trading group) and `delete_group_plan` / `delete_group_commit` (remove one) — same read-modify-write, confirm-before-write, ETag/If-Match pattern against `/admin/groups/edit` and `/admin/groups/delete`.
- **Config CRUD (admin):** edit + delete (confirm-before-write plan/commit) for **trading accounts** (`update_account_*`, `delete_account_*`), **clients** (`get_client`, `update_client_*`, `delete_client_*`), and **liquidity connectors** (`get_liquidity_connector`, `update_liquidity_connector_*`, `delete_liquidity_connector_*`), plus **`delete_symbol_*`**. All share one generic read-modify-write / delete helper (`resource-write.ts`) with ETag `If-Match` concurrency.
- **Trading calendar & manager admin (admin):** holidays (`get_holidays`, `get_holiday`, `update_holiday_*`, `delete_holiday_*`), managers (`get_managers`, `get_manager`, `get_manager_self`, `update_manager_*`, `delete_manager_*`), and `get_tokens` (list issued API tokens).
- **Create flows (admin):** `create_symbol_*`, `create_group_*`, `create_holiday_*`, `create_client_*`, `create_account_*` — clone an existing resource as a template (`fromId`) and/or pass a full `object`, apply `overrides`, and create it (id/version forced to 0, no If-Match) through the confirm-before-write plan/commit. A new trading account requires a user-supplied `password`.
- **Reporting and lookups (admin, read-only):** `get_journal` (server audit journal by time range, severity and message mask), `get_statements` (daily/monthly statements), `get_email_services`, `find_client_by_external_id`, `get_margin_call_accounts`, `get_transfer` (single transfer), `get_working_order` / `get_historical_order` (single order by ID), and `get_conversion_rates_batch`. Account-scoped tools take one of `accounts` / `groups` / `groupMasks`.
- **Position and trade record maintenance (admin):** `get_position`, `get_trade`, and confirm-before-write `update_position_*` / `delete_position_*` / `update_trade_*` / `delete_trade_*` for back-office corrections. These endpoints take a sparse `{ id, A, …changed }` update with no ETag concurrency, and their commits opt out of transport retries so a correction cannot be applied twice.
- **`create_manager_plan` / `create_manager_commit` (admin):** grant manager permissions to an account, optionally copying an existing manager via `fromId`. Previously only existing managers could be edited. The manager record must be sent COMPLETE — a sparse body is rejected as `Invalid body` — so with no template the tool starts from the signed-in manager's own record with every permission off. It also always sends `groups` (the group masks the manager may administer, default `"*"`), which `/admin/managers/self` omits but the edit endpoint requires.
- **Single-record lookups survive servers that do not serve get-by-id.** `get_position`, `get_trade`, `get_transfer` and the position/trade plans try the documented `GET /admin/<res>/get/{id}` first and, if the server does not serve it (observed live: 502 for every id, including nonexistent ones), fall back to the corresponding `/query` endpoint and select the record. Pass `accountId` to narrow that fallback.
- **Chart history maintenance (admin):** `update_candle_*` and `delete_candle_*` — rewrite or remove a stored bar (symbol, interval, bar start time, OHLCV) to clean up bad ticks. The plan shows the bar currently stored at that slot.
- **Password operations (admin):** `set_account_password_*` resets another trading account's password through the account upsert; `change_my_password_*` changes the password of the account the MCP signs in as (`POST /password` takes no account id) and warns that the stored `YB_PASSWORD` must then be updated. Passwords are never echoed back in previews or results.
- **Bulk (batch) operations (admin):** `bulk_update_*` and `bulk_delete_*` change or remove many records in one call — pick the kind with `resource` (symbols, groups, accounts, clients, holidays, managers, liquidity) and select with `ids` or a `namePattern` glob. Records that already hold the requested values are skipped, and the preview lists every affected record with an exact total. `bulk_update_candles_*` / `bulk_delete_candles_*` cover the chart batch endpoints. Batch endpoints carry no `If-Match`, and commits opt out of transport retries.
- **`create_liquidity_connector_plan` / `create_liquidity_connector_commit` (admin):** add a new LP feed, cloning an existing connector with `fromId` and overriding its session parameters (Host, Port, SenderCompID, TargetCompID, Password), symbol list and priority. FIX session parameters are passed through as the API returns them, so an administrator can read and set them.
- Admin tool count 43 → 132.

### Changed

- **Symbols and groups now use the shared resource helpers** instead of their own copies of read/diff/write, so a fix to the shared code reaches every resource at once — the divergence was exactly why the stale-ETag bug fixed in this release existed in only those two paths.
- **`sameValue` now genuinely lives in one place** — a third copy in `bulk.ts` outlived the first consolidation.
- **The seven resource CRUD blocks are generated from their specs** by `makeResourceTools` rather than hand-written per resource, and the duplicated `sameValue` helper now lives once in `resource-write.ts`.
- **License changed from proprietary to Apache-2.0** — the project is now open source under the Apache License, Version 2.0.

### Fixed

- **A close-all could leave the book open.** The admin collection endpoints are cursor-paginated (`nextToken`), and every admin tool read exactly one page. `close_all_positions` and `cancel_all_orders` therefore reported "closed 12, none left" with the rest of the account's book untouched, `bulk_*` selections silently dropped ids that were not on page 1, and a single-record lookup could miss its record. All of them now walk the pages to the end (`paging.ts`) and refuse to act on a collection they could not finish reading. Verified live: the cursor must travel in the QUERY STRING — a `nextToken` in a POST body is silently ignored and the same page comes back forever.
- **`accountId` did not actually lock a lookup to that account.** `get_position` / `get_trade` / `get_transfer` and the position/trade plans only used the account to narrow the fallback query; the record that came back was never re-checked, and the get-by-id path ignored the account entirely. A correction could then be previewed against one account and written to `A: current.A` — the real owner. The owning account is now enforced on both paths, and a record with no account field fails loudly instead of being trusted.
- **The get-by-id fallback swallowed every error.** A `401` or `403` was reported as "not found" after a pointless second request. Only the statuses that mean "this build does not serve the route" (405/501/502/503) fall back now; a 404 answers "no such record" and everything else surfaces as itself.
- **`cash_transfer` could move money twice.** It was the one money-mover still using the default transport retry, so a connection reset would resend an identical deposit or withdrawal. It now opts out like every other non-idempotent write, as does each delete issued by `cancel_all_orders`.
- **Routing writes went straight through.** With the ETag bug above fixed, `set_order_routing` / `add_routing_rule` / `remove_routing_rule` began actually replacing live, server-wide execution rules with no preview — the only destructive config writes not behind a confirmation. They are now `*_plan` / `*_commit` pairs that show the before/after rule list, and `cancel_all_orders` is likewise confirmed before it wipes an account's working orders.
- **A password reset could bypass the tool built for it.** `update_account_plan` and `bulk_update_plan` wrote `password` through the generic account upsert, with the generic disclosure — and a bulk call could have reset every account on the server. Both now refuse the field and point at `set_account_password_*`, which states who gets locked out. Creating an account still takes its initial password.
- **`create_manager_plan` skipped the shared create hygiene**, stashing and echoing the raw record; it now strips server-assigned fields and masks secrets like the other six creates.
- **A write could inherit a previous write's ETag.** The symbol and group commits set `If-Match` only when the plan had captured an ETag, leaving whatever a prior, unrelated write had cached on the same path. That either failed confusingly or sent a stale version as the conflict check. The ETag is now always written (cleared when there is none) — the behaviour the shared helper already had.
- **The version could be paired with the wrong response.** Plans read the ETag back out of `RestClient`'s per-path cache after parsing the body, so two concurrent plans for the same resource could swap versions between them and defeat the `If-Match` conflict check. `RestClient.getWithEtag()` now returns the body and the ETag of that exact response together.
- **`timePasswordLastChanged` was not stripped before writing a trading account.** The spec marks it read-only like `timeCreated`/`timeModified`, so echoing it back is rejected as `Invalid body`. It is now part of the stripped set.
- **Previews could approve changes that were never sent.** `*_plan` built its diff (and `willCreate`) from the object *before* read-only fields were removed, so an update targeting one of them showed as an approved change and then silently vanished. Diffs and previews are now built from exactly what will be posted, and any update aimed at a read-only field is reported back as `ignoredReadOnlyFields` instead of disappearing.
- **Previews could leak a supplied account password.** The generic create/update/bulk previews echoed their input verbatim, so `create_account_plan` (which requires an initial `password`) printed it back. Secret fields are now masked in every preview (`willCreate`, diffs, bulk `setting`) while the stashed commit payload keeps the real value.
- **Bulk change-detection counted read-only fields.** `bulk_update_plan` selected records for writing based on fields that stripping would remove from the payload, producing pure no-op writes that still bumped every record's version; server-managed keys are now dropped before detection and reported as `ignoredReadOnlyFields`.
- **`set_order_routing` made the caller's `version` decorative.** The tool bridged the freshest ETag onto the write, so a stale replacement would silently overwrite a concurrent routing change; it now fails loudly when the config moved since the caller read it.
- **Resource commits are no longer transport-retried.** A connection reset does not prove non-delivery, and a retried create (which carries no `If-Match`) could mint a duplicate live record.
- **`stop()` did not stop a renewal that was already in flight.** A failure arriving after `stop()` scheduled another retry, quietly restarting the loop against a connection the caller had closed. `stop()` is now terminal; ordinary refresh cycles use a separate timer reset.

- **Order-routing writes could never succeed.** `set_order_routing`, `add_routing_rule` and `remove_routing_rule` post to `/admin/routing/edit`, which always requires `If-Match` — but the ETag only ever arrives on `/admin/routing/query`, and `RestClient` keys ETags by path, so every write failed with `PRECONDITION_FAILED`. The routing tools now carry the ETag from the read onto the write path. Verified live: a rule can now be added, reordered and restored.
- **A repeated GET of the same resource failed with "Not modified (304)".** `RestClient` sent `If-None-Match` from its ETag cache but never cached response bodies, so a 304 could only ever surface as an error — reading any resource twice in one session (for example reading the routing config before editing it) threw. The conditional header is no longer sent; ETags are still recorded, because writes need them for `If-Match`.

- **Account and symbol filters were silently ignored, so account-scoped queries returned EVERY record on the server — and the close/cancel tools acted on that answer.** `close_position`, `close_by`, `cancel_all_orders` and `close_all_positions` resolved their targets from the same unfiltered listing, so on a busy server `close_all_positions` would have fired closing orders across every account's book; they now scope with `accountFilter` AND re-check each record's owning account before acting. `get_working_orders`, `get_open_positions`, `get_trade_history`, `get_order_history`, `get_transfer_history`, `get_account_state` and `get_balances` sent a bare `{ A, s }` filter, but these endpoints scope with `accountFilter` (`{ accounts: [...] }`) and `symbolNames`. The server accepted the request and ignored the filter, so "positions for account X" came back with every account's positions — and anything acting on that answer would target the wrong records. Verified live before and after the fix.

- **Session renewal no longer gives up permanently after a transient failure.** A single failed token refresh/re-authorize used to leave the renewal timer un-armed, so the session silently died and every later request failed (as HTTP 502, not 401, on some servers) until the process was restarted. Renewal now re-arms with bounded exponential backoff (30s → 5m) until it recovers.

## [2.2.0] - 2026-07-02

### Added

- **Automatic role detection for login/password sign-ins.** With no `YB_MODE` set, the server signs in and detects whether the account is a **manager** (admin tools) or a **trader** (client tools) — one configuration story for everyone. Detection is fail-closed: if it cannot confirm a manager, it starts in client mode (the role probe is capped at 5 seconds).
- **Admin mode via manager sign-in.** `YB_MODE=admin` (or auto-detection) now works with `YB_LOGIN`/`YB_PASSWORD` — a manager session that refreshes automatically, as an alternative to static API keys.
- `health_check` now reports the detected mode (client/admin) and, for login/password sign-ins, the account number — so you can always see which role was picked.

### Changed

- **The Claude Desktop extension is back to one credential set** — server address, login, password (+ optional broker). The API key/secret fields added in 2.1.0 are gone from the form; key-pair configuration remains available in manual/npx setups.
- **Upgrading the extension from 2.1.0:** if you configured an API key in 2.1.0, open Settings → Extensions → trade-server-mcp → Configure, enter your manager **login and password** (keep your admin server address), Save, and toggle the extension off/on. Your previously saved key/secret is no longer read.
- Login/password configurations without an explicit `YB_MODE` now perform one role-detection request at startup (previously they were assumed to be traders). A manager login that used to get trader tools now correctly gets admin tools. Set `YB_MODE=client` (or `admin`) explicitly to skip detection and keep exactly the previous behavior.

## [2.1.0] - 2026-07-01

### Added

- **Manager/admin support in the one-click Claude Desktop extension (`.mcpb`).** The extension now works for both traders and managers/brokers and auto-detects which API to use from the credentials you enter: a **login + password** connects to the Public (trader) API, and an **API key + secret** connects to the Manager (admin) API — no mode setting required. The API key and secret are stored securely in your operating system's keychain.
- Documentation for changing your saved extension credentials (for example after a mistyped password).

### Changed

- The Claude Desktop extension's credential form no longer requires a login/password; managers can leave those blank and supply an API key/secret instead.

## [2.0.4] - 2026-06-30

### Fixed

- `WsClient.connect()` now rejects (instead of hanging) when the socket closes before it opens — e.g. the server refuses the connection, or `disconnect()` is called mid-connect — so callers awaiting `connect()`/`ensureConnected()` no longer hang forever.

## [2.0.3] - 2026-06-30

### Fixed

- WebSocket URL derivation now converts the base-URL scheme with an anchored, case-insensitive match, so an uppercase scheme (e.g. `HTTPS://`) — which passes config validation — no longer yields an invalid WebSocket URL.
- `getSnapshot` no longer uses an async Promise executor and is guarded against late-handler / double-cleanup races (a `settled` flag, a single restartable timer, and a best-effort `.catch`'d unsubscribe), so a subscribe rejection can never leak as an unhandled rejection.
- The `place_order_plan` completeness hint now lists all valid time-in-force values (`IOC`, `FOK`, `GTC`, `GTD`, `Day`, `Ms`) instead of a subset, so it no longer implies the others are unsupported.

## [2.0.2] - 2026-06-30

### Fixed

- **Preview accuracy for price-conditional orders.** `place_order_plan` (client and admin) now requires `limitPrice` for **Limit/StopLimit** orders and `stopPrice` for **Stop/StopLimit** orders before issuing a commit token, and the order preview no longer renders a price-conditional order as "@ market" when its price is missing. Previously such an order could be planned without its price and shown as a market order.
- The MCP server now reports its version from `package.json` instead of a hardcoded string (which had drifted out of sync with the release).

## [2.0.1] - 2026-06-30

### Security

- **Enforce secure transport for `YB_BASE_URL`.** The base URL is now validated at startup: `https://` is required by default to protect API credentials in transit, embedded `user:pass@` URL credentials are rejected, and malformed URLs fail with a clear message. A new opt-in `YB_ALLOW_INSECURE_BASE_URL` (`true`/`1`/`yes`) allows `http://` for local development only (other schemes such as `ws://` are still rejected).

## [2.0.0] - 2026-06-29

### Changed

- **BREAKING — trade execution is now two-step (confirm-before-execute).** The four one-shot money-mover tools (`place_order`, `close_position`, `close_by`, `close_all_positions`) are replaced by `*_plan` / `*_commit` pairs in both client and admin mode. `*_plan` validates and returns a preview (order summary + live quote + free margin) plus a single-use `commitToken` **without touching the market**; `*_commit` consumes the token and executes the unchanged order. This is what lets a non-technical user trade safely from Claude Desktop (preview → confirm → execute), and removes any un-gated execution path. Tool counts: client 26 → 30, admin 38 → 42.
- Reworded the HTTP 400/404 sign-in hint: it no longer asserts a wrong port as the cause, and instead points to invalid-parameter / stray optional field / wrong endpoint / server-side possibilities.

### Added

- Two-phase trade execution: a single-use commit token (5-minute TTL), an order preview (plain-language summary + live quote + free margin), actionable parameter-completeness messages ("here's exactly what's missing" instead of guessing), MCP tool annotations (`readOnlyHint` on `*_plan`, `destructiveHint` on `*_commit`), and an AI disclosure on commit.

### Fixed

- Client sign-in no longer fails when an optional config field is left blank: an unsubstituted `${...}` placeholder env value (injected by some MCP hosts for empty optional fields, such as `YB_BROKER`) is now treated as unset instead of sent as a literal value, which the server rejected with HTTP 400.
- `get_symbols` glob filter now matches the server's symbol-name field (`n`), so patterns like `EUR*` return results instead of an empty list.
- WebSocket: an explicit `disconnect()` is now terminal and no longer triggers a reconnect loop; pending requests are rejected promptly on close instead of hanging (Issue #9).
- Admin trading: order-creating operations no longer retry on a transport error, matching client mode and preventing duplicate execution (Issue #9).
- WebSocket `getSnapshot` now rejects on a subscribe failure instead of silently returning empty data, so callers can distinguish "no data" from "subscription failed" (Issue #9).

### Security

- `get_quotes` (client and admin) now caps the `symbols` array at 50 and runs at most 8 upstream lookups concurrently, preventing unbounded fan-out / self-DoS (Issue #8).
- All REST calls now enforce a request timeout (default 10s, configurable via `YB_REQUEST_TIMEOUT_MS`), reported as a stable `TIMEOUT` error. Timeouts are never auto-retried, preserving duplicate-fill protection on order placements (Issue #8).

## [1.1.1] - 2026-06-10

### Security

- Bumped `ws` to 8.21.0 (GHSA-58qx-3vcg-4xpx) and refreshed transitive dependencies via `npm audit fix` — `npm audit` is clean.

### Changed

- The npx no-clone install is now the primary configuration shown in all documentation examples.
- Supply-chain policy wording updated to cover both distribution forms (pinned npx tag, clone + build).
- The regression script no longer assumes a specific account; set `REGRESSION_ACCOUNT_ID` to enable the account-info check.

## [1.1.0] - 2026-06-10

### Added

- Client (trader) mode with 26 tools against the public Trade Server API.
- Two client authentication styles: login+password with automatic token refresh, and static public API token.
- Duplicate-fill protection: order-placement POSTs never retry on connection errors.
- Targeted sign-in failure diagnostics surfaced in tool results (credential, server-version, and connectivity hints).
- 85-test suite using node:test, including golden HMAC vectors.
- stdio JSON-RPC regression harness (`scripts/regression-admin.mjs`) supporting both admin and client modes.

### Changed

- Admin mode is unchanged at 38 tools.

## [1.0.0] - 2026-05-18

### Added

- Initial internal release: admin mode with 38 tools — trading, account management, market data with locally computed technical indicators, server configuration — plus 4 MCP resources.

[Unreleased]: https://github.com/yourbourse/trade-server-mcp/compare/v2.2.0...HEAD
[2.2.0]: https://github.com/yourbourse/trade-server-mcp/compare/v2.1.0...v2.2.0
[2.1.0]: https://github.com/yourbourse/trade-server-mcp/compare/v2.0.4...v2.1.0
[2.0.4]: https://github.com/yourbourse/trade-server-mcp/compare/v2.0.3...v2.0.4
[2.0.3]: https://github.com/yourbourse/trade-server-mcp/compare/v2.0.2...v2.0.3
[2.0.2]: https://github.com/yourbourse/trade-server-mcp/compare/v2.0.1...v2.0.2
[2.0.1]: https://github.com/yourbourse/trade-server-mcp/compare/v2.0.0...v2.0.1
[2.0.0]: https://github.com/yourbourse/trade-server-mcp/compare/v1.1.1...v2.0.0
[1.1.1]: https://github.com/yourbourse/trade-server-mcp/compare/v1.1.0...v1.1.1
[1.1.0]: https://github.com/yourbourse/trade-server-mcp/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/yourbourse/trade-server-mcp/releases/tag/v1.0.0
