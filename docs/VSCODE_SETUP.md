# VS Code (GitHub Copilot) Setup — Step by Step (No Experience Needed)

Connect the Trade Server MCP to **GitHub Copilot inside VS Code**, so you can ask Copilot's chat to
check your account, pull quotes, and place orders. No coding — you'll paste one small config block.

> Prefer Claude Desktop? See [Claude Desktop Setup](./CLAUDE_DESKTOP_SETUP.md). Using ChatGPT?
> See [Using ChatGPT](#using-chatgpt-instead) at the bottom — it needs a different setup.

## What you'll need

- **VS Code 1.99 or newer** ([download](https://code.visualstudio.com/)).
- **GitHub Copilot** enabled in VS Code — the **free tier works**. (Sign in to GitHub from VS Code's
  Accounts menu if you haven't.)
- **Node.js 18+** and **git** — one-time installs. The
  [Claude Desktop guide](./CLAUDE_DESKTOP_SETUP.md#step-1--install-nodejs) has click-by-click steps
  for both if you need them.
- **Access to this repository.** The server is fetched from GitHub, so your machine needs read
  access to the repo. (While the repo is private this means a YourBourse GitHub account; once it is
  public, anyone can install it.)

## Step 1 — Open the MCP configuration file

VS Code keeps MCP servers in a file called **`mcp.json`** (this is different from Claude Desktop's
`claude_desktop_config.json`).

1. Open the Command Palette: **`Ctrl+Shift+P`** (Windows/Linux) or **`Cmd+Shift+P`** (Mac).
2. Type **`MCP: Open User Configuration`** and press Enter.

That opens your personal `mcp.json` (it syncs across your devices via Settings Sync). If you'd
rather share the setup with a team, create a file named **`.vscode/mcp.json`** in your project
folder instead and use the same content below.

## Step 2 — Add the Trade Server

Paste this into `mcp.json`. **Note the top-level key is `servers`** (VS Code uses `servers`, not
`mcpServers` like Claude Desktop). This is the trader (client) setup:

```json
{
  "servers": {
    "trade-server": {
      "command": "npx",
      "args": ["-y", "github:yourbourse/trade-server-mcp"],
      "env": {
        "YB_BASE_URL": "https://<your-server-host>:<port>",
        "YB_MODE": "client",
        "YB_LOGIN": "<login>",
        "YB_PASSWORD": "<password>"
      }
    }
  }
}
```

Replace `<your-server-host>:<port>`, `<login>`, and `<password>` with the details from your broker.

**Broker administrator?** Use the admin credentials instead:

```json
{
  "servers": {
    "trade-server": {
      "command": "npx",
      "args": ["-y", "github:yourbourse/trade-server-mcp"],
      "env": {
        "YB_BASE_URL": "https://<your-server-host>:<port>",
        "YB_MODE": "admin",
        "YB_API_KEY": "<api-key>",
        "YB_SECRET_KEY": "<secret-key>"
      }
    }
  }
}
```

`YB_MODE` is optional since 2.2.0 — omit it and your role is detected automatically; managers
can use login/password instead of a key pair.

(Full list of variables and other setups: [Configuration](./CONFIGURATION.md).)

## Step 3 — Start the server and enable its tools

Save `mcp.json`. VS Code shows a small **Start** action above the `"trade-server"` entry — click it.
VS Code launches the server, performs a handshake, and discovers its tools.

MCP tools are **disabled by default**. When prompted (or from the tools picker in Copilot Chat),
**enable the Trade Server tools** so Copilot is allowed to use them.

## Step 4 — Switch Copilot Chat to Agent mode

Open the Copilot Chat view, find the **mode dropdown** (it usually says *Ask*), and choose
**Agent**. This matters: MCP tools are **invisible in Ask and Edit modes** — only Agent mode can
call them.

## Step 5 — Check that it works

In Agent mode, confirm the trade-server tools appear in the tools list, then ask for a **read-only**
check — for example:

> *"Use the trade-server tools to get a quote for EURUSD."*

If a quote comes back, you're connected. (Use a read-only request like a quote or account summary
to verify — don't place an order just to test. Orders are a two-step **plan → commit** flow, so
nothing executes until you explicitly confirm.)

## If something went wrong

| Symptom | Fix |
|---|---|
| The UI "Add Server" / gallery flow won't add it | Add it **manually** by editing `mcp.json` as in Step 2 — that's the reliable method. |
| `npx` fails with an authentication or "not found" error | Your machine needs **read access to the repository**. While it's private, sign in to the YourBourse GitHub account; once public this goes away. |
| "npx/node not found" | Install **Node.js 18+** ([guide](./CLAUDE_DESKTOP_SETUP.md#step-1--install-nodejs)), then reopen VS Code. |
| Tools don't show up in chat | Make sure Copilot Chat is in **Agent** mode (Step 4) and the tools are **enabled** (Step 3). |
| Server won't start | Re-check the JSON (the top key must be `servers`), and that `YB_BASE_URL`/login details are correct. See [Troubleshooting](./TROUBLESHOOTING.md). |

## Using ChatGPT instead?

ChatGPT connects only to **remote, hosted** MCP servers over HTTPS — it **cannot run a local
server** like this one (the `npx` setup above). A hosted option is planned. In the meantime, if
you're technical you can expose a local server to ChatGPT with a bridge such as
[`mcp-remote`](https://github.com/geelen/mcp-remote) plus a public tunnel, but that's an advanced
setup and not recommended for everyday use. For now, **Claude Desktop or VS Code is the
straightforward path.**

## What's next

- [Tools Reference](./TOOLS_REFERENCE.md) — every tool you can ask for
- [Usage Examples](./USAGE_EXAMPLES.md) — realistic things to say
- [Configuration](./CONFIGURATION.md) — all environment variables and setups
- [Troubleshooting](./TROUBLESHOOTING.md) — when something doesn't work
