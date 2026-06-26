import { test } from "node:test";
import assert from "node:assert/strict";
import * as am from "../tools/admin/market-data.js";

test("admin getQuotesSchema rejects more than 50 symbols", () => {
  const tooMany = Array.from({ length: 51 }, (_, i) => `S${i}`);
  assert.throws(() => am.getQuotesSchema.parse({ symbols: tooMany }));
});

test("admin getQuotes preserves order and processes all symbols", async () => {
  const fakeWs: any = {
    isConnected: true,
    connect: async () => {},
    getSnapshot: async (_channel: string, params: { s: string }) => [
      { d: [{ s: params.s, bid: 1 }] },
    ],
  };
  const res = (await am.getQuotes(fakeWs, { symbols: ["EURUSD", "GBPUSD", "USDJPY"] })) as Array<{
    symbol: string;
  }>;
  assert.deepEqual(
    res.map((r) => r.symbol),
    ["EURUSD", "GBPUSD", "USDJPY"],
  );
});
