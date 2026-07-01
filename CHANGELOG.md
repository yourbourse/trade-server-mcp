# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

[Unreleased]: https://github.com/yourbourse/trade-server-mcp/compare/v2.1.0...HEAD
[2.1.0]: https://github.com/yourbourse/trade-server-mcp/compare/v2.0.4...v2.1.0
[2.0.4]: https://github.com/yourbourse/trade-server-mcp/compare/v2.0.3...v2.0.4
[2.0.3]: https://github.com/yourbourse/trade-server-mcp/compare/v2.0.2...v2.0.3
[2.0.2]: https://github.com/yourbourse/trade-server-mcp/compare/v2.0.1...v2.0.2
[2.0.1]: https://github.com/yourbourse/trade-server-mcp/compare/v2.0.0...v2.0.1
[2.0.0]: https://github.com/yourbourse/trade-server-mcp/compare/v1.1.1...v2.0.0
[1.1.1]: https://github.com/yourbourse/trade-server-mcp/compare/v1.1.0...v1.1.1
[1.1.0]: https://github.com/yourbourse/trade-server-mcp/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/yourbourse/trade-server-mcp/releases/tag/v1.0.0
