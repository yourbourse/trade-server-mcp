// Actionable parameter-completeness messages for the preview/commit flow. When a user gives an
// incomplete instruction (e.g. "buy EURUSD" with no order type), the *_plan tool returns exactly
// what is missing — with valid options — and echoes what was already provided, instead of guessing
// or surfacing a raw schema error.

export type FieldSpec = { name: string; label: string; options?: string[] };

export function missingFields(params: Record<string, unknown>, specs: FieldSpec[]): FieldSpec[] {
  return specs.filter((s) => params[s.name] === undefined || params[s.name] === null);
}

/** Returns a "needs X, Y" message, or null when every required field is present. */
export function completenessMessage(
  toolLabel: string,
  params: Record<string, unknown>,
  specs: FieldSpec[],
): string | null {
  const missing = missingFields(params, specs);
  if (missing.length === 0) return null;
  const need = missing
    .map((s) => (s.options ? `${s.label} (${s.options.join(" / ")})` : s.label))
    .join(", ");
  const got = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null)
    .map(([k, v]) => `${k}=${v}`)
    .join(", ");
  return `${toolLabel} needs: ${need}.${got ? ` Got: ${got}.` : ""}`;
}

/**
 * Order-type-conditional price completeness. A Limit/StopLimit order needs a `limitPrice`; a
 * Stop/StopLimit order needs a `stopPrice`. Returns a "needs X" message when a required price is
 * missing, or null when complete. Run AFTER the base completeness check (so orderType is known) —
 * without this, a price-conditional order with no price would preview as "@ market" and still issue
 * a commit token for an under-specified order.
 */
export function orderPriceCompleteness(
  toolLabel: string,
  params: { orderType?: unknown; limitPrice?: unknown; stopPrice?: unknown },
): string | null {
  const ot = params.orderType;
  const missing: string[] = [];
  if ((ot === "Limit" || ot === "StopLimit") && params.limitPrice == null)
    missing.push("limitPrice");
  if ((ot === "Stop" || ot === "StopLimit") && params.stopPrice == null) missing.push("stopPrice");
  if (missing.length === 0) return null;
  return `${toolLabel} needs ${missing.join(" and ")} for a ${String(ot)} order.`;
}
