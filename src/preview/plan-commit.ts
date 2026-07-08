// Single-use, short-TTL token store backing the preview/commit (confirm-before-execute) flow.
// `*_plan` tools call issuePlan() to stash a validated order and hand the user an opaque token;
// `*_commit` tools call takeCommit() to consume it exactly once and run the real execution fn.
//
// In-memory, single-process: the MCP runs one stdio process per user, so a module-level Map is
// safe for the single-user case. Revisit if a future transport ever multiplexes users in one
// process (tokens would then need per-session scoping).

import { randomUUID } from "node:crypto";

// 5 minutes: long enough for an unhurried human-in-the-loop confirm in a chat UI. (Spike learning:
// a 90s TTL expired during the confirm latency, forcing the model to silently re-plan. A market
// order's fill is at live market regardless, so a slightly older preview at commit is harmless.)
export const PLAN_TTL_MS = 300_000;

type Entry = { order: unknown; tool: string; expiresAt: number };

const store = new Map<string, Entry>();

/** Drop expired entries (DA fix #3: lazy sweep on each issue — no timer, no leak). */
function sweepExpired(now: number): void {
  for (const [token, entry] of store) {
    if (entry.expiresAt <= now) store.delete(token);
  }
}

/**
 * Stash an order, returning an opaque single-use token. `nowFn` is injectable for tests.
 *
 * The token is the confirm-before-execute safety boundary, so it is cryptographically random
 * (randomUUID) rather than a predictable counter+timestamp — an unguessable token cannot be
 * committed without first having seen the matching preview.
 *
 * `tool` binds the token to the action that issued it (e.g. "place_order"): takeCommit rejects a
 * token presented to a *different* commit tool, so a preview can never be committed as another
 * action (Zod would otherwise silently drop the extra fields and execute the wrong thing).
 */
export function issuePlan(order: unknown, tool: string, nowFn: () => number = Date.now): string {
  const now = nowFn();
  sweepExpired(now);
  const token = `plan_${randomUUID()}`;
  store.set(token, { order, tool, expiresAt: now + PLAN_TTL_MS });
  return token;
}

/**
 * Consume a token and return the stashed order. Single-use: the entry is deleted on entry, so a
 * failed/retried commit can never double-fill. Throws on missing/expired/used.
 *
 * DA fix #2: when the token does not resolve, the error lists the live pending token(s) so the
 * model can self-correct a mistyped/mis-relayed token — WITHOUT auto-accepting (the token stays
 * the explicit-confirm contract: the user confirmed that exact preview).
 */
export function takeCommit(
  token: string,
  expectedTool: string,
  nowFn: () => number = Date.now,
): unknown {
  const now = nowFn();
  sweepExpired(now);
  const entry = store.get(token);
  // Bind the token to the tool that issued it. A live token from a *different* *_plan must NOT be
  // committable here: schemas like closeAllPositionsSchema have zero required fields, so Zod would
  // silently accept another action's payload and execute the wrong thing (e.g. a place_order token
  // → close every position). Reject WITHOUT consuming so the correct *_commit can still use it.
  if (entry && entry.expiresAt > now && entry.tool !== expectedTool) {
    throw new Error(
      `This commitToken was issued by ${entry.tool}_plan, so it can only be committed with ` +
        `${entry.tool}_commit — not ${expectedTool}_commit. To ${expectedTool} instead, run ` +
        `${expectedTool}_plan first to get a matching token.`,
    );
  }
  // Consume atomically: a matching (or missing/expired) token cannot double-commit even on retry.
  // A wrong-tool mismatch already returned above WITHOUT reaching here, so its token survives.
  store.delete(token);
  if (entry && entry.expiresAt > now) return entry.order;

  const pending = [...store.keys()];
  const hint = pending.length
    ? ` Current pending token${pending.length > 1 ? "s" : ""}: ${pending.join(", ")}.`
    : "";
  throw new Error(`No pending order for that token — run the matching *_plan tool again.${hint}`);
}
