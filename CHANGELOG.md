# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed

- Client sign-in no longer fails when an optional config field is left blank: an unsubstituted `${...}` placeholder env value (injected by some MCP hosts for empty optional fields, such as `YB_BROKER`) is now treated as unset instead of sent as a literal value, which the server rejected with HTTP 400.
- `get_symbols` glob filter now matches the server's symbol-name field (`n`), so patterns like `EUR*` return results instead of an empty list.
- WebSocket: an explicit `disconnect()` is now terminal and no longer triggers a reconnect loop; pending requests are rejected promptly on close instead of hanging (Issue #9).
- Admin trading: order-creating operations (`place_order`, `close_position`, `close_all_positions`, `close_by`) no longer retry on a transport error, matching client mode and preventing duplicate execution (Issue #9).
- WebSocket `getSnapshot` now rejects on a subscribe failure instead of silently returning empty data, so callers can distinguish "no data" from "subscription failed" (Issue #9).

### Changed

- Reworded the HTTP 400/404 sign-in hint: it no longer asserts a wrong port as the cause, and instead points to invalid-parameter / stray optional field / wrong endpoint / server-side possibilities.

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

[Unreleased]: https://github.com/yourbourse/trade-server-mcp/compare/v1.1.1...HEAD
[1.1.1]: https://github.com/yourbourse/trade-server-mcp/compare/v1.1.0...v1.1.1
[1.1.0]: https://github.com/yourbourse/trade-server-mcp/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/yourbourse/trade-server-mcp/releases/tag/v1.0.0
