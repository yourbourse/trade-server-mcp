import { test } from "node:test";
import assert from "node:assert/strict";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { RestClient } from "../rest-client.js";
import { StaticCredentials } from "../auth/admin-auth.js";
import { registerClientTools, CLIENT_TOOL_COUNT } from "../register-client.js";
import { registerAdminTools } from "../register-admin.js";
import { WsClient } from "../ws-client.js";

test("client mode registers exactly CLIENT_TOOL_COUNT tools, none leaking accountId", () => {
  const server = new McpServer({ name: "t", version: "0" });
  const registered: string[] = [];
  const checkLeak = (name: string, schema: Record<string, unknown> | undefined) => {
    if (schema && "accountId" in schema)
      throw new Error(`${name} leaked accountId into client mode`);
  };
  // Intercept BOTH registration APIs: legacy tool(name, desc, schema, cb) and the new
  // registerTool(name, {inputSchema, ...}, cb) used by the plan/commit tools.
  const originalTool = server.tool.bind(server);
  (server as any).tool = (name: string, ...rest: unknown[]) => {
    registered.push(name);
    checkLeak(name, rest[1] as Record<string, unknown> | undefined);
    return (originalTool as any)(name, ...rest);
  };
  const originalRegister = server.registerTool.bind(server);
  (server as any).registerTool = (
    name: string,
    config: { inputSchema?: unknown },
    ...rest: unknown[]
  ) => {
    registered.push(name);
    checkLeak(name, config?.inputSchema as Record<string, unknown> | undefined);
    return (originalRegister as any)(name, config, ...rest);
  };
  const client = new RestClient("http://ts", new StaticCredentials("K", "S"));
  registerClientTools(server, client);
  assert.equal(registered.length, CLIENT_TOOL_COUNT);
  assert.equal(CLIENT_TOOL_COUNT, 30);
  for (const required of [
    "place_order_plan",
    "place_order_commit",
    "close_position_plan",
    "close_position_commit",
    "close_by_plan",
    "close_by_commit",
    "close_all_positions_plan",
    "close_all_positions_commit",
    "get_limits",
    "get_balances",
    "health_check",
  ]) {
    assert.ok(registered.includes(required), `missing ${required}`);
  }
  // every one-shot money-mover is replaced by a plan/commit pair (no un-gated execution path)
  for (const oneShot of ["place_order", "close_position", "close_by", "close_all_positions"]) {
    assert.ok(!registered.includes(oneShot), `one-shot ${oneShot} must be removed`);
  }
  for (const adminOnly of [
    "cash_transfer",
    "force_delete_order",
    "get_order_routing",
    "get_all_accounts",
  ]) {
    assert.ok(!registered.includes(adminOnly), `${adminOnly} must not register in client mode`);
  }
});

test("client mode: tool errors carry the sign-in hint even for connection-level failures", async () => {
  // Old servers may CLOSE the connection on client-API endpoints instead of
  // returning 401 (observed live on older server versions). The hint must still reach the tool result.
  const server = new McpServer({ name: "t", version: "0" });
  const handlers = new Map<
    string,
    (p: unknown) => Promise<{ content: { text: string }[]; isError?: boolean }>
  >();
  (server as any).tool = (name: string, _desc: string, _schema: unknown, handler: never) => {
    handlers.set(name, handler);
  };
  const hint =
    "Sign-in was rejected by the Trade Server (HTTP 400) — usually an invalid request parameter or wrong endpoint.";
  const fakeAuth = { authFailureHint: () => hint } as never;
  const fakeClient = {
    post: async () => {
      throw new Error("fetch failed", { cause: new Error("other side closed") });
    },
    get: async () => {
      throw new Error("fetch failed", { cause: new Error("other side closed") });
    },
  } as never;
  registerClientTools(server, fakeClient, fakeAuth);

  const result = await handlers.get("get_account_state")!({});
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /fetch failed/);
  assert.match(result.content[0].text, /Sign-in was rejected by the Trade Server/);
});

test("admin mode registers exactly 43 tools and 4 resources", () => {
  const server = new McpServer({ name: "t", version: "0" });
  const names: string[] = [];
  let resourceCount = 0;
  const originalTool = server.tool.bind(server);
  const originalRegister = server.registerTool.bind(server);
  const originalResource = server.resource.bind(server);
  // Count BOTH registration APIs: legacy tool() and the registerTool() used by plan/commit tools.
  (server as any).tool = (name: string, ...rest: unknown[]) => {
    names.push(name);
    return (originalTool as any)(name, ...rest);
  };
  (server as any).registerTool = (name: string, ...rest: unknown[]) => {
    names.push(name);
    return (originalRegister as any)(name, ...rest);
  };
  (server as any).resource = (...args: unknown[]) => {
    resourceCount++;
    return (originalResource as any)(...args);
  };
  const client = new RestClient("http://ts", new StaticCredentials("K", "S"));
  // Real WsClient with dummy credentials — never connected, so no socket is opened.
  const ws = new WsClient("http://127.0.0.1:9", new StaticCredentials("k", "s"));
  registerAdminTools(server, client, ws);
  assert.equal(names.length, 43);
  assert.equal(resourceCount, 4);
  // cash_transfer is a money-mover: it must be gated as plan/commit, not a one-shot.
  assert.ok(names.includes("cash_transfer_plan"), "cash_transfer_plan must be registered");
  assert.ok(names.includes("cash_transfer_commit"), "cash_transfer_commit must be registered");
  assert.ok(
    !names.includes("cash_transfer"),
    "the un-gated cash_transfer one-shot must be removed",
  );
});

test("client health_check echoes mode and signed-in account", async () => {
  const server = new McpServer({ name: "t", version: "0" });
  const handlers = new Map<
    string,
    (p: unknown) => Promise<{ content: { text: string }[]; isError?: boolean }>
  >();
  (server as any).tool = (name: string, _desc: string, _schema: unknown, handler: never) => {
    handlers.set(name, handler);
  };
  const fakeClient = { get: async () => ({ now: 1 }) } as never;
  const fakeAuth = { account: 100, authFailureHint: () => null } as never;
  registerClientTools(server, fakeClient, fakeAuth);
  const body = JSON.parse((await handlers.get("health_check")!({})).content[0].text);
  assert.equal(body.mode, "client");
  assert.equal(body.account, 100);
});

test("admin health_check echoes admin mode and the manager account", async () => {
  const server = new McpServer({ name: "t", version: "0" });
  const handlers = new Map<
    string,
    (p: unknown) => Promise<{ content: { text: string }[]; isError?: boolean }>
  >();
  (server as any).tool = (name: string, _desc: string, _schema: unknown, handler: never) => {
    handlers.set(name, handler);
  };
  const fakeClient = { get: async () => ({ now: 1 }) } as never;
  const ws = new WsClient("http://127.0.0.1:9", new StaticCredentials("k", "s"));
  registerAdminTools(server, fakeClient, ws, () => 1);
  const body = JSON.parse((await handlers.get("health_check")!({})).content[0].text);
  assert.equal(body.mode, "admin");
  assert.equal(body.account, 1);
});
