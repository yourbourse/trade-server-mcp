// Shared request-filter helpers for admin queries.
//
// Several admin endpoints (statements, margin-call accounts, transfers, …) scope their results
// with a `TradingAccountFilter`, which the API models as a one-of: a list of account IDs, a list
// of group IDs, or a list of group masks. Exposing that union raw would be awkward for an AI, so
// the tools take three optional friendly arrays and this builder picks the matching wire shape.

import { z } from "zod";

export const accountFilterSchema = {
  accounts: z.array(z.number()).optional().describe("Filter by trading account IDs (logins)"),
  groups: z.array(z.number()).optional().describe("Filter by group IDs (from get_groups)"),
  groupMasks: z
    .array(z.string())
    .optional()
    .describe("Filter by group name masks, e.g. ['Real/*']"),
};

export type AccountFilterParams = {
  accounts?: number[];
  groups?: number[];
  groupMasks?: string[];
};

/**
 * Build the wire `TradingAccountFilter`. Exactly one of the three lists is used, in the order
 * accounts → groups → groupMasks; returns undefined when none was supplied (endpoints where the
 * filter is optional then simply omit it).
 */
export function buildAccountFilter(p: AccountFilterParams): Record<string, unknown> | undefined {
  if (p.accounts?.length) return { accounts: p.accounts };
  if (p.groups?.length) return { groups: p.groups };
  if (p.groupMasks?.length) return { groupMasks: p.groupMasks };
  return undefined;
}
