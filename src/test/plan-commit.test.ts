import { test } from "node:test";
import assert from "node:assert/strict";
import { issuePlan, takeCommit, PLAN_TTL_MS } from "../preview/plan-commit.js";

test("issuePlan returns a token and takeCommit returns the same order once", () => {
  const order = { s: "EURUSD", q: 0.1 };
  const token = issuePlan(order, "place_order");
  assert.equal(typeof token, "string");
  assert.ok(token.length > 0);
  assert.deepEqual(takeCommit(token, "place_order"), order);
});

test("takeCommit is single-use", () => {
  const token = issuePlan({ a: 1 }, "place_order");
  takeCommit(token, "place_order");
  assert.throws(() => takeCommit(token, "place_order"), /No pending order/);
});

test("takeCommit rejects an unknown token", () => {
  assert.throws(() => takeCommit("nope", "place_order"), /No pending order/);
});

test("takeCommit rejects an expired token (TTL elapsed)", () => {
  const token = issuePlan({ a: 1 }, "place_order", () => 0); // issued at t=0
  assert.throws(() => takeCommit(token, "place_order", () => PLAN_TTL_MS + 1), /No pending order/);
});

test("takeCommit rejects a token issued by a different tool (no cross-tool commit)", () => {
  // A place_order preview must NOT be committable as close_all_positions: closeAllPositionsSchema
  // has zero required fields, so without a tool check Zod would silently accept the place_order
  // payload and close every position — defeating confirm-before-execute.
  const token = issuePlan({ symbol: "EURUSD", side: "buy", quantity: 1 }, "place_order");
  assert.throws(() => takeCommit(token, "close_all_positions"), /issued by place_order/);
  // Rejected without consuming: the correct commit tool can still use the token.
  assert.deepEqual(takeCommit(token, "place_order"), {
    symbol: "EURUSD",
    side: "buy",
    quantity: 1,
  });
});

test("a wrong token error lists the live pending token so the model can self-correct (DA fix #2)", () => {
  const good = issuePlan({ a: 1 }, "place_order");
  try {
    assert.throws(() => takeCommit("typo-token", "place_order"), new RegExp(good));
  } finally {
    takeCommit(good, "place_order"); // consume so the shared store is clean for other tests
  }
});

test("issuePlan tokens are unguessable, not a sequential counter (Copilot #1)", () => {
  const t1 = issuePlan({ a: 1 }, "place_order");
  const t2 = issuePlan({ a: 2 }, "place_order");
  try {
    // The commitToken is the confirm-before-execute safety boundary, so it must not be a
    // predictable plan_<seq>_<ts> value — it is now backed by a cryptographically-random UUID.
    assert.doesNotMatch(t1, /^plan_\d+_/);
    assert.match(t1, /^plan_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    assert.notEqual(t1, t2);
  } finally {
    takeCommit(t1, "place_order");
    takeCommit(t2, "place_order");
  }
});
