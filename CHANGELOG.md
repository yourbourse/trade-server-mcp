# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed

- Client mode: the sign-in hint is no longer appended to unrelated server errors (e.g. a 502 on a data endpoint), so a server-side failure is reported as itself instead of a misleading "sign-in rejected / wrong port". The 400/404 sign-in hint wording no longer asserts port/version as the cause.

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
