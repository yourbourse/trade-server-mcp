# Security

This document covers what the Trade Server MCP does — and deliberately does not do — with
your credentials, how to protect the configuration files that hold them, recommended
practices for traders and brokers, the project's supply-chain stance, and how to report a
security issue.

## Credential-handling guarantees

These are properties of the code, not aspirations:

- **Your password is never transmitted.** In login/password mode (trader or manager), `YB_PASSWORD` is used
  only as the local HMAC signing secret for the sign-in request (see
  [Authentication](./AUTHENTICATION.md)). The password itself never appears in any request
  body, header, or URL.
- **Your password is never logged or echoed.** It does not appear in startup logs, error
  messages, or tool results — so it cannot leak into your AI conversation either. This is
  pinned by an automated test
  ([`src/test/client-auth.test.ts`](../src/test/client-auth.test.ts), *"failed authorize
  throws with status and server text, never the password"*), which asserts that even a
  failed sign-in error never contains the password.
- **Secret keys never leave your machine.** In admin and client token-pair setups,
  `YB_SECRET_KEY` is used only to compute request signatures locally; only the signature
  is sent.
- **Session tokens live in memory only.** The token pair issued at sign-in is held in
  process memory and rotated automatically. **Nothing is ever persisted to disk** — no
  token cache, no credential file, no history. When the process exits, everything it held
  is gone.

## Protecting your configuration files

Your credentials live in your MCP client's configuration file, so that file deserves the
same care as the credentials themselves.

**Where the files are:**

| Client | Location |
|---|---|
| Claude Desktop (macOS) | `~/Library/Application Support/Claude/claude_desktop_config.json` |
| Claude Desktop (Windows) | `%APPDATA%\Claude\claude_desktop_config.json` |
| Claude Desktop (Linux) | `~/.config/Claude/claude_desktop_config.json` |
| Claude Code (project scope) | `.mcp.json` in the project folder |
| Claude Code (user scope) | `~/.claude.json` |

**Advice:**

- Keep the file readable by your user only. On macOS/Linux:
  `chmod 600 <path-to-config-file>`. On Windows, the default user-profile permissions are
  fine as long as the file stays under your own profile — don't move it somewhere shared.
- **Never commit a config file containing credentials to version control.** This is the
  classic mistake with Claude Code's project-scoped `.mcp.json`: if it holds your
  credentials, add it to `.gitignore`.
- Don't paste your config file (or startup logs containing your server URL) into chats,
  issues, or screenshots without redacting it.
- If you believe a credential has leaked, ask your broker to rotate it (token pair or
  admin keys) or change your account password, then update your stored credentials: for the
  npx/manual setups, edit the values in your MCP client's config file and restart it; for the
  one-click Claude Desktop extension there is no config file — as of 2.2.0 the form holds only
  your login, password, and server address, stored in your OS keychain — edit them via
  **Settings → Extensions → trade-server-mcp → Configure** and
  re-enable the extension (see
  [Change your credentials](./CLAUDE_DESKTOP_SETUP.md#change-your-credentials-eg-after-a-wrong-password)).

## Recommendations

**For traders (client mode):**

- **Use a dedicated trading account for AI use**, funded with what you are comfortable
  having traded by an AI under your supervision — rather than connecting your main
  account. Client mode already guarantees the session cannot reach other accounts (see
  [Client Mode](./CLIENT_MODE.md)), but a dedicated account also bounds what can happen
  on *yours*.
- Prefer a broker-issued **public API token pair** over your login password if your broker
  offers one: it can be revoked independently of your account password.

**For brokers (admin mode):**

- **Least privilege.** If the goal is to let someone (or some AI) trade a single account,
  issue a scoped public token for that account and use **client mode** — don't hand out
  admin keys. Admin keys grant server-wide access to every account, group, and routing
  rule.
- Reserve admin-mode use for operators who genuinely need server-wide tooling, and rotate
  admin key pairs when staff or usage changes.
- Manager login/password sessions hold only an in-memory, auto-refreshing session token —
  an alternative to long-lived static admin keys.

## Supply-chain stance

**This project is deliberately never published to the npm registry.** The wave of npm
supply-chain attacks in May 2026 — including the compromises of **TanStack**,
**node-ipc**, and **@antv** packages — showed how a poisoned registry release can reach
installers within hours. For software that holds trading credentials, we distribute from
this GitHub repository only, in two forms:

- **npx straight from GitHub (default):** `npx -y github:yourbourse/trade-server-mcp` follows the
  repository's `main` branch (the latest code — a mutable target), and there is no registry account to
  hijack. For a reproducible, immutable build, pin a release **tag**
  (`npx -y github:yourbourse/trade-server-mcp#<tag>`) or — for a guarantee the code can never change —
  a **commit SHA** (`#<commit-sha>`), which cannot be silently replaced the way a mutable registry
  version can.
- **Or install from source:** clone the GitHub repository, check out a tag or commit you
  trust, and build locally (see [Getting Started](./GETTING_STARTED.md)).
- **Install dependencies with `npm ci` only.** It installs exactly what the committed
  `package-lock.json` pins — bit-for-bit reproducible — and fails loudly if the lockfile
  and manifest disagree. Don't use `npm install`, which may resolve newer versions.
- **The runtime dependency surface is intentionally small** — four packages:

  | Package | Purpose |
  |---|---|
  | `@modelcontextprotocol/sdk` | The MCP protocol implementation (stdio server, tools, resources) |
  | `technicalindicators` | Local computation of technical indicators from candle data |
  | `ws` | WebSocket client for live quotes (admin mode) |
  | `zod` | Tool parameter validation |

  Everything else (HTTP, HMAC signing, testing) uses Node.js built-ins. New runtime
  dependencies are not added without review.

## Reporting a security issue

If you find a vulnerability in this project, or suspect a credential or trading-account
compromise, please report it privately rather than in a public issue:

- Contact your **YourBourse account manager**, or
- Raise a ticket on the **YourBourse support desk**:
  <https://yourbourse.atlassian.net/servicedesk/customer/portal/1>

Please include the version (commit hash or tag) you are running and enough detail to
reproduce the issue. Do not include live credentials in the report.

## Where next

- [Authentication](./AUTHENTICATION.md) — how signing, sign-in, and token refresh work
- [Configuration](./CONFIGURATION.md) — credential setup per mode
- [Client Mode](./CLIENT_MODE.md) — safety behaviors from a trader's point of view
- [Getting Started](./GETTING_STARTED.md) — install from source
