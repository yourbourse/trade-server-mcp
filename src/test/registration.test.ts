import { test } from "node:test";
import assert from "node:assert/strict";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ApiError, RestClient } from "../rest-client.js";
import { StaticCredentials } from "../auth/admin-auth.js";
import { registerClientTools, CLIENT_TOOL_COUNT } from "../register-client.js";
import { registerAdminTools } from "../register-admin.js";
import { WsClient } from "../ws-client.js";

test("client mode registers exactly 26 tools, none with accountId", () => {
  const server = new McpServer({ name: "t", version: "0" });
  const registered: string[] = [];
  const original = server.tool.bind(server);
  (server as any).tool = (name: string, ...rest: unknown[]) => {
    registered.push(name);
    const schema = rest[1] as Record<string, unknown> | undefined;
    if (schema && "accountId" in schema)
      throw new Error(`${name} leaked accountId into client mode`);
    return (original as any)(name, ...rest);
  };
  const client = new RestClient("http://ts", new StaticCredentials("K", "S"));
  registerClientTools(server, client);
  assert.equal(registered.length, CLIENT_TOOL_COUNT);
  assert.equal(CLIENT_TOOL_COUNT, 26);
  for (const required of [
    "place_order",
    "close_by",
    "get_limits",
    "get_balances",
    "health_check",
  ]) {
    assert.ok(registered.includes(required), `missing ${required}`);
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
    "The Trade Server rejected the sign-in request — check that YB_BASE_URL points to the CLIENT (public) API port: it is a different port from the admin API on the same server. If the port is right, the server version may predate the public client API; ask your broker.";
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
  assert.match(result.content[0].text, /CLIENT \(public\) API port/);
});

test("client mode: a 5xx tool error surfaces raw, WITHOUT the sign-in hint", async () => {
  const server = new McpServer({ name: "t", version: "0" });
  const handlers = new Map<
    string,
    (p: unknown) => Promise<{ content: { text: string }[]; isError?: boolean }>
  >();
  (server as any).tool = (name: string, _d: string, _s: unknown, handler: never) => {
    handlers.set(name, handler);
  };
  const hint = "SOME-SIGN-IN-HINT-MARKER check that YB_BASE_URL points to the CLIENT (public) API";
  const fakeAuth = { authFailureHint: () => hint } as never;
  const fakeClient = {
    get: async () => {
      throw new ApiError("GET", "/account/state", 502, "Bad Gateway");
    },
    post: async () => {
      throw new ApiError("POST", "/account/state", 502, "Bad Gateway");
    },
  } as never;
  registerClientTools(server, fakeClient, fakeAuth);

  const result = await handlers.get("get_account_state")!({});
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /Bad Gateway/);
  assert.doesNotMatch(result.content[0].text, /SOME-SIGN-IN-HINT-MARKER/);
});

test("client mode: a 401 tool error DOES carry the sign-in hint", async () => {
  const server = new McpServer({ name: "t", version: "0" });
  const handlers = new Map<
    string,
    (p: unknown) => Promise<{ content: { text: string }[]; isError?: boolean }>
  >();
  (server as any).tool = (name: string, _d: string, _s: unknown, handler: never) => {
    handlers.set(name, handler);
  };
  const hint = "SOME-SIGN-IN-HINT-MARKER check YB_LOGIN and YB_PASSWORD";
  const fakeAuth = { authFailureHint: () => hint } as never;
  const fakeClient = {
    get: async () => {
      throw new ApiError("GET", "/account/state", 401, "unauthorized");
    },
    post: async () => {
      throw new ApiError("POST", "/account/state", 401, "unauthorized");
    },
  } as never;
  registerClientTools(server, fakeClient, fakeAuth);

  const result = await handlers.get("get_account_state")!({});
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /SOME-SIGN-IN-HINT-MARKER/);
});

test("admin mode registers exactly 38 tools and 4 resources", () => {
  const server = new McpServer({ name: "t", version: "0" });
  let toolCount = 0;
  let resourceCount = 0;
  const originalTool = server.tool.bind(server);
  const originalResource = server.resource.bind(server);
  (server as any).tool = (...args: unknown[]) => {
    toolCount++;
    return (originalTool as any)(...args);
  };
  (server as any).resource = (...args: unknown[]) => {
    resourceCount++;
    return (originalResource as any)(...args);
  };
  const client = new RestClient("http://ts", new StaticCredentials("K", "S"));
  // Real WsClient with dummy config — never connected, so no socket is opened.
  const ws = new WsClient({ apiKey: "k", secretKey: "s", baseUrl: "http://127.0.0.1:9" });
  registerAdminTools(server, client, ws);
  assert.equal(toolCount, 38);
  assert.equal(resourceCount, 4);
});
