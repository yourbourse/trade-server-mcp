# FAQ

Quick answers to the questions that come up most. For setup, see
[Getting Started](./GETTING_STARTED.md); for symptom-by-symptom fixes, see
[Troubleshooting](./TROUBLESHOOTING.md).

## Why is there no account ID parameter in client mode?

Because your session token *is* your account. When you sign in, the Trade Server binds the
issued token to your trading account, and every tool call is made with that token — so the
server itself enforces the scope. An account parameter would add nothing except a way to ask
for accounts you cannot access anyway. See
[Client Mode → The scoping model](./CLIENT_MODE.md#the-scoping-model-your-token-is-your-account).

## Can one Claude session use both modes at the same time?

Yes. Register the MCP server **twice under different names** (for example `trade-admin` and
`trade-client`) in your MCP client's configuration, each entry with its own environment
variables. Each instance runs independently in its own mode, and your AI sees both tool sets
side by side. The same approach connects you to **different servers** — see the next question.

## Can I connect to more than one server (or broker) at once?

Yes. The MCP runs as one process per connection, so register it **once per server**, each under
its own name with its own `YB_BASE_URL` and credentials — two separate broker servers, a
production and a test server, or admin on one and client on another. The entries run
independently and their tools appear side by side; name them clearly (for example, one per
broker) and tell the AI which one you mean. Step-by-step with a ready-to-paste example:
[Configuration → Running more than one server](./CONFIGURATION.md#running-more-than-one-server).

## Why isn't this published on npm?

Deliberately. The May 2026 wave of npm supply-chain attacks made "install from the registry"
a real risk for software that holds trading credentials, so the server is distributed
straight from this GitHub repository instead: run it with npx (the `main` branch by default, or a
pinned tag/commit for a reproducible build — either way there is no registry account to hijack), or
clone and build from source.
The reasoning is laid out in [Security → Supply-chain stance](./SECURITY.md#supply-chain-stance).

## Which Trade Server version do I need?

For most things, any reasonably current build: the core client API — sign-in, trading,
positions, orders, account state, market data — works on older builds too, **as long as
`YB_BASE_URL` points at the client (public) API port**, which is a different port from the
admin API on the same server. (Pointing at the admin port is the most common reason sign-in
is rejected — not an old server.) Two tools are the exception: `get_balances` and
`get_limits` are specified in the API but not yet implemented in Trade Server releases at
the time of writing — the server closes the connection for those calls, while everything
else keeps working. They will work automatically once a release ships them. The practical
answer: ask your broker for the client API port, and about those two endpoints if you need
them. See
[Troubleshooting → Older Trade Server versions](./TROUBLESHOOTING.md#older-trade-server-versions-server-compatibility).

## What happens if my password changes while the MCP is running?

Usually nothing, at first: the running session uses the issued token pair, and background
refresh is signed with the current signing token — not your password. The old password is
only needed again when a full re-sign-in happens (for example after a server restart
invalidates the session, or if a refresh fails), and at that point sign-in fails with the
credentials hint. Update `YB_PASSWORD` in your MCP configuration and restart your MCP client.

## Does the MCP store my password anywhere?

No. The password is read from the `YB_PASSWORD` environment variable at startup, held in
memory, and used only as the **local HMAC signing secret** for the sign-in request — it is
never transmitted over the network, never logged, and never echoed into the conversation.
Nothing is ever persisted to disk; the guarantees are spelled out in
[Security](./SECURITY.md#credential-handling-guarantees).

## How do I place or close a trade?

In two steps — preview, then confirm. Anything that moves money (placing an order, closing a
position, a hedged close, closing everything) is split into a `*_plan` tool and a `*_commit`
tool. When you ask to trade, the AI calls the plan tool first: it validates the request and
shows you a plain-language summary, the live quote, and your free margin **without sending
anything to the market**, plus a single-use confirmation token that lasts five minutes. You
review it; once you confirm, the AI calls the commit tool with that token to actually place the
order. If your instruction was missing a detail (say, no order type), the plan step asks for
exactly what's needed. Nothing executes until you commit — there is no single-step trade path.

## Why did my market order not retry after a network error?

Because retrying could fill you twice. A dropped connection does not prove the server never
received the order — it may have been accepted just before the connection died — so
order-placing calls are never resent automatically. Check `get_working_orders`,
`get_open_positions`, and `get_order_history` to see what actually happened before placing
again. Requests where a duplicate is harmless (such as modifications and most reads) may be
retried once — see [Authentication → Timeouts and retries](./AUTHENTICATION.md#timeouts-and-retries)
for the exact rules.

## What is the difference between netting and hedging accounts?

On a **netting** account there is one position per symbol: an opposite order offsets the
existing position immediately. On a **hedging** account, buy and sell positions on the same
symbol can coexist. One tool cares about the difference — `close_by`, which pairs two
opposite positions against each other and therefore only works on hedging accounts; on a
netting account, use `close_position`. See
[Client Mode → Netting vs hedging accounts](./CLIENT_MODE.md#netting-vs-hedging-accounts).

## How many tools are there, and why do the two modes differ?

Admin mode exposes **42 tools and 4 resources**; client mode exposes **30 tools and
1 resource**. The difference is the scope each set of credentials should carry: admin mode
adds server-wide capabilities (other accounts, groups, routing rules, cash transfers,
liquidity connectors), while client mode is deliberately limited to what *you* can do with
your own account. Every tool is documented in the [Tools Reference](./TOOLS_REFERENCE.md).

## How do I get credentials — a login or an API token pair?

From your broker, in both cases. Traders normally already have a trading account number and
password (the same ones used in the broker's trading terminal), which work directly as
`YB_LOGIN` + `YB_PASSWORD`. Some brokers instead issue a public API **token pair** for API
access — if you have one, configure it as `YB_API_KEY` + `YB_SECRET_KEY` with
`YB_MODE=client`. Admin key pairs are issued only to broker administrators.

## Did admin mode change in this release?

No. Version 1.1.0 added client mode — the trader-scoped tool set with login/password and
token-pair sign-in — alongside the existing admin tools. Admin mode kept its tool set and its
static key-pair authentication; if you were using it before, your configuration keeps working
unchanged.

## Can I use this with MCP clients other than Claude?

Yes. The server speaks standard MCP over **stdio**, so any MCP-compatible client that can
launch a stdio server works: configure it to run
`npx -y github:yourbourse/trade-server-mcp` (or `node <path-to-repo>/dist/index.js`
if you cloned the repo) with the environment variables for your mode. See
[Configuration → Other MCP clients](./CONFIGURATION.md#other-mcp-clients).

## Where next

- [Getting Started](./GETTING_STARTED.md) — install and first connection
- [Client Mode](./CLIENT_MODE.md) — the trader's guide
- [Admin Mode](./ADMIN_MODE.md) — the broker administrator's guide
- [Troubleshooting](./TROUBLESHOOTING.md) — symptom-first fixes
