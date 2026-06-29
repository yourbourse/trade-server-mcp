# Getting Started

Trade Server MCP connects Claude (or any MCP-compatible AI client) to a YourBourse Trade
Server, so you can monitor accounts, pull market data, and trade — by talking to your AI.
This guide takes you from a fresh machine to your first successful tool call.

> **New to MCP and using Claude Desktop?** The
> [Claude Desktop Setup guide](./CLAUDE_DESKTOP_SETUP.md) is a foolproof, screenshot-by-screenshot
> walkthrough made for first-timers. This page is the more general, all-clients reference.

## Prerequisites

- **Node.js 18 or newer** — check with `node --version`.
- **git** — used by npx to fetch the server from GitHub (or by you, to clone it).
- **A YourBourse Trade Server with API access**, and credentials for it (see
  [Choose your mode](#choose-your-mode) below for which credentials you need).

> **Port note:** the client (public) API and the admin API are served on **different ports**
> of the same Trade Server — use the client port for client mode and the admin port for admin
> mode; your broker or server operator tells you which is which.
>
> **Server version note:** trader (client) mode uses the server's public client API. If
> sign-in is rejected even though your credentials are correct, first check you are using the
> client port (not the admin port); if the port is right, your server may predate the public
> client API — see [Troubleshooting](./TROUBLESHOOTING.md) and ask your broker to confirm.

## Install

The server is distributed as source from this repository — never via the npm registry
(a deliberate supply-chain choice, see [Security](./SECURITY.md)). There are two ways to
run it:

**Option A — no clone (recommended).** Let your MCP client fetch and run the server directly
from GitHub. Nothing to download manually; you just use
`"command": "npx", "args": ["-y", "github:yourbourse/trade-server-mcp"]` in your MCP
configuration instead of a local file path. It tracks the latest code on the `main` branch (a moving
target, not a fixed release), so you're not stuck on an old version (prefer a fixed version? pin a tag
or commit — see [Configuration](./CONFIGURATION.md#pinning-a-version)). The first launch takes a little longer (npx
fetches and builds the code from `main` once, then caches it). Requires Node.js 18+ and git.
All full configuration examples in [Configuration](./CONFIGURATION.md) work with either
option — just swap the `command`/`args` pair.

**Option B — clone and build**, if you prefer a local checkout you can read and verify:

```bash
git clone https://github.com/yourbourse/trade-server-mcp.git
cd trade-server-mcp
npm ci
npm run build
```

This produces `dist/index.js`, which is the file your MCP client will run
(`"command": "node", "args": ["<path-to-repo>/dist/index.js"]`).

To verify a local build, you can run the test suite with `npm test`.

## Choose your mode

The server runs in one of two modes, matching two kinds of users:

**Broker administrator (admin mode).** You operate the Trade Server itself: you can see and
manage every account, review and edit order routing, transfer cash, inspect liquidity
connectors, and use the full market-data toolset — 42 tools with server-wide scope. You need an
**admin API key pair** (`YB_API_KEY` + `YB_SECRET_KEY`), which comes from your YourBourse server
administration setup. If you manage the server, you (or your team) issue these keys.

**Trader (client mode).** You trade your own account: place and manage orders, set stop loss
and take profit, close positions, check balances, and pull quotes and candles — 30 tools, all
scoped to your single account. You need either your **account login and password**
(`YB_LOGIN` + `YB_PASSWORD`), or a **public API token pair** if your broker has issued you one.
Both come from your broker. Client mode is the right choice for almost everyone who isn't
running the server themselves.

For a deeper look at each persona, see [Admin Mode](./ADMIN_MODE.md) and
[Client Mode](./CLIENT_MODE.md).

## First connection

1. **Add the server to your MCP client's configuration** with the environment variables for
   your mode. [Configuration](./CONFIGURATION.md) has complete copy-paste examples for Claude
   Desktop, Claude Code, and generic MCP clients, for all three credential setups — use the
   npx one-liner (Option A), or your local `dist/index.js` path if you cloned and built the
   repo (Option B).

2. **Restart your MCP client** (for Claude Desktop, fully quit and reopen the app) so it picks
   up the new server.

3. **Check the startup line.** The server logs to stderr on startup. In client mode with
   login/password you should see:

   ```
   Trade Server MCP: client mode, signed in as account <login>
   ```

   followed by `Trade Server MCP running on stdio`. Admin mode logs
   `Trade Server MCP: admin mode (server-wide tools)` instead. The full set of startup lines
   (including what a failed sign-in looks like) is listed in
   [Configuration](./CONFIGURATION.md#startup-log-lines).

4. **Run the smoke test.** Ask your AI something like *"Run a health check on the trade
   server."* — it should call the `health_check` tool and report that the server is reachable.
   From there, try *"What's my account state?"* and you're trading.

## Where next

- [Claude Desktop Setup](./CLAUDE_DESKTOP_SETUP.md) / [VS Code (Copilot) Setup](./VSCODE_SETUP.md) —
  click-by-click install for each host
- [Configuration](./CONFIGURATION.md) — every environment variable, all config examples, every
  startup message
- [Tools Reference](./TOOLS_REFERENCE.md) — all 30 client tools and 42 admin tools in detail
- [Admin Mode](./ADMIN_MODE.md) — the broker administrator's guide
- [Client Mode](./CLIENT_MODE.md) — the trader's guide
- [Usage Examples](./USAGE_EXAMPLES.md) — realistic conversation patterns
- [Troubleshooting](./TROUBLESHOOTING.md) — when something doesn't work
- [FAQ](./FAQ.md) — common questions
