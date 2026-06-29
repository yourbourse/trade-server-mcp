/** Max symbols accepted by get_quotes (client + admin) — caps fan-out (Issue #8). */
export const QUOTES_MAX_SYMBOLS = 50;

/** Max concurrent upstream quote lookups per get_quotes call (Issue #8). */
export const QUOTES_CONCURRENCY = 8;
