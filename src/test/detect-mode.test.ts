import { test } from "node:test";
import assert from "node:assert/strict";
import { detectManager } from "../auth/detect-mode.js";

test("a 200 from getManager means manager (admin role)", async () => {
  const calls: string[] = [];
  const client = {
    get: async (p: string) => {
      calls.push(p);
      return { accountId: 1, viewGroups: true };
    },
  };
  assert.equal(await detectManager(client, 1), true);
  assert.deepEqual(calls, ["/admin/managers/get/1"]);
});

test("any error from getManager means not a manager (client role)", async () => {
  const client = {
    get: async () => {
      throw new Error("GET /admin/managers/get/100 failed [NOT_FOUND]: no route");
    },
  };
  assert.equal(await detectManager(client, 100), false);
});

test("a network/timeout error also resolves to client (fail-closed), never throws", async () => {
  const client = {
    get: async () => {
      const e = new Error("request timed out after 10000ms");
      e.name = "TimeoutError";
      throw e;
    },
  };
  assert.equal(await detectManager(client, 7), false);
});

test("a 401 resolves to client WITHOUT invoking any handleUnauthorized re-auth", async () => {
  // The bootstrap probes through a facade provider that deliberately lacks
  // handleUnauthorized; this guards the same contract at the detectManager level.
  let reauths = 0;
  const client = {
    get: async () => {
      const e = new Error("GET /admin/managers/get/9 failed [UNAUTHORIZED]: nope") as Error & {
        statusCode: number;
      };
      e.statusCode = 401;
      throw e;
    },
    handleUnauthorized: async () => {
      reauths += 1;
      return true;
    },
  };
  assert.equal(await detectManager(client, 9), false);
  assert.equal(reauths, 0);
});
