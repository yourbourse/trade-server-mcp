import { test } from "node:test";
import assert from "node:assert/strict";
import { completenessMessage, orderPriceCompleteness } from "../validation.js";

const specs = [
  { name: "orderType", label: "order type", options: ["Market", "Limit", "Stop"] },
  { name: "timeInForce", label: "time-in-force", options: ["IOC", "FOK", "GTC"] },
];

test("returns null when all required fields present", () => {
  assert.equal(
    completenessMessage("place_order", { orderType: "Market", timeInForce: "IOC" }, specs),
    null,
  );
});

test("lists exactly what's missing with options and echoes what was given", () => {
  const msg = completenessMessage("place_order", { orderType: "Market", side: "buy" }, specs)!;
  assert.match(msg, /time-in-force/);
  assert.match(msg, /IOC/);
  assert.doesNotMatch(msg, /order type/); // orderType was provided, so it must not be listed
});

test("orderPriceCompleteness: Limit requires limitPrice", () => {
  assert.match(orderPriceCompleteness("place_order_plan", { orderType: "Limit" })!, /limitPrice/);
});

test("orderPriceCompleteness: Stop requires stopPrice", () => {
  assert.match(orderPriceCompleteness("place_order_plan", { orderType: "Stop" })!, /stopPrice/);
});

test("orderPriceCompleteness: StopLimit requires both limitPrice and stopPrice", () => {
  const msg = orderPriceCompleteness("place_order_plan", { orderType: "StopLimit" })!;
  assert.match(msg, /limitPrice/);
  assert.match(msg, /stopPrice/);
});

test("orderPriceCompleteness: Market needs no price", () => {
  assert.equal(orderPriceCompleteness("place_order_plan", { orderType: "Market" }), null);
});

test("orderPriceCompleteness: Limit with a limitPrice is complete", () => {
  assert.equal(
    orderPriceCompleteness("place_order_plan", { orderType: "Limit", limitPrice: 1.1 }),
    null,
  );
});
