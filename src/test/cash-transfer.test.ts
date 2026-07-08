import { test } from "node:test";
import assert from "node:assert/strict";
import { cashTransferPlan, cashTransferCommit } from "../tools/admin/account.js";
import { issuePlan, takeCommit } from "../preview/plan-commit.js";
import type { RestClient } from "../rest-client.js";

// Minimal RestClient double that records the transfer call without hitting the network.
function fakeClient() {
  const calls: Array<{ path: string; body: unknown }> = [];
  const client = {
    post: async (path: string, body: unknown) => {
      calls.push({ path, body });
      return { ok: true };
    },
  } as unknown as RestClient;
  return { client, calls };
}

test("cash_transfer_plan asks for missing required fields instead of issuing a token", async () => {
  const { client, calls } = fakeClient();
  const res = (await cashTransferPlan(client, {})) as {
    needMoreInfo?: string;
    commitToken?: string;
  };
  assert.ok(res.needMoreInfo, "should report what's needed");
  assert.equal(res.commitToken, undefined, "no token until the transfer is fully specified");
  assert.equal(calls.length, 0, "plan must not execute anything");
});

test("cash_transfer_plan previews + issues a token; commit executes exactly one transfer", async () => {
  const { client, calls } = fakeClient();
  const plan = (await cashTransferPlan(client, {
    accountId: 100,
    amount: -50,
    type: "Balance",
  })) as { preview: unknown; commitToken: string; disclosure: string };
  assert.ok(plan.preview, "a preview is returned");
  assert.ok(plan.commitToken, "a token is issued for a complete transfer");
  assert.match(plan.disclosure, /irreversible|LIVE|real money/i);
  assert.equal(calls.length, 0, "plan must NOT execute the transfer");

  const result = await cashTransferCommit(client, { commitToken: plan.commitToken });
  assert.equal(calls.length, 1, "commit executes exactly one transfer");
  assert.equal(calls[0].path, "/admin/transfers/edit");
  assert.equal((calls[0].body as { A: number }).A, 100);
  assert.equal((calls[0].body as { a: number }).a, -50);
  assert.ok(result);
});

test("cash_transfer_commit rejects a token issued by another tool (no cross-tool cash move)", async () => {
  const { client, calls } = fakeClient();
  const foreign = issuePlan({ accountId: 100, amount: -50, type: "Balance" }, "place_order");
  await assert.rejects(
    () => cashTransferCommit(client, { commitToken: foreign }),
    /issued by place_order/,
  );
  assert.equal(calls.length, 0, "a foreign token must not move cash");
  takeCommit(foreign, "place_order"); // clean up the shared store
});

test("cash_transfer_plan preview currency matches what will execute (empty string → USD)", async () => {
  const { client } = fakeClient();
  // cashTransfer() defaults an empty/absent currency to USD (params.currency || "USD"); the preview
  // must agree, or it would show "" while the executed transfer uses USD.
  const plan = (await cashTransferPlan(client, {
    accountId: 100,
    amount: 10,
    type: "Balance",
    currency: "",
  })) as { preview: { currency: string }; commitToken: string };
  assert.equal(plan.preview.currency, "USD", "preview currency must match the executed default");
  takeCommit(plan.commitToken, "cash_transfer"); // consume so the shared store is left clean
});
