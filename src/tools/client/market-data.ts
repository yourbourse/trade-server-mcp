import { z } from "zod";
import { RestClient } from "../../rest-client.js";

export const getQuoteSchema = z.object({
  symbol: z.string().describe("Symbol name, e.g. EURUSD"),
});

export async function getQuote(client: RestClient, params: z.infer<typeof getQuoteSchema>) {
  return client.get(`/quote/${encodeURIComponent(params.symbol)}`);
}

export const getQuotesSchema = z.object({
  symbols: z.array(z.string()).min(1).describe("Array of symbol names, e.g. ['EURUSD', 'GBPUSD']"),
});

export async function getQuotes(client: RestClient, params: z.infer<typeof getQuotesSchema>) {
  return Promise.all(
    params.symbols.map(async (symbol) => {
      try {
        const quote = await client.get(`/quote/${encodeURIComponent(symbol)}`);
        return { symbol, quote };
      } catch (e) {
        return { symbol, quote: null, error: e instanceof Error ? e.message : String(e) };
      }
    }),
  );
}

export const getMarketDepthSchema = z.object({
  symbol: z.string().describe("Symbol name, e.g. EURUSD"),
  priceLevel: z.number().optional().describe("Number of price levels (default 10)"),
});

export async function getMarketDepth(
  client: RestClient,
  params: z.infer<typeof getMarketDepthSchema>,
) {
  return client.get(`/depth/${encodeURIComponent(params.symbol)}?depth=${params.priceLevel ?? 10}`);
}

export const getSymbolsSchema = z.object({
  filter: z.string().optional().describe("Symbol name filter pattern (e.g. EUR*)"),
});

export async function getSymbols(client: RestClient, params: z.infer<typeof getSymbolsSchema>) {
  const resp = await client.get<{ symbols: Array<{ n?: string; name?: string }> }>(
    "/symbols/query",
  );
  const symbols = resp.symbols || [];
  if (params.filter) {
    const pattern = params.filter
      .replace(/[.+^${}()|[\]\\]/g, "\\$&")
      .replace(/\*/g, ".*")
      .replace(/\?/g, ".");
    const regex = new RegExp(`^${pattern}$`, "i");
    // The server returns the symbol name in `n` (tolerate `name` too for safety).
    return symbols.filter((s) => regex.test(s.n ?? s.name ?? ""));
  }
  return symbols;
}

export const getSymbolDetailsSchema = z.object({
  symbolName: z.string().describe("Symbol name, e.g. EURUSD (client API looks up by name, not ID)"),
});

export async function getSymbolDetails(
  client: RestClient,
  params: z.infer<typeof getSymbolDetailsSchema>,
) {
  return client.get(`/symbols/get/${encodeURIComponent(params.symbolName)}`);
}

export const getCandlesSchema = z.object({
  symbolName: z.string().describe("Symbol name, e.g. EURUSD"),
  interval: z
    .enum(["1M", "5M", "15M", "30M", "1H", "4H", "D", "W", "M"])
    .describe("Candle interval"),
  from: z.number().optional().describe("Start time (microseconds since epoch)"),
  to: z.number().optional().describe("End time (microseconds since epoch)"),
  maxResults: z.number().optional().describe("Max candles to return (1-1000)"),
});

export async function getCandles(client: RestClient, params: z.infer<typeof getCandlesSchema>) {
  const body: Record<string, unknown> = {
    symbolName: params.symbolName,
    interval: params.interval,
  };
  if (params.from !== undefined) body.from = params.from;
  if (params.to !== undefined) body.to = params.to;
  if (params.maxResults !== undefined) body.maxResults = params.maxResults;
  return client.post("/charts", body);
}

export const getConversionRateSchema = z.object({
  from: z.string().describe("Source currency code, e.g. EUR"),
  to: z.string().describe("Target currency code, e.g. USD"),
});

export async function getConversionRate(
  client: RestClient,
  params: z.infer<typeof getConversionRateSchema>,
) {
  return client.post("/conversion-rate/single", { from: params.from, to: params.to });
}

export const healthCheckSchema = z.object({});

export async function healthCheck(client: RestClient) {
  return client.get("/now");
}
