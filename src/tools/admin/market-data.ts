import { z } from "zod";
import { RestClient } from "../../rest-client.js";
import { WsClient } from "../../ws-client.js";
import * as ti from "technicalindicators";
import { mapWithConcurrency } from "../../util/concurrency.js";
import { QUOTES_MAX_SYMBOLS, QUOTES_CONCURRENCY } from "../../constants.js";
import { issuePlan, takeCommit } from "../../preview/plan-commit.js";

export const getQuoteSchema = z.object({
  symbol: z.string().describe("Symbol name, e.g. EURUSD"),
  groupId: z.number().optional().describe("Group ID (default 1)"),
});

export async function getQuote(wsClient: WsClient, params: z.infer<typeof getQuoteSchema>) {
  if (!wsClient.isConnected) {
    await wsClient.connect();
  }

  const data = await wsClient.getSnapshot(
    "L1",
    {
      s: params.symbol,
      g: params.groupId ?? 1,
      streaming: true,
    },
    { timeoutMs: 3000 },
  );

  // Extract quote data from updates
  const quotes: unknown[] = [];
  for (const msg of data) {
    const m = msg as { d?: unknown[] };
    if (m.d) quotes.push(...m.d);
  }
  return quotes.length > 0 ? quotes : data;
}

export const getMarketDepthSchema = z.object({
  symbol: z.string().describe("Symbol name, e.g. EURUSD"),
  groupId: z.number().optional().describe("Group ID (default 1)"),
  priceLevel: z.number().optional().describe("Number of price levels (default 10)"),
});

export async function getMarketDepth(
  wsClient: WsClient,
  params: z.infer<typeof getMarketDepthSchema>,
) {
  if (!wsClient.isConnected) {
    await wsClient.connect();
  }

  const data = await wsClient.getSnapshot(
    "L2",
    {
      s: params.symbol,
      g: params.groupId ?? 1,
      d: params.priceLevel ?? 10,
      streaming: true,
    },
    { timeoutMs: 3000 },
  );

  // Extract book data from updates
  const books: unknown[] = [];
  for (const msg of data) {
    const m = msg as { d?: unknown[] };
    if (m.d) books.push(...m.d);
  }
  return books.length > 0 ? books : data;
}

export const getSymbolsSchema = z.object({
  filter: z.string().optional().describe("Symbol name filter pattern (e.g. EUR*)"),
});

export async function getSymbols(client: RestClient, params: z.infer<typeof getSymbolsSchema>) {
  const resp = await client.get<{ symbols: Array<{ name?: string }> }>("/admin/symbols/query");
  const symbols = resp.symbols || [];
  if (params.filter) {
    const pattern = params.filter
      .replace(/[.+^${}()|[\]\\]/g, "\\$&")
      .replace(/\*/g, ".*")
      .replace(/\?/g, ".");
    const regex = new RegExp(`^${pattern}$`, "i");
    return symbols.filter((s) => regex.test(s.name || ""));
  }
  return symbols;
}

export const getCandlesSchema = z.object({
  symbolId: z.number().optional().describe("Symbol ID (use this or symbolName+groupId)"),
  symbolName: z.string().optional().describe("Symbol name (requires groupId)"),
  groupId: z.number().optional().describe("Group ID (required with symbolName)"),
  interval: z
    .enum(["1M", "5M", "15M", "30M", "1H", "4H", "D", "W", "M"])
    .describe("Candle interval"),
  from: z.number().optional().describe("Start time (microseconds since epoch)"),
  to: z.number().optional().describe("End time (microseconds since epoch)"),
  maxResults: z.number().optional().describe("Max candles to return (1-1000, default 1000)"),
});

export async function getCandles(client: RestClient, params: z.infer<typeof getCandlesSchema>) {
  const symbolSelector =
    params.symbolId !== undefined
      ? { symbolId: params.symbolId }
      : { symbolName: params.symbolName, groupId: params.groupId };

  const body: Record<string, unknown> = {
    symbolSelector,
    interval: params.interval,
  };
  if (params.from !== undefined) body.from = params.from;
  if (params.to !== undefined) body.to = params.to;
  if (params.maxResults !== undefined) body.maxResults = params.maxResults;

  return client.post("/admin/charts/get", body);
}

// === CONVERSION ===

export const getConversionRateSchema = z.object({
  groupId: z.number().describe("Group ID for conversion context"),
  from: z.string().describe("Source currency code, e.g. EUR"),
  to: z.string().describe("Target currency code, e.g. USD"),
});

export async function getConversionRate(
  client: RestClient,
  params: z.infer<typeof getConversionRateSchema>,
) {
  return client.post("/admin/conversion-rate/single", {
    groupId: params.groupId,
    from: params.from,
    to: params.to,
  });
}

// === MULTI-SYMBOL QUOTES ===

export const getQuotesSchema = z.object({
  symbols: z
    .array(z.string())
    .min(1)
    .max(QUOTES_MAX_SYMBOLS)
    .describe(`Array of symbol names, e.g. ['EURUSD', 'GBPUSD'] (max ${QUOTES_MAX_SYMBOLS})`),
  groupId: z.number().optional().describe("Group ID (default 1)"),
});

export async function getQuotes(wsClient: WsClient, params: z.infer<typeof getQuotesSchema>) {
  if (!wsClient.isConnected) {
    await wsClient.connect();
  }

  const groupId = params.groupId ?? 1;

  // Subscribe to symbols with bounded concurrency (caps fan-out — Issue #8)
  const results = await mapWithConcurrency(params.symbols, QUOTES_CONCURRENCY, async (symbol) => {
    try {
      const data = await wsClient.getSnapshot(
        "L1",
        {
          s: symbol,
          g: groupId,
          streaming: true,
        },
        { timeoutMs: 3000 },
      );

      // Extract quote data
      const quotes: unknown[] = [];
      for (const msg of data) {
        const m = msg as { d?: unknown[] };
        if (m.d) quotes.push(...m.d);
      }
      return { symbol, quote: quotes.length > 0 ? quotes[quotes.length - 1] : null };
    } catch (e) {
      return { symbol, quote: null, error: e instanceof Error ? e.message : String(e) };
    }
  });

  return results;
}

// === TECHNICAL INDICATORS ===

export const getIndicatorSchema = z.object({
  symbolName: z.string().describe("Symbol name, e.g. EURUSD"),
  groupId: z.number().optional().describe("Group ID (default 1)"),
  interval: z
    .enum(["1M", "5M", "15M", "30M", "1H", "4H", "D", "W", "M"])
    .describe("Candle interval: 1M, 5M, 15M, 30M, 1H, 4H, D, W, M"),
  indicator: z
    .enum([
      "RSI",
      "MACD",
      "EMA",
      "SMA",
      "BollingerBands",
      "ATR",
      "Stochastic",
      "ADX",
      "VWAP",
      "CCI",
    ])
    .describe("Indicator name"),
  period: z.number().optional().describe("Lookback period (default 14)"),
  candles: z.number().optional().describe("Number of candles to fetch (default 100, max 1000)"),
});

export async function getIndicator(client: RestClient, params: z.infer<typeof getIndicatorSchema>) {
  const period = params.period ?? 14;
  const maxCandles = Math.min(params.candles ?? 100, 1000);

  // Fetch candles
  const candleResult = (await client.post("/admin/charts/get", {
    symbolSelector: { symbolName: params.symbolName, groupId: params.groupId ?? 1 },
    interval: params.interval,
    maxResults: maxCandles,
  })) as { d?: Array<{ o: number; h: number; l: number; c: number; v?: number; t: number }> };

  const candles = candleResult.d ?? [];
  if (candles.length < period) {
    throw new Error(`Insufficient data: got ${candles.length} candles, need at least ${period}`);
  }

  const close = candles.map((c) => c.c);
  const high = candles.map((c) => c.h);
  const low = candles.map((c) => c.l);
  const _open = candles.map((c) => c.o);
  const volume = candles.map((c) => c.v ?? 0);

  let values: unknown;
  let meta: Record<string, unknown> = {
    indicator: params.indicator,
    period,
    candles: candles.length,
    interval: params.interval,
  };

  switch (params.indicator) {
    case "RSI":
      values = ti.rsi({ values: close, period });
      break;
    case "SMA":
      values = ti.sma({ values: close, period });
      break;
    case "EMA":
      values = ti.ema({ values: close, period });
      break;
    case "MACD": {
      const result = ti.macd({
        values: close,
        fastPeriod: 12,
        slowPeriod: 26,
        signalPeriod: 9,
        SimpleMAOscillator: false,
        SimpleMASignal: false,
      });
      values = result;
      meta = { ...meta, fastPeriod: 12, slowPeriod: 26, signalPeriod: 9 };
      break;
    }
    case "BollingerBands":
      values = ti.bollingerbands({ values: close, period, stdDev: 2 });
      meta = { ...meta, stdDev: 2 };
      break;
    case "ATR":
      values = ti.atr({ high, low, close, period });
      break;
    case "Stochastic":
      values = ti.stochastic({ high, low, close, period, signalPeriod: 3 });
      meta = { ...meta, signalPeriod: 3 };
      break;
    case "ADX":
      values = ti.adx({ high, low, close, period });
      break;
    case "VWAP":
      values = ti.vwap({ high, low, close, volume });
      break;
    case "CCI":
      values = ti.cci({ high, low, close, period });
      break;
  }

  // Return last N values (most recent) to avoid overwhelming output
  const arr = Array.isArray(values) ? values : [];
  const latest = arr.slice(-20);

  return {
    symbol: params.symbolName,
    ...meta,
    current: latest.length > 0 ? latest[latest.length - 1] : null,
    recent: latest,
  };
}

export const getConversionRatesBatchSchema = z.object({
  rates: z
    .array(
      z.object({
        groupId: z.number().describe("Group ID for conversion context"),
        from: z.string().describe("Source currency code, e.g. EUR"),
        to: z.string().describe("Target currency code, e.g. USD"),
      }),
    )
    .min(1)
    .describe("Conversions to resolve in one call"),
});

export async function getConversionRatesBatch(
  client: RestClient,
  params: z.infer<typeof getConversionRatesBatchSchema>,
) {
  // The endpoint takes a bare array (AdminConversionRatesBatchRequest), not an object wrapper.
  return client.post("/admin/conversion-rate/batch", params.rates);
}

// === CHART (CANDLE) MAINTENANCE (plan/commit) ===
//
// Rewrites stored bars, e.g. to erase a bad tick that left a spike in history. The wire body is
// terse: si (symbol id), i (interval), t (bar start, microseconds), o/h/l/c/v. There is no
// version/ETag concurrency here. The plan reads the existing bar (best effort) so the preview can
// show what is about to be overwritten, and both writes are gated behind confirm-before-execute.

const EDITABLE_INTERVALS = ["1M", "5M", "15M", "30M", "1H", "4H", "D"] as const;

async function readExistingCandle(
  client: RestClient,
  symbolId: number,
  interval: string,
  barTime: number,
): Promise<Record<string, unknown> | null> {
  try {
    const res = (await client.post("/admin/charts/get", {
      symbolSelector: { symbolId },
      interval,
      from: barTime,
      to: barTime + 1,
      maxResults: 1,
    })) as { d?: Array<Record<string, unknown>> };
    return res?.d?.find((bar) => Number(bar.t) === Number(barTime)) ?? null;
  } catch {
    return null; // preview degrades gracefully; the write itself is an upsert either way
  }
}

export const updateCandlePlanSchema = z.object({
  symbolId: z.number().describe("Symbol unique identifier (from get_symbols)"),
  interval: z.enum(EDITABLE_INTERVALS).describe("Candle interval that holds the bar"),
  barTime: z.number().describe("Bar START time (microseconds since epoch)"),
  open: z.number().describe("Open price"),
  high: z.number().describe("High price"),
  low: z.number().describe("Low price"),
  close: z.number().describe("Close price"),
  volume: z.number().describe("Volume"),
});

const UPDATE_CANDLE_DISCLOSURE =
  "You are confirming a LIVE rewrite of stored price history via an AI assistant. Charts, indicators and anything derived from this bar will change. Review the before/after, then call update_candle_commit with this commitToken. Nothing is written until you commit.";

export async function updateCandlePlan(
  client: RestClient,
  params: z.infer<typeof updateCandlePlanSchema>,
) {
  const existing = await readExistingCandle(
    client,
    params.symbolId,
    params.interval,
    params.barTime,
  );
  const body = {
    si: params.symbolId,
    i: params.interval,
    t: params.barTime,
    o: params.open,
    h: params.high,
    l: params.low,
    c: params.close,
    v: params.volume,
  };
  return {
    symbolId: params.symbolId,
    interval: params.interval,
    barTime: params.barTime,
    existingBar: existing ?? "(no stored bar at this time — this will add one)",
    newBar: {
      open: params.open,
      high: params.high,
      low: params.low,
      close: params.close,
      volume: params.volume,
    },
    commitToken: issuePlan(body, "update_candle"),
    disclosure: UPDATE_CANDLE_DISCLOSURE,
  };
}

export const updateCandleCommitSchema = z.object({
  commitToken: z.string().describe("The commitToken returned by update_candle_plan"),
});

export async function updateCandleCommit(
  client: RestClient,
  params: z.infer<typeof updateCandleCommitSchema>,
) {
  // No ETag contract on this endpoint — clear anything cached on the path so RestClient does
  // not attach a stray If-Match.
  client.setEtag("/admin/charts/edit", "");
  return client.post("/admin/charts/edit", takeCommit(params.commitToken, "update_candle"), {
    retryOnConnectionError: false,
  });
}

export const deleteCandlePlanSchema = z.object({
  symbolId: z.number().describe("Symbol unique identifier (from get_symbols)"),
  interval: z.enum(EDITABLE_INTERVALS).describe("Candle interval that holds the bar"),
  barTime: z.number().describe("Bar START time (microseconds since epoch)"),
});

const DELETE_CANDLE_DISCLOSURE =
  "You are confirming the LIVE DELETION of a stored price bar via an AI assistant. The gap will be visible in charts and in anything derived from history. Review the target, then call delete_candle_commit with this commitToken. Nothing is deleted until you commit.";

export async function deleteCandlePlan(
  client: RestClient,
  params: z.infer<typeof deleteCandlePlanSchema>,
) {
  const existing = await readExistingCandle(
    client,
    params.symbolId,
    params.interval,
    params.barTime,
  );
  return {
    willDelete: {
      symbolId: params.symbolId,
      interval: params.interval,
      barTime: params.barTime,
      storedBar: existing ?? "(no stored bar found at this time)",
    },
    commitToken: issuePlan(
      { si: params.symbolId, i: params.interval, t: params.barTime },
      "delete_candle",
    ),
    disclosure: DELETE_CANDLE_DISCLOSURE,
  };
}

export const deleteCandleCommitSchema = z.object({
  commitToken: z.string().describe("The commitToken returned by delete_candle_plan"),
});

export async function deleteCandleCommit(
  client: RestClient,
  params: z.infer<typeof deleteCandleCommitSchema>,
) {
  // No ETag contract on this endpoint — clear anything cached on the path so RestClient does
  // not attach a stray If-Match.
  client.setEtag("/admin/charts/delete", "");
  return client.post("/admin/charts/delete", takeCommit(params.commitToken, "delete_candle"), {
    retryOnConnectionError: false,
  });
}

// Bulk candle maintenance: one symbol + interval, many bars in a single call. The wire body groups
// the bars under the symbol (`{ si, i, d: [...] }`) rather than repeating it per bar, so this is a
// different shape from the generic config bulk tools.

export const bulkUpdateCandlesPlanSchema = z.object({
  symbolId: z.number().describe("Symbol unique identifier (from get_symbols)"),
  interval: z.enum(EDITABLE_INTERVALS).describe("Candle interval that holds the bars"),
  bars: z
    .array(
      z.object({
        barTime: z.number().describe("Bar START time (microseconds since epoch)"),
        open: z.number(),
        high: z.number(),
        low: z.number(),
        close: z.number(),
        volume: z.number(),
      }),
    )
    .min(1)
    .describe("Bars to write; existing bars at those times are overwritten"),
});

export async function bulkUpdateCandlesPlan(
  client: RestClient,
  params: z.infer<typeof bulkUpdateCandlesPlanSchema>,
) {
  const body = {
    si: params.symbolId,
    i: params.interval,
    d: params.bars.map((b) => ({
      t: b.barTime,
      o: b.open,
      h: b.high,
      l: b.low,
      c: b.close,
      v: b.volume,
    })),
  };
  const times = params.bars.map((b) => b.barTime).sort((a, b) => a - b);
  return {
    symbolId: params.symbolId,
    interval: params.interval,
    barCount: params.bars.length,
    timeRange: { firstBar: times[0], lastBar: times[times.length - 1] },
    commitToken: issuePlan(body, "bulk_update_candles"),
    disclosure: `You are confirming a LIVE rewrite of ${params.bars.length} stored price bar(s) via an AI assistant. Charts and anything derived from this history will change. Review the range, then call bulk_update_candles_commit with this commitToken. Nothing is written until you commit.`,
  };
}

export const bulkUpdateCandlesCommitSchema = z.object({
  commitToken: z.string().describe("The commitToken returned by bulk_update_candles_plan"),
});

export async function bulkUpdateCandlesCommit(
  client: RestClient,
  params: z.infer<typeof bulkUpdateCandlesCommitSchema>,
) {
  // No ETag contract on this endpoint — clear anything cached on the path so RestClient does
  // not attach a stray If-Match.
  client.setEtag("/admin/charts/batch/edit", "");
  return client.post(
    "/admin/charts/batch/edit",
    takeCommit(params.commitToken, "bulk_update_candles"),
    { retryOnConnectionError: false },
  );
}

export const bulkDeleteCandlesPlanSchema = z.object({
  symbolId: z.number().describe("Symbol unique identifier (from get_symbols)"),
  interval: z.enum(EDITABLE_INTERVALS).describe("Candle interval that holds the bars"),
  barTimes: z
    .array(z.number())
    .min(1)
    .describe("START times of the bars to delete (microseconds since epoch)"),
});

export async function bulkDeleteCandlesPlan(
  client: RestClient,
  params: z.infer<typeof bulkDeleteCandlesPlanSchema>,
) {
  const times = [...params.barTimes].sort((a, b) => a - b);
  return {
    willDelete: {
      symbolId: params.symbolId,
      interval: params.interval,
      barCount: times.length,
      timeRange: { firstBar: times[0], lastBar: times[times.length - 1] },
    },
    commitToken: issuePlan(
      { si: params.symbolId, i: params.interval, d: params.barTimes },
      "bulk_delete_candles",
    ),
    disclosure: `You are confirming the LIVE DELETION of ${times.length} stored price bar(s) via an AI assistant. The gaps will show in charts and in anything derived from history. Review the range, then call bulk_delete_candles_commit with this commitToken. Nothing is deleted until you commit.`,
  };
}

export const bulkDeleteCandlesCommitSchema = z.object({
  commitToken: z.string().describe("The commitToken returned by bulk_delete_candles_plan"),
});

export async function bulkDeleteCandlesCommit(
  client: RestClient,
  params: z.infer<typeof bulkDeleteCandlesCommitSchema>,
) {
  // No ETag contract on this endpoint — clear anything cached on the path so RestClient does
  // not attach a stray If-Match.
  client.setEtag("/admin/charts/batch/delete", "");
  return client.post(
    "/admin/charts/batch/delete",
    takeCommit(params.commitToken, "bulk_delete_candles"),
    { retryOnConnectionError: false },
  );
}
