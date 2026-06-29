import { test } from "node:test";
import assert from "node:assert/strict";
import { completenessMessage } from "../validation.js";

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
