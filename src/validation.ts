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
