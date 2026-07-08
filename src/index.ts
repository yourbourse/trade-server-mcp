#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { parseConfig } from "./config.js";
import { StaticCredentials, CredentialsProvider } from "./auth/admin-auth.js";
import { ClientAuth } from "./auth/client-auth.js";
import { detectManager } from "./auth/detect-mode.js";
import { RestClient } from "./rest-client.js";
import { WsClient } from "./ws-client.js";
import { registerAdminTools } from "./register-admin.js";
import { registerClientTools } from "./register-client.js";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// Report the real release version to MCP hosts by reading it from package.json (no manual drift).
const { version } = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "package.json"), "utf8"),
) as { version: string };

// The startup role probe must never stack the full (user-configurable) request timeout on
// top of sign-in — the MCP handshake only starts after registration, and a slow probe
// would make the whole server look dead to the host.
const PROBE_TIMEOUT_MS = 5_000;

async function main() {
  const config = parseConfig(process.env);
  const server = new McpServer({ name: "trade-server", version });

  const onShutdown: Array<() => void> = [() => process.exit(0)];
  const cleanup = () => onShutdown.forEach((fn) => fn());
  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);

  const registerAdmin = (provider: CredentialsProvider, managerAccount?: () => number | null) => {
    const restClient = new RestClient(config.baseUrl, provider, config.requestTimeoutMs);
    const wsClient = new WsClient(config.baseUrl, provider, undefined, config.requestTimeoutMs);
    onShutdown.unshift(() => wsClient.disconnect());
    registerAdminTools(server, restClient, wsClient, managerAccount);
  };
  const registerClient = (provider: CredentialsProvider, auth?: ClientAuth) => {
    const restClient = new RestClient(config.baseUrl, provider, config.requestTimeoutMs);
    registerClientTools(server, restClient, auth);
  };
  // Login-style sign-in shared by client, admin-login and auto modes. Registration
  // proceeds even when sign-in fails: every tool call then carries the targeted hint
  // and retries the sign-in (same recovery contract as the original client mode).
  const signIn = async (opts: { login: number; password: string; broker?: string }) => {
    const auth = new ClientAuth(config.baseUrl, opts);
    onShutdown.unshift(() => auth.stop());
    try {
      await auth.authorize();
      return { auth, ok: true as const };
    } catch {
      return { auth, ok: false as const };
    }
  };

  if (config.mode === "admin") {
    if (config.auth.style === "keys") {
      registerAdmin(new StaticCredentials(config.auth.apiKey, config.auth.secretKey));
      console.error("Trade Server MCP: admin mode (server-wide tools)");
    } else {
      const { auth, ok } = await signIn(config.auth);
      registerAdmin(auth, () => auth.account);
      console.error(
        ok
          ? `Trade Server MCP: admin mode, signed in as manager account ${config.auth.login}`
          : `Trade Server MCP: admin mode — sign-in FAILED. ${auth.authFailureHint()} Tools are registered; calls will retry sign-in.`,
      );
    }
  } else if (config.mode === "auto") {
    const { auth, ok } = await signIn(config.auth);
    if (!ok) {
      // Cannot detect a role without a session — fail closed to the narrower client
      // tool set. The role is only detected at startup, so a manager must restart
      // after fixing their credentials.
      registerClient(auth, auth);
      console.error(
        `Trade Server MCP: auto-detect — sign-in FAILED → client mode. ${auth.authFailureHint()} Tools are registered; calls will retry sign-in. If this account is a manager, fix the credentials and restart — the role is detected only at startup.`,
      );
    } else {
      // Probe through a facade WITHOUT handleUnauthorized: a 401 from the probe must
      // resolve to "trader", not trigger a spurious re-/authorize + retried GET
      // (RestClient.withAuthRetry gates on the presence of that hook).
      const probeClient = new RestClient(
        config.baseUrl,
        { getApiKey: () => auth.getApiKey(), getSigningSecret: () => auth.getSigningSecret() },
        Math.min(config.requestTimeoutMs, PROBE_TIMEOUT_MS),
      );
      const isManager = await detectManager(probeClient, auth.account ?? config.auth.login);
      if (isManager) {
        registerAdmin(auth, () => auth.account);
        console.error(
          `Trade Server MCP: auto-detected manager account ${config.auth.login} — admin mode (server-wide tools)`,
        );
      } else {
        registerClient(auth, auth);
        console.error(
          `Trade Server MCP: auto-detected trader account ${config.auth.login} — client mode`,
        );
      }
    }
  } else if (config.auth.style === "login") {
    const { auth, ok } = await signIn(config.auth);
    registerClient(auth, auth);
    console.error(
      ok
        ? `Trade Server MCP: client mode, signed in as account ${config.auth.login}`
        : `Trade Server MCP: client mode — sign-in FAILED. ${auth.authFailureHint()} Tools are registered; calls will retry sign-in.`,
    );
  } else {
    // Token mode needs no cleanup handler: no timers or sockets to tear down.
    registerClient(new StaticCredentials(config.auth.apiKey, config.auth.secretKey));
    console.error("Trade Server MCP: client mode (public API token)");
  }

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Trade Server MCP running on stdio");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
