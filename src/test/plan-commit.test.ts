import { test } from "node:test";
import assert from "node:assert/strict";
import { issuePlan, takeCommit, PLAN_TTL_MS } from "../preview/plan-commit.js";

test("issuePlan returns a token and takeCommit returns the same order once", () => {
  const order = { s: "EURUSD", q: 0.1 };
  const token = issuePlan(order);
  assert.equal(typeof token, "string");
  assert.ok(token.length > 0);
  assert.deepEqual(takeCommit(token), order);
});

test("takeCommit is single-use", () => {
  const token = issuePlan({ a: 1 });
  takeCommit(token);
  assert.throws(() => takeCommit(token), /No pending order/);
});

test("takeCommit rejects an unknown token", () => {
  assert.throws(() => takeCommit("nope"), /No pending order/);
});

test("takeCommit rejects an expired token (TTL elapsed)", () => {
  const token = issuePlan({ a: 1 }, () => 0); // issued at t=0
  assert.throws(() => takeCommit(token, () => PLAN_TTL_MS + 1), /No pending order/);
});

test("a wrong token error lists the live pending token so the model can self-correct (DA fix #2)", () => {
  const good = issuePlan({ a: 1 });
  try {
    assert.throws(() => takeCommit("typo-token"), new RegExp(good));
  } finally {
    takeCommit(good); // consume so the shared store is clean for other tests
  }
});
