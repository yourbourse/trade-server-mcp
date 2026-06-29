/**
 * Map over `items` running at most `limit` async tasks concurrently, returning
 * results in the original input order. `limit` is clamped to at least 1.
 *
 * Note: if `fn` rejects, the returned promise rejects. Callers that need
 * per-item error capture (e.g. get_quotes) must catch inside `fn`.
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  const workers = Math.max(1, Math.min(limit, items.length));
  let next = 0;
  async function worker(): Promise<void> {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: workers }, () => worker()));
  return results;
}
