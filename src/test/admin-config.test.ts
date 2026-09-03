import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { RestClient } from "../rest-client.js";
import { StaticCredentials } from "../auth/admin-auth.js";
import * as cfg from "../tools/admin/config.js";

let captured: { url: string; method: string; body?: string; headers: Record<string, string> }[] =
  [];
let respond: (url: string, method: string) => unknown;

beforeEach(() => {
  captured = [];
  respond = () => ({});
  globalThis.fetch = (async (url: any, init: any) => {
    captured.push({
      url: String(url),
      method: init?.method ?? "GET",
      body: init?.body,
      headers: (init?.headers ?? {}) as Record<string, string>,
    });
    // GETs return an ETag ("1" = the resource version) so the plan can capture it, exactly like
    // the real /admin/symbols/get/{id} endpoint.
    const headers = (init?.method ?? "GET") === "GET" ? { ETag: '"1"' } : undefined;
    return new Response(JSON.stringify(respond(String(url), init?.method ?? "GET")), {
      status: 200,
      headers,
    });
  }) as any;
});

const client = () => new RestClient("http://ts", new StaticCredentials("K", "S"));

const SP500 = {
  id: 70,
  version: 1,
  name: "SP500",
  bidMarkup: 0,
  quoteSessions: [
    { weekDay: "Mon", start: "01:05:00", end: "23:50:00" },
    { weekDay: "Fri", start: "01:05:00", end: "23:50:00" },
  ],
  tradeSessions: [
    { weekDay: "Sun", start: "00:00:00", end: "01:00:00" },
    { weekDay: "Mon", start: "01:05:00", end: "23:50:00" },
    { weekDay: "Fri", start: "01:05:00", end: "23:50:00" },
  ],
};
const MON_FRI = [
  { weekDay: "Mon" as const, start: "01:05:00", end: "23:50:00" },
  { weekDay: "Fri" as const, start: "01:05:00", end: "23:50:00" },
];

test("update_symbol_plan reads /admin/symbols/get/{id} and returns a diff + commitToken", async () => {
  respond = () => SP500;
  const plan = (await cfg.updateSymbolPlan(client(), {
    symbolId: 70,
    tradeSessions: MON_FRI,
  })) as { commitToken?: string; changes?: Record<string, { from: unknown; to: unknown }> };

  assert.equal(captured[0].url, "http://ts/api/v1/admin/symbols/get/70");
  assert.equal(captured[0].method, "GET");

  assert.ok(plan.commitToken, "expected a commitToken");
  assert.deepEqual(Object.keys(plan.changes ?? {}), ["tradeSessions"]);
  assert.deepEqual((plan.changes as any).tradeSessions.to, MON_FRI);
  assert.equal((plan.changes as any).tradeSessions.from.length, 3);
});

test("update_symbol_commit POSTs the full merged object to /admin/symbols/edit with If-Match", async () => {
  respond = () => SP500;
  const plan = (await cfg.updateSymbolPlan(client(), {
    symbolId: 70,
    tradeSessions: MON_FRI,
  })) as { commitToken: string };

  captured = []; // isolate the commit's network call
  respond = () => ({ ok: true });
  await cfg.updateSymbolCommit(client(), { commitToken: plan.commitToken });

  assert.equal(captured.length, 1);
  assert.equal(captured[0].url, "http://ts/api/v1/admin/symbols/edit");
  assert.equal(captured[0].method, "POST");
  // ETag captured by the plan is sent as If-Match for optimistic concurrency
  assert.equal(captured[0].headers["If-Match"], '"1"');

  // full object goes back: id/version/name/other fields preserved, only tradeSessions replaced
  const sent = JSON.parse(captured[0].body!);
  assert.deepEqual(sent, { ...SP500, tradeSessions: MON_FRI });
  assert.equal(sent.version, 1);
});

test("update_symbol_plan reports noChanges when values already match", async () => {
  respond = () => SP500;
  const plan = (await cfg.updateSymbolPlan(client(), {
    symbolId: 70,
    updates: { bidMarkup: 0 }, // same as current
  })) as { noChanges?: boolean; commitToken?: string };
  assert.equal(plan.noChanges, true);
  assert.equal(plan.commitToken, undefined);
});

test("update_symbol_commit rejects an unknown/used token (no silent write)", async () => {
  await assert.rejects(
    () => cfg.updateSymbolCommit(client(), { commitToken: "plan_does-not-exist" }),
    /No pending order for that token/,
  );
  assert.equal(captured.length, 0);
});

const GROUP = { id: 2, version: 1, name: "Real/Valter-USD", defaultLeverage: 100, marginCall: 0 };

test("update_group_plan reads /admin/groups/get/{id}, update_group_commit edits with If-Match", async () => {
  respond = () => GROUP;
  const plan = (await cfg.updateGroupPlan(client(), {
    groupId: 2,
    updates: { defaultLeverage: 200 },
  })) as { commitToken: string; changes: Record<string, { from: unknown; to: unknown }> };

  assert.equal(captured[0].url, "http://ts/api/v1/admin/groups/get/2");
  assert.deepEqual(Object.keys(plan.changes), ["defaultLeverage"]);
  assert.deepEqual(plan.changes.defaultLeverage, { from: 100, to: 200 });

  captured = [];
  respond = () => ({ ok: true });
  await cfg.updateGroupCommit(client(), { commitToken: plan.commitToken });

  assert.equal(captured[0].url, "http://ts/api/v1/admin/groups/edit");
  assert.equal(captured[0].method, "POST");
  assert.equal(captured[0].headers["If-Match"], '"1"');
  assert.deepEqual(JSON.parse(captured[0].body!), { ...GROUP, defaultLeverage: 200 });
});

test("delete_group_plan previews the target; delete_group_commit posts {groupId,version} with If-Match", async () => {
  respond = () => GROUP;
  const plan = (await cfg.deleteGroupPlan(client(), { groupId: 2 })) as unknown as {
    commitToken: string;
    willDelete: { groupId: number; name: string; version: number };
  };
  assert.deepEqual(plan.willDelete, { groupId: 2, name: "Real/Valter-USD", version: 1 });

  captured = [];
  respond = () => ({ ok: true });
  await cfg.deleteGroupCommit(client(), { commitToken: plan.commitToken });

  assert.equal(captured[0].url, "http://ts/api/v1/admin/groups/delete");
  assert.equal(captured[0].method, "POST");
  assert.equal(captured[0].headers["If-Match"], '"1"');
  assert.deepEqual(JSON.parse(captured[0].body!), { groupId: 2, version: 1 });
});

// Generic resource CRUD (accounts / clients / liquidity connectors / symbol delete), all backed
// by the shared read-modify-write + If-Match helper.
type Fn = (c: RestClient, p: any) => Promise<unknown>;

const EDITS: Array<{
  plan: Fn;
  commit: Fn;
  args: any;
  get: string;
  edit: string;
  obj: Record<string, unknown>;
  key: string;
  to: unknown;
}> = [
  {
    plan: cfg.updateAccountPlan,
    commit: cfg.updateAccountCommit,
    args: { accountId: 2, updates: { leverage: 200 } },
    get: "http://ts/api/v1/admin/accounts/get/2",
    edit: "http://ts/api/v1/admin/accounts/edit",
    obj: { id: 2, version: 1, leverage: 100 },
    key: "leverage",
    to: 200,
  },
  {
    plan: cfg.updateClientPlan,
    commit: cfg.updateClientCommit,
    args: { clientId: 3, updates: { clientStatus: "Active" } },
    get: "http://ts/api/v1/admin/clients/get/3",
    edit: "http://ts/api/v1/admin/clients/edit",
    obj: { id: 3, version: 1, clientStatus: "Registered" },
    key: "clientStatus",
    to: "Active",
  },
  {
    plan: cfg.updateLiquidityConnectorPlan,
    commit: cfg.updateLiquidityConnectorCommit,
    args: { connectorId: 9, updates: { isEnabled: false } },
    get: "http://ts/api/v1/admin/liquidity/get/9",
    edit: "http://ts/api/v1/admin/liquidity/edit",
    obj: { id: 9, version: 1, isEnabled: true },
    key: "isEnabled",
    to: false,
  },
  {
    plan: cfg.updateHolidayPlan,
    commit: cfg.updateHolidayCommit,
    args: { holidayId: 5, updates: { enabled: false } },
    get: "http://ts/api/v1/admin/holidays/get/5",
    edit: "http://ts/api/v1/admin/holidays/edit",
    obj: { id: 5, version: 1, description: "New Year", enabled: true },
    key: "enabled",
    to: false,
  },
  {
    plan: cfg.updateManagerPlan,
    commit: cfg.updateManagerCommit,
    args: { accountId: 2, updates: { configureSymbols: true } },
    get: "http://ts/api/v1/admin/managers/get/2",
    edit: "http://ts/api/v1/admin/managers/edit",
    obj: { accountId: 2, version: 1, configureSymbols: false },
    key: "configureSymbols",
    to: true,
  },
];

for (const e of EDITS) {
  test(`generic edit maps to ${e.edit} with If-Match + merged body`, async () => {
    respond = () => e.obj;
    const plan = (await e.plan(client(), e.args)) as {
      commitToken: string;
      changes: Record<string, { from: unknown; to: unknown }>;
    };
    assert.equal(captured[0].url, e.get);
    assert.deepEqual(plan.changes[e.key], { from: e.obj[e.key], to: e.to });

    captured = [];
    respond = () => ({ ok: true });
    await e.commit(client(), { commitToken: plan.commitToken });
    assert.equal(captured[0].url, e.edit);
    assert.equal(captured[0].method, "POST");
    assert.equal(captured[0].headers["If-Match"], '"1"');
    assert.deepEqual(JSON.parse(captured[0].body!), { ...e.obj, [e.key]: e.to });
  });
}

const DELETES: Array<{ plan: Fn; commit: Fn; args: any; get: string; del: string; body: unknown }> =
  [
    {
      plan: cfg.deleteAccountPlan,
      commit: cfg.deleteAccountCommit,
      args: { accountId: 2 },
      get: "http://ts/api/v1/admin/accounts/get/2",
      del: "http://ts/api/v1/admin/accounts/delete",
      body: { accountId: 2, version: 1 },
    },
    {
      plan: cfg.deleteClientPlan,
      commit: cfg.deleteClientCommit,
      args: { clientId: 3 },
      get: "http://ts/api/v1/admin/clients/get/3",
      del: "http://ts/api/v1/admin/clients/delete",
      body: { clientId: 3, version: 1 },
    },
    {
      plan: cfg.deleteLiquidityConnectorPlan,
      commit: cfg.deleteLiquidityConnectorCommit,
      args: { connectorId: 9 },
      get: "http://ts/api/v1/admin/liquidity/get/9",
      del: "http://ts/api/v1/admin/liquidity/delete",
      body: { connectorId: 9, version: 1 },
    },
    {
      plan: cfg.deleteSymbolPlan,
      commit: cfg.deleteSymbolCommit,
      args: { symbolId: 70 },
      get: "http://ts/api/v1/admin/symbols/get/70",
      del: "http://ts/api/v1/admin/symbols/delete",
      body: { symbolId: 70, version: 1 },
    },
    {
      plan: cfg.deleteHolidayPlan,
      commit: cfg.deleteHolidayCommit,
      args: { holidayId: 5 },
      get: "http://ts/api/v1/admin/holidays/get/5",
      del: "http://ts/api/v1/admin/holidays/delete",
      body: { holidayId: 5, version: 1 },
    },
    {
      plan: cfg.deleteManagerPlan,
      commit: cfg.deleteManagerCommit,
      args: { accountId: 2 },
      get: "http://ts/api/v1/admin/managers/get/2",
      del: "http://ts/api/v1/admin/managers/delete",
      body: { accountId: 2, version: 1 },
    },
  ];

for (const d of DELETES) {
  test(`generic delete maps to ${d.del} with {id,version} + If-Match`, async () => {
    respond = () => ({ id: 1, version: 1, name: "x" });
    const plan = (await d.plan(client(), d.args)) as { commitToken: string };
    assert.equal(captured[0].url, d.get);

    captured = [];
    respond = () => ({ ok: true });
    await d.commit(client(), { commitToken: plan.commitToken });
    assert.equal(captured[0].url, d.del);
    assert.equal(captured[0].method, "POST");
    assert.equal(captured[0].headers["If-Match"], '"1"');
    assert.deepEqual(JSON.parse(captured[0].body!), d.body);
  });
}

test("create clones a template, forces id/version 0, and posts to /edit with NO If-Match", async () => {
  respond = () => ({ id: 1, version: 3, name: "EURUSD", decimalPlaces: 5 });
  const plan = (await cfg.createSymbolPlan(client(), {
    fromId: 1,
    overrides: { name: "EURGBP" },
  })) as { commitToken: string; willCreate: Record<string, unknown> };
  assert.equal(captured[0].url, "http://ts/api/v1/admin/symbols/get/1"); // read template
  assert.equal(plan.willCreate.id, 0);
  assert.equal(plan.willCreate.version, 0);
  assert.equal(plan.willCreate.name, "EURGBP");
  assert.equal(plan.willCreate.decimalPlaces, 5); // template field carried over

  captured = [];
  respond = () => ({ id: 99 });
  await cfg.createSymbolCommit(client(), { commitToken: plan.commitToken });
  assert.equal(captured[0].url, "http://ts/api/v1/admin/symbols/edit");
  assert.equal(captured[0].method, "POST");
  assert.equal(captured[0].headers["If-Match"], undefined); // create carries no concurrency header
  const sent = JSON.parse(captured[0].body!);
  assert.equal(sent.id, 0);
  assert.equal(sent.version, 0);
  assert.equal(sent.name, "EURGBP");
});

test("create clears a stale ETag cached on the edit path (no leaked If-Match)", async () => {
  const c = client();
  c.setEtag("/admin/symbols/edit", '"7"'); // simulate an ETag left by a prior update commit
  respond = () => ({ ok: true });
  const plan = (await cfg.createSymbolPlan(c, { object: { name: "NEW" } })) as {
    commitToken: string;
  };
  captured = [];
  await cfg.createSymbolCommit(c, { commitToken: plan.commitToken });
  assert.equal(captured[0].url, "http://ts/api/v1/admin/symbols/edit");
  assert.equal(captured[0].headers["If-Match"], undefined); // stale ETag was cleared
});

test("edit strips server-managed timeCreated/timeModified from the write body (Invalid body fix)", async () => {
  respond = () => ({
    id: 5,
    version: 1,
    clientStatus: "Registered",
    timeCreated: 111,
    timeModified: 222,
  });
  const plan = (await cfg.updateClientPlan(client(), {
    clientId: 5,
    updates: { clientStatus: "Active" },
  })) as { commitToken: string };

  captured = [];
  respond = () => ({ ok: true });
  await cfg.updateClientCommit(client(), { commitToken: plan.commitToken });

  const sent = JSON.parse(captured[0].body!);
  assert.equal(sent.timeCreated, undefined);
  assert.equal(sent.timeModified, undefined);
  assert.equal(sent.clientStatus, "Active");
  assert.equal(sent.id, 5);
  assert.equal(sent.version, 1);
});

test("plan issues an unconditional GET — clears cached ETag so a re-read cannot 304", async () => {
  const c = client();
  c.setEtag("/admin/clients/get/5", '"9"');
  respond = () => ({ id: 5, version: 1, clientStatus: "Active" });
  await cfg.updateClientPlan(c, { clientId: 5, updates: { clientStatus: "Registered" } });
  assert.equal(captured[0].url, "http://ts/api/v1/admin/clients/get/5");
  assert.equal(captured[0].method, "GET");
  assert.equal(captured[0].headers["If-None-Match"], undefined);
});

test("POST-query reads send an empty-object body, not a body-less request (Invalid body fix)", async () => {
  respond = () => ({ holidays: [] });
  await cfg.getHolidays(client());
  assert.equal(captured[0].url, "http://ts/api/v1/admin/holidays/query");
  assert.equal(captured[0].method, "POST");
  assert.equal(captured[0].body, "{}");
});
