<div align="center">

# Trade Server MCP

**Trade on YourBourse Trade Server from Claude and any MCP-compatible AI — as a broker or as a trader**

[![CI](https://github.com/yourbourse/trade-server-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/yourbourse/trade-server-mcp/actions/workflows/ci.yml)
[![Version](https://img.shields.io/badge/version-2.0.0-blue)](https://github.com/yourbourse/trade-server-mcp/blob/main/CHANGELOG.md)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-blue?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-%E2%89%A518-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![MCP](https://img.shields.io/badge/MCP-Model%20Context%20Protocol-7C3AED)](https://modelcontextprotocol.io/)
![Tests](https://img.shields.io/badge/tests-148%20passing-brightgreen)
![License](https://img.shields.io/badge/License-Proprietary-red.svg)

<br>

A [Model Context Protocol](https://modelcontextprotocol.io/) server that connects AI assistants
to a YourBourse Trade Server. Ask your AI to check your account, pull live quotes, place and
manage orders, or — in broker mode — operate across every account, group, and routing rule on
the server. No scripts, no copy-pasting API responses.

<br>

[Getting Started](docs/GETTING_STARTED.md) · [Configuration](docs/CONFIGURATION.md) · [Tools Reference](docs/TOOLS_REFERENCE.md) · [Usage Examples](docs/USAGE_EXAMPLES.md) · [Architecture](docs/ARCHITECTURE.md)

</div>

---

## ⚡ New to MCP? Set up Claude Desktop in 5 steps

Never used an MCP server before? This is for you — you'll be talking to your trading account through
Claude in about 10 minutes, with no coding.

1. **Install the basics** — [Node.js](https://nodejs.org) and [git](https://git-scm.com) (one-time).
2. **Install [Claude Desktop](https://claude.ai/download).**
3. **Open the config file** — in Claude Desktop: Settings → Developer → **Edit Config**.
4. **Paste the block below** into that file and fill in the three details from your broker.
5. **Fully restart Claude Desktop**, then ask it: *"Run a health check on the trade server."*

```json
{
  "mcpServers": {
    "trade-server": {
      "command": "npx",
      "args": ["-y", "github:yourbourse/trade-server-mcp"],
      "env": {
        "YB_BASE_URL": "<your-server-url>",
        "YB_MODE": "client",
        "YB_LOGIN": "<your-login>",
        "YB_PASSWORD": "<your-password>"
      }
    }
  }
}
```

👉 **New to all this? Follow the [full click-by-click guide with screenshots](docs/CLAUDE_DESKTOP_SETUP.md).**

**Using VS Code instead?** Follow the [VS Code / GitHub Copilot setup guide](docs/VSCODE_SETUP.md).
**Using ChatGPT?** It connects only to hosted servers, not a local one like this — [see the note](docs/VSCODE_SETUP.md#using-chatgpt-instead).

> Most people should use the setup above. You only need to clone and build the repository if you're a
> developer who wants to read or modify the code.

---

## Highlights

| Feature | Description |
|---------|-------------|
| **Two modes, one server** | **Client mode** for traders (scoped to your own account) and **admin mode** for broker operations (server-wide) — selected by the credentials you configure |
| **30 trader tools / 42 broker tools** | Task-shaped tools covering trading, account monitoring, market data, and (admin) server configuration, plus MCP resources for static context |
| **Live trading** | Market, Limit, Stop, StopLimit, and CloseBy orders with optional SL/TP; modify, cancel, partial close, flatten-everything composites |
| **Account monitoring** | Balance, equity, margin, unrealized P/L, open positions, working orders, trade and transfer history — single calls or one-shot summaries |
| **Market data & indicators** | Quotes, market depth, OHLCV candles, currency conversion; admin mode adds locally computed indicators (RSI, MACD, EMA, Bollinger Bands, and more) |
| **HMAC auth with auto-refresh** | Every write is HMAC-SHA256 signed; client login sessions refresh automatically before expiry — no manual token handling |
| **Safety by design** | Order-placing requests are never retried on connection errors (no duplicate fills); bulk tools report per-item outcomes; client sessions cannot touch other accounts |
| **Zero codegen** | Every tool is hand-written with intent-rich descriptions your AI actually understands, and checked against the server's OpenAPI contract in tests |

---

## Quick Start

New to MCP and on Claude Desktop? Use the **5-step setup above**, or the full
[Claude Desktop Setup guide](docs/CLAUDE_DESKTOP_SETUP.md). This section is the condensed reference
for every client.

**No-clone install (recommended).** Node.js 18+ and git are all you need — your MCP client fetches,
builds, and runs the server straight from this repository. It tracks the **latest version on the
`main` branch** (a moving target, not a fixed release), so fixes and improvements reach you without
editing your config — clear the npx cache when you want the newest `main`, since npx caches by spec
and may keep running its cached copy until you do. Point your client's `command`/`args`
at `npx -y github:yourbourse/trade-server-mcp`; complete per-client config snippets (Claude Desktop,
Claude Code, and others), both modes, and every environment variable are in
[Configuration](docs/CONFIGURATION.md).

**Or clone and build** if you prefer a local checkout you can read and modify:

```bash
git clone https://github.com/yourbourse/trade-server-mcp.git
cd trade-server-mcp
npm ci
npm run build
```

then use `"command": "node", "args": ["<path-to-repo>/dist/index.js"]` with the same `env` block.

Broker administrators use `YB_MODE=admin` with `YB_API_KEY` / `YB_SECRET_KEY` instead — see
[Admin Mode](docs/ADMIN_MODE.md).

**Finally, restart your MCP client** so it launches the server — then ask your AI:
*"What's my account state?"*

> **Pinning a version (advanced).** The default install follows the `main` branch (latest code). If
> you need a reproducible, immutable build, pin a specific release tag or commit — see
> [Configuration](docs/CONFIGURATION.md#pinning-a-version) for the syntax.

First time setting up? The [Getting Started guide](docs/GETTING_STARTED.md) walks through everything,
including which credentials you need and how to verify the first tool call.

---

## Modes

One process runs exactly one mode — the tool set is decided at startup from your credentials.

| | Client mode (traders) | Admin mode (brokers) |
|---|---|---|
| **Who it's for** | A trader with an account at a broker running a YourBourse Trade Server | The broker: operations and administration teams |
| **Scope** | Your own account only — the session token *is* the scope, enforced by the server | Server-wide: every account, group, client, routing rule, and liquidity connector |
| **Tools / resources** | 30 tools, 1 resource | 42 tools, 4 resources |
| **Credentials** | `YB_LOGIN` + `YB_PASSWORD` (or a pre-issued token pair) | `YB_API_KEY` + `YB_SECRET_KEY` from the server admin panel |
| **Trading** | On your account; no account parameter exists | On behalf of any account via `accountId` |
| **Extras** | Rate-limit visibility, scoped balances | Cash transfers, order routing management, indicators, L1/L2 over WebSocket |

Full guides: [Client Mode](docs/CLIENT_MODE.md) · [Admin Mode](docs/ADMIN_MODE.md)

---

## Documentation

### Setup & Configuration

| Guide | Description |
|-------|-------------|
| [Getting Started](docs/GETTING_STARTED.md) | From a fresh machine to your first successful tool call, step by step |
| [Claude Desktop Setup](docs/CLAUDE_DESKTOP_SETUP.md) | Click-by-click install for Claude Desktop, with screenshots — no experience needed |
| [VS Code (Copilot) Setup](docs/VSCODE_SETUP.md) | Click-by-click install for VS Code + GitHub Copilot, plus a note on ChatGPT |
| [Configuration](docs/CONFIGURATION.md) | Every environment variable, mode selection rules, ready-to-paste client configs, and [running more than one server](docs/CONFIGURATION.md#running-more-than-one-server) |

### Using the Server

| Guide | Description |
|-------|-------------|
| [Client Mode](docs/CLIENT_MODE.md) | The trader's guide: scoping model, what you can do, and what's deliberately impossible |
| [Admin Mode](docs/ADMIN_MODE.md) | The broker's guide: server-wide operations, configuration tools, and safe usage |
| [Tools Reference](docs/TOOLS_REFERENCE.md) | Every tool in both modes — descriptions, parameter tables, and example calls |
| [Usage Examples](docs/USAGE_EXAMPLES.md) | Realistic conversations: what you say, which tools the AI calls, what comes back |

### Reference & Internals

| Document | Description |
|----------|-------------|
| [Architecture](docs/ARCHITECTURE.md) | Components, module map, mode selection, and the life of a tool call |
| [Authentication](docs/AUTHENTICATION.md) | HMAC-SHA256 signing, the three credential setups, token refresh, and failure handling |
| [Security](docs/SECURITY.md) | Credential-handling guarantees, config-file hygiene, supply-chain stance, reporting |

### Help & Contributing

| Document | Description |
|----------|-------------|
| [Troubleshooting](docs/TROUBLESHOOTING.md) | Symptom-indexed fixes, from startup errors to old-server compatibility |
| [FAQ](docs/FAQ.md) | Quick answers to the questions that come up most |
| [Contributing](docs/CONTRIBUTING.md) | Dev setup, the hand-written-tools policy, how to add a tool, conventions |

---

## Architecture Overview

```
+--------------------+      stdio (JSON-RPC / MCP)
|     MCP client     | <-------------+
| (Claude Desktop,   |               |
|  Claude Code, ...) |               v
+--------------------+    +--------------------+
                          |      index.ts      |
                          |  parse env config, |
                          |     pick a mode    |
                          +---------+----------+
                                    |
                    +---------------+---------------+
                    v                               v
         +--------------------+         +---------------------+
         | register-admin.ts  |         | register-client.ts  |
         | 42 tools, 4 res.   |         | 30 tools, 1 res.    |
         +---------+----------+         +----------+----------+
                   |                               |
                   v                               v
         +--------------------+         +---------------------+
         |   tools/admin/*    |         |   tools/client/*    |
         +----+----------+----+         +----------+----------+
              |          |                         |
 quotes/depth |          +-----------+   +---------+
              v                      v   v
         +-----------+      +------------------------------+
         | WsClient  |      |          RestClient          |
         | (admin    |      |  HMAC signing, auth retry,   |
         |  only)    |      |  semantic errors, ETag cache |
         +-----+-----+      +---------------+--------------+
               |                            |
               v                            v
         +---------------------------------------------+
         |          YourBourse Trade Server            |
         |       /api/v1 (REST)     /ws/v1 (WS)        |
         +---------------------------------------------+
```

### Key Modules

| Module | Purpose |
|--------|---------|
| `src/index.ts` | Entry point: parse config, build the auth provider and clients for the selected mode, register tools, connect stdio |
| `src/config.ts` | Environment-variable parsing: mode selection and inference, validation, startup error messages |
| `src/register-admin.ts` / `src/register-client.ts` | The single place where tool names and descriptions live, per mode |
| `src/rest-client.ts` | Signed REST client: HMAC headers, semantic error mapping, ETag caching, 401 renew-and-retry, transport retry policy |
| `src/ws-client.ts` | WebSocket client for live quotes and market depth (admin mode only) |
| `src/auth/` | HMAC-SHA256 signing, static key credentials, and the client login lifecycle with auto-refresh |
| `src/tools/admin/`, `src/tools/client/` | Tool implementations — a zod schema plus an async function per tool, grouped by category |

The full picture — mode selection, the life of a tool call, retry policy, and design
decisions — is in [Architecture](docs/ARCHITECTURE.md).

---

## Project Structure

```
trade-server-mcp/
├── src/
│   ├── index.ts               # Entry point: config → mode → register → stdio transport
│   ├── config.ts              # Env parsing, mode selection & inference
│   ├── register-admin.ts      # Registers the 42 admin tools + 4 resources
│   ├── register-client.ts     # Registers the 30 client tools + 1 resource
│   ├── tool-handler.ts        # Wraps tool results/errors for MCP
│   ├── rest-client.ts         # Signed REST client (HMAC, retries, ETag, error mapping)
│   ├── ws-client.ts           # WebSocket quotes/depth client (admin only)
│   ├── auth/
│   │   ├── admin-auth.ts      # HMAC-SHA256 signing + static credentials
│   │   └── client-auth.ts     # Login sign-in, token auto-refresh, failure hints
│   ├── tools/
│   │   ├── admin/             # trading, account, market-data, config tool modules
│   │   └── client/            # trading, account, market-data tool modules
│   └── test/                  # node:test suite — 85 tests
├── docs/                      # Full documentation set (see index above)
├── reference/
│   └── openapi.json           # Trade Server API contract the tools are checked against
├── scripts/
│   └── regression-admin.mjs   # Live stdio regression harness (admin | client)
├── .github/workflows/ci.yml   # CI: lint, format check, type-check, tests
├── eslint.config.js
├── tsconfig.json
├── package.json
├── CHANGELOG.md
└── LICENSE
```

---

## Scripts

| Command | Description |
|---------|-------------|
| `npm run build` | Compile TypeScript to `dist/` |
| `npm run dev` | Compile in watch mode |
| `npm test` | Build and run the full test suite (85 tests, `node --test`) |
| `npm run lint` | ESLint over the project |
| `npm run format` / `npm run format:check` | Prettier write / verify |
| `npm run type-check` | TypeScript type checking without emitting |
| `npm start` | Run the built server directly (stdio) |

### Live regression harness

`scripts/regression-admin.mjs` drives the **built** server over raw stdio JSON-RPC against a
real Trade Server — exactly like an MCP client would. Credentials come from the environment;
nothing is hardcoded:

```bash
# Admin mode
YB_API_KEY=... YB_SECRET_KEY=... YB_BASE_URL=... node scripts/regression-admin.mjs admin

# Client mode
YB_MODE=client YB_LOGIN=... YB_PASSWORD=... YB_BASE_URL=... node scripts/regression-admin.mjs client
```

Exit code 0 means all checks passed.

---

## Security

Your password is never transmitted — in client login mode it is used only as the local HMAC
signing secret for the sign-in request. Credentials live exclusively in your MCP client's
configuration and the server's process environment; nothing is ever written to disk, logged,
or echoed back to the AI. Order-placing requests are never retried on connection errors, so a
network blip cannot turn into a duplicate fill. The project ships **no npm package by
design**: distribution is npx straight from GitHub — the `main` branch by default, or a pinned tag
or commit for a reproducible build — never the npm registry, keeping the supply chain to four direct
runtime dependencies. Full details, recommended practices, and the vulnerability reporting
process are in [SECURITY.md](docs/SECURITY.md).

---

## License

Copyright (c) 2025-2026 YourBourse. All rights reserved.

This software is proprietary and confidential. Unauthorized copying, distribution,
modification, or use of this software, via any medium, is strictly prohibited. See
[LICENSE](LICENSE) for terms.
