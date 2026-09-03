import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { RestClient } from "../rest-client.js";
import { StaticCredentials } from "../auth/admin-auth.js";
import * as md from "../tools/admin/market-data.js";
import * as acct from "../tools/admin/account.js";

let captured: { url: string; method: string; body?: string; headers: Record<string, string> }[] =
  [];
let respond: (url: string) => unknown;

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
    const headers = (init?.method ?? "GET") === "GET" ? { ETag: '"4"' } : undefined;
    return new Response(JSON.stringify(respond(String(url))), { status: 200, headers });
  }) as any;
});

const client = () => new RestClient("http://ts", new StaticCredentials("K", "S"));
const last = () => captured[captured.length - 1];

const BAR = { t: 1786430000000000, o: 1.1, h: 1.2, l: 1.05, c: 1.15, v: 100 };

test("update_candle previews the stored bar and commits terse OHLCV wire keys", async () => {
  respond = () => ({ d: [BAR] });
  const plan = (await md.updateCandlePlan(client(), {
    symbolId: 1,
    interval: "1H",
    barTime: BAR.t,
    open: 1.1,
    high: 1.16,
    low: 1.05,
    close: 1.15,
    volume: 100,
  })) as { commitToken: string; existingBar: unknown };

  assert.equal(captured[0].url, "http://ts/api/v1/admin/charts/get"); // read-before-write preview
  assert.deepEqual(plan.existingBar, BAR);

  captured = [];
  await md.updateCandleCommit(client(), { commitToken: plan.commitToken });
  assert.equal(last().url, "http://ts/api/v1/admin/charts/edit");
  assert.deepEqual(JSON.parse(last().body!), {
    si: 1,
    i: "1H",
    t: BAR.t,
    o: 1.1,
    h: 1.16,
    l: 1.05,
    c: 1.15,
    v: 100,
  });
});

test("update_candle_plan still previews when no bar is stored yet", async () => {
  respond = () => ({ d: [] });
  const plan = (await md.updateCandlePlan(client(), {
    symbolId: 1,
    interval: "D",
    barTime: 5,
    open: 1,
    high: 2,
    low: 0.5,
    close: 1.5,
    volume: 7,
  })) as { existingBar: unknown; commitToken: string };
  assert.match(String(plan.existingBar), /no stored bar/);
  assert.ok(plan.commitToken);
});

test("delete_candle commits only the bar identity", async () => {
  respond = () => ({ d: [BAR] });
  const plan = (await md.deleteCandlePlan(client(), {
    symbolId: 1,
    interval: "1H",
    barTime: BAR.t,
  })) as { commitToken: string };
  captured = [];
  await md.deleteCandleCommit(client(), { commitToken: plan.commitToken });
  assert.equal(last().url, "http://ts/api/v1/admin/charts/delete");
  assert.deepEqual(JSON.parse(last().body!), { si: 1, i: "1H", t: BAR.t });
});

const ACCOUNT = {
  id: 1000,
  version: 4,
  groupId: 2,
  clientId: 2,
  leverage: 100,
  enabled: true,
  timeCreated: 111,
  timeModified: 222,
};

test("set_account_password never echoes the password and writes it via the account upsert", async () => {
  respond = () => ACCOUNT;
  const plan = (await acct.setAccountPasswordPlan(client(), {
    accountId: 1000,
    password: "SuperSecret123!",
  })) as Record<string, unknown>;

  // the secret must not leak into the preview the user sees
  assert.ok(!JSON.stringify(plan).includes("SuperSecret123!"));
  assert.equal(captured[0].url, "http://ts/api/v1/admin/accounts/get/1000");

  captured = [];
  respond = () => ({ ok: true });
  await acct.setAccountPasswordCommit(client(), {
    commitToken: plan.commitToken as string,
  });
  assert.equal(last().url, "http://ts/api/v1/admin/accounts/edit");
  assert.equal(last().headers["If-Match"], '"4"'); // account edits keep ETag concurrency
  const sent = JSON.parse(last().body!);
  assert.equal(sent.password, "SuperSecret123!"); // sent to the server, just never previewed
  assert.equal(sent.id, 1000);
  assert.equal(sent.timeCreated, undefined); // server-managed fields still stripped
});

test("change_my_password posts to /password and warns about the stored configuration", async () => {
  const plan = (await acct.changeMyPasswordPlan(client(), { password: "NewPw123!" })) as Record<
    string,
    unknown
  >;
  assert.ok(!JSON.stringify(plan).includes("NewPw123!"));
  assert.match(String(plan.warning), /YB_PASSWORD/);
  assert.equal(captured.length, 0); // planning touches no endpoint

  respond = () => ({});
  const res = (await acct.changeMyPasswordCommit(client(), {
    commitToken: plan.commitToken as string,
  })) as Record<string, unknown>;
  assert.equal(last().url, "http://ts/api/v1/password");
  assert.equal(last().method, "POST");
  assert.deepEqual(JSON.parse(last().body!), { password: "NewPw123!" });
  assert.match(String(res.reminder), /YB_PASSWORD/);
});

test("password tokens are bound to their own tool", async () => {
  const plan = (await acct.changeMyPasswordPlan(client(), { password: "x" })) as {
    commitToken: string;
  };
  await assert.rejects(
    () => acct.setAccountPasswordCommit(client(), { commitToken: plan.commitToken }),
    /change_my_password_plan/,
  );
});
