#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { parseConfig } from "./config.js";
import { StaticCredentials } from "./auth/admin-auth.js";
import { ClientAuth } from "./auth/client-auth.js";
import { RestClient } from "./rest-client.js";
import { WsClient } from "./ws-client.js";
import { registerAdminTools } from "./register-admin.js";
import { registerClientTools } from "./register-client.js";

async function main() {
  const config = parseConfig(process.env);
  const server = new McpServer({ name: "trade-server", version: "2.0.0" });

  if (config.mode === "admin") {
    const restClient = new RestClient(
      config.baseUrl,
      new StaticCredentials(config.apiKey, config.secretKey),
      config.requestTimeoutMs,
    );
    const wsClient = new WsClient({
      apiKey: config.apiKey,
      secretKey: config.secretKey,
      baseUrl: config.baseUrl,
    });
    const cleanup = () => {
      wsClient.disconnect();
      process.exit(0);
    };
    process.on("SIGINT", cleanup);
    process.on("SIGTERM", cleanup);
    registerAdminTools(server, restClient, wsClient);
    console.error("Trade Server MCP: admin mode (server-wide tools)");
  } else {
    let provider;
    let clientAuth: ClientAuth | undefined;
    if (config.auth.style === "login") {
      const auth = new ClientAuth(config.baseUrl, config.auth);
      provider = auth;
      clientAuth = auth;
      try {
        await auth.authorize();
        console.error(`Trade Server MCP: client mode, signed in as account ${config.auth.login}`);
      } catch {
        // Register tools anyway: each call surfaces the auth error with a targeted hint.
        const hint = auth.authFailureHint();
        console.error(
          `Trade Server MCP: client mode — sign-in FAILED. ${hint} Tools are registered; calls will retry sign-in.`,
        );
      }
      const cleanup = () => {
        auth.stop();
        process.exit(0);
      };
      process.on("SIGINT", cleanup);
      process.on("SIGTERM", cleanup);
    } else {
      // Token mode needs no cleanup handler: no timers or sockets to tear down.
      provider = new StaticCredentials(config.auth.apiKey, config.auth.secretKey);
      console.error("Trade Server MCP: client mode (public API token)");
    }
    const restClient = new RestClient(config.baseUrl, provider, config.requestTimeoutMs);
    registerClientTools(server, restClient, clientAuth);
  }

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Trade Server MCP running on stdio");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
