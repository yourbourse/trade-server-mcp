import { test } from "node:test";
import assert from "node:assert/strict";
import { mapWithConcurrency } from "../util/concurrency.js";

test("preserves input order regardless of completion order", async () => {
  const res = await mapWithConcurrency([30, 1, 15], 3, async (ms, i) => {
    await new Promise((r) => setTimeout(r, ms));
    return i;
  });
  assert.deepEqual(res, [0, 1, 2]);
});

test("never exceeds the concurrency limit", async () => {
  let active = 0;
  let maxActive = 0;
  const release: Array<() => void> = [];
  const gates = Array.from({ length: 20 }, () => new Promise<void>((r) => release.push(r)));
  const items = Array.from({ length: 20 }, (_, i) => i);
  const p = mapWithConcurrency(items, 5, async (i) => {
    active++;
    maxActive = Math.max(maxActive, active);
    await gates[i];
    active--;
    return i;
  });
  await new Promise((r) => setTimeout(r, 10)); // let workers ramp to the cap
  assert.equal(maxActive, 5, "should ramp to exactly the limit");
  release.forEach((r) => r());
  const res = await p;
  assert.deepEqual(res, items);
});

test("handles fewer items than the limit", async () => {
  const res = await mapWithConcurrency([1, 2], 10, async (n) => n * 2);
  assert.deepEqual(res, [2, 4]);
});

test("handles an empty array", async () => {
  const res = await mapWithConcurrency<number, number>([], 5, async (n) => n);
  assert.deepEqual(res, []);
});

test("limit of 1 runs one task at a time", async () => {
  let active = 0;
  let maxActive = 0;
  await mapWithConcurrency([1, 2, 3], 1, async (n) => {
    active++;
    maxActive = Math.max(maxActive, active);
    await new Promise((r) => setTimeout(r, 1));
    active--;
    return n;
  });
  assert.equal(maxActive, 1);
});
