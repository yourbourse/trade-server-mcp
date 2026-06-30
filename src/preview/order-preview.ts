// Builds the human-facing preview shown before a money-mover executes. The order echo is always
// produced; live quote + free-margin enrichment is best-effort and degrades gracefully (the data
// endpoints can blip server-side). Margin *requirement* is intentionally NOT computed — leverage /
// margin-rate is not exposed by the client API, so we show notional inputs the user can sanity-check
// (order details + quote + free margin) rather than a fabricated number.

import type { RestClient } from "../rest-client.js";

export type OrderSummary = {
  action: "place" | "close" | "close_all" | "close_by";
  accountId?: number; // admin mode only — names the target account in the echo
  symbol?: string;
  side?: string;
  quantity?: number;
  orderType?: string;
  timeInForce?: string;
  limitPrice?: number;
  stopPrice?: number;
  stopLoss?: number;
  takeProfit?: number;
  positionId?: number;
  positionById?: number;
  marginCheck?: boolean; // admin place_order only — surfaced when false (margin validation bypassed)
};

export type Preview = { summary: string; quote?: unknown; freeMargin?: number; note?: string };

function humanSummary(o: OrderSummary): string {
  let base: string;
  if (o.action === "close_all") {
    base = `Close ALL open positions${o.symbol ? ` for ${o.symbol}` : ""}`;
  } else if (o.action === "close_by") {
    base = `Close position ${o.positionId} against ${o.positionById} (hedged close)`;
  } else if (o.action === "close") {
    base = `Close position ${o.positionId}${o.quantity ? ` (${o.quantity} lots)` : " (full)"}`;
  } else {
    // Show every price the order carries. A StopLimit has BOTH a limit and a stop trigger, and
    // both are safety-relevant — hiding the stop would let a user confirm a preview that omits it.
    const pricePhrase =
      o.limitPrice !== undefined && o.stopPrice !== undefined
        ? `@ ${o.limitPrice} (stop ${o.stopPrice})`
        : o.limitPrice !== undefined
          ? `@ ${o.limitPrice}`
          : o.stopPrice !== undefined
            ? `stop @ ${o.stopPrice}`
            : o.orderType && o.orderType !== "Market"
              ? "(price required)" // never imply a market fill for a price-conditional order
              : "@ market";
    const parts = [
      `${(o.side ?? "").toUpperCase()} ${o.quantity} ${o.symbol}`,
      o.orderType,
      pricePhrase,
      o.timeInForce,
    ].filter(Boolean);
    const sltp = [o.stopLoss ? `SL ${o.stopLoss}` : "", o.takeProfit ? `TP ${o.takeProfit}` : ""]
      .filter(Boolean)
      .join(", ");
    base = `${parts.join(" ")}${sltp ? ` (${sltp})` : ""}`;
  }
  // Surface a bypassed margin check (admin place_order, marginCheck:false) so the confirmer sees a
  // safety-relevant flag in the very preview they approve. Default (true/omitted) stays uncluttered.
  const marginNote = o.marginCheck === false ? " [margin check OFF]" : "";
  return `${o.accountId ? `[account ${o.accountId}] ` : ""}${base}${marginNote}.`;
}

export async function buildOrderPreview(client: RestClient, o: OrderSummary): Promise<Preview> {
  const preview: Preview = { summary: humanSummary(o) };
  try {
    if (o.symbol) preview.quote = await client.get(`/quote/${encodeURIComponent(o.symbol)}`);
    // /account/state is signed over an EMPTY body — pass undefined (sends no HTTP body).
    const state = (await client.post("/account/state", undefined)) as { e?: number; m?: number };
    if (typeof state.e === "number" && typeof state.m === "number") {
      preview.freeMargin = state.e - state.m; // equity − used margin = free margin
    }
  } catch {
    preview.note =
      "Live market/account data was unavailable for this preview (server data endpoint blipped); the order details above are still exact.";
  }
  return preview;
}
