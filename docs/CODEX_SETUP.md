# Codex Setup — Step by Step (No Experience Needed)

Connect the Trade Server MCP to **OpenAI Codex**, so you can ask Codex to check your account,
pull quotes, and place orders. No coding — you'll fill in one short form.

> This is for the **Codex app** (which runs MCP servers on your machine). The **ChatGPT website is
> different** — it can only connect to remote, hosted servers, not a local one like this. Prefer
> Claude Desktop or VS Code? See [Claude Desktop Setup](./CLAUDE_DESKTOP_SETUP.md) or
> [VS Code Setup](./VSCODE_SETUP.md).

## What you'll need

- **OpenAI Codex**, installed and signed in.
- **Node.js 18+** and **git** — one-time installs. The
  [Claude Desktop guide](./CLAUDE_DESKTOP_SETUP.md#step-1--install-nodejs) has click-by-click steps
  for both if you need them.
- **Access to this repository.** The server is fetched from GitHub, so your machine needs read
  access to the repo. (While the repo is private this means a YourBourse GitHub account; once it is
  public, anyone can install it.)

## Step 1 — Open the custom-MCP form

1. Open the **account menu** at the bottom-left (your name) and choose **Settings** (`Ctrl+,`).

   ![The Codex account menu open, with Settings highlighted](images/codex-setup/01-open-settings.png)

2. In Settings, under **Integrations**, click **MCP servers**, then add a custom MCP. Make sure the
   **STDIO** tab is selected (not "Streamable HTTP").

   ![Codex Settings → MCP servers → the custom-MCP form, with STDIO selected](images/codex-setup/02-mcp-servers-form.png)

## Step 2 — Fill in the form

This is the **trader (client)** setup. Enter exactly this:

| Field | Value |
|---|---|
| **Name** | `trade-server` |
| **Type** | **STDIO** |
| **Command to launch** | `npx` |
| **Arguments** (use **+ Add argument** for each) | `-y` &nbsp;·&nbsp; `github:yourbourse/trade-server-mcp` |

**Environment variables** (use **+ Add environment variable** for each) — fill in the details from
your broker:

| Key | Value |
|---|---|
| `YB_BASE_URL` | your server address, e.g. `https://your-server-host:port` |
| `YB_MODE` | `client` |
| `YB_LOGIN` | your trading account login |
| `YB_PASSWORD` | your account password |

> **Broker administrator?** Use `YB_MODE` = `admin` with `YB_API_KEY` + `YB_SECRET_KEY` instead of
> login/password. Issued an API **token pair** instead of a password? See
> [Getting an API token pair](./CONFIGURATION.md#getting-an-api-token-pair).
>
> `YB_MODE` is optional since 2.2.0 — omit it and your role is detected automatically; managers
> can use login/password instead of a key pair.

**⚠️ Working directory — this must be filled in with a folder that exists on your computer.** Do
**not** leave the `~/code` placeholder: if that folder doesn't exist, the server can fail to launch
(common on Windows). Use any real path, for example `C:\Users\<you>\Documents` on Windows or `~` on
macOS/Linux. Leave **Environment variable passthrough** empty.

![The filled form: npx, the two arguments, the four environment variables, and a real working directory](images/codex-setup/03-filled-form.png)

Click **Save**.

## Step 3 — Restart Codex

**Fully quit and reopen Codex.** The server and its tools only appear after you **Save and
restart** — if you skip the restart, `trade-server` won't show up.

## Step 4 — Check that it works

Ask Codex something **read-only**, for example:

> *"Use the trade-server tools to run a health check"* — or — *"get a quote for EURUSD"*

If you get back the server's time and version (or a quote), you're connected. Use a read-only
request to verify — **don't place an order just to test**. Orders are a two-step **plan → commit**
flow, so nothing executes until you explicitly confirm.

## If something went wrong

| Symptom | Fix |
|---|---|
| `trade-server` doesn't appear after saving | You must **Save and then fully quit/reopen Codex**. |
| The server won't launch / odd startup behavior | Set **Working directory** to a folder that actually exists (not the `~/code` placeholder) — especially on Windows. |
| `npx` fails with an authentication or "not found" error | Your machine needs **read access to the repository**. While it's private, sign in to the YourBourse GitHub account; once public this goes away. |
| "npx/node not found" | Install **Node.js 18+** and **git** ([guide](./CLAUDE_DESKTOP_SETUP.md#step-1--install-nodejs)), then reopen Codex. |
| `get_balances` / `get_limits` return **Bad Gateway** | Expected on current Trade Server builds — those two endpoints aren't implemented server-side yet. Everything else works; use the **account summary** for balance, equity, and margin. See [Troubleshooting](./TROUBLESHOOTING.md#older-trade-server-versions-server-compatibility). |

## What's next

- [Tools Reference](./TOOLS_REFERENCE.md) — every tool you can ask for
- [Usage Examples](./USAGE_EXAMPLES.md) — realistic things to say
- [Configuration](./CONFIGURATION.md) — all environment variables and setups
- [Troubleshooting](./TROUBLESHOOTING.md) — when something doesn't work
