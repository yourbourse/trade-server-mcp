// Single-use, short-TTL token store backing the preview/commit (confirm-before-execute) flow.
// `*_plan` tools call issuePlan() to stash a validated order and hand the user an opaque token;
// `*_commit` tools call takeCommit() to consume it exactly once and run the real execution fn.
//
// In-memory, single-process: the MCP runs one stdio process per user, so a module-level Map is
// safe for the single-user case. Revisit if a future transport ever multiplexes users in one
// process (tokens would then need per-session scoping).

export const PLAN_TTL_MS = 90_000;

type Entry = { order: unknown; expiresAt: number };

const store = new Map<string, Entry>();
let seq = 0;

/** Drop expired entries (DA fix #3: lazy sweep on each issue — no timer, no leak). */
function sweepExpired(now: number): void {
  for (const [token, entry] of store) {
    if (entry.expiresAt <= now) store.delete(token);
  }
}

/** Stash an order, returning a short opaque single-use token. `nowFn` is injectable for tests. */
export function issuePlan(order: unknown, nowFn: () => number = Date.now): string {
  sweepExpired(nowFn());
  const token = `plan_${++seq}_${Math.floor(nowFn() % 1e6).toString(36)}`;
  store.set(token, { order, expiresAt: nowFn() + PLAN_TTL_MS });
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
export function takeCommit(token: string, nowFn: () => number = Date.now): unknown {
  sweepExpired(nowFn());
  const entry = store.get(token);
  store.delete(token); // consume atomically: cannot double-commit even if the caller retries
  if (entry && entry.expiresAt > nowFn()) return entry.order;

  const pending = [...store.keys()];
  const hint = pending.length
    ? ` Current pending token${pending.length > 1 ? "s" : ""}: ${pending.join(", ")}.`
    : "";
  throw new Error(
    `No pending order for that token — run the matching *_plan tool again.${hint}`,
  );
}
