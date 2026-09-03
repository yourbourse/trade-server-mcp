// Cursor pagination for the admin query endpoints.
//
// Every admin collection endpoint is cursor-paginated: the response carries `nextToken` when more
// rows exist, and the next page is requested with that token. Two details are easy to get wrong and
// were verified live against a dev Trade Server:
//
//   * the token goes in the QUERY STRING — for POST endpoints too. A `nextToken` in a POST body is
//     silently ignored and the SAME page comes back forever (an easy accidental infinite loop);
//   * `maxResults` goes the other way round: query string for GET, body for POST.
//
// Reading only the first page makes a tool report success on a partial view — `close_all_positions`
// answering "closed 12, no positions left" with the rest of the book still open — so every tool that
// acts on, counts, or selects from a collection walks all the pages.
//
// Not every collection paginates (symbols and groups return everything and never send a token);
// walking them simply ends after one page.

import { RestClient } from "../../rest-client.js";

type Rec = Record<string, unknown>;

/** Rows per page. Large enough that ordinary books are one request, small enough to stay sane. */
export const PAGE_SIZE = 1000;

/** Refuse to walk forever: PAGE_SIZE * MAX_PAGES is far beyond any legitimate admin collection. */
export const MAX_PAGES = 100;

export interface PageSpec {
  /** Collection path, e.g. "/admin/positions/query". */
  path: string;
  method: "GET" | "POST";
  /** Body for POST queries (filters); `maxResults` is added to it. */
  body?: Rec;
  /** Key holding the array in the response, e.g. "positions". */
  collectionKey: string;
  pageSize?: number;
}

/**
 * Read every page of a collection.
 *
 * Throws rather than returning a partial collection when the walk cannot be completed: callers use
 * this to close books and select records for deletion, where a silently short list is the bug this
 * helper exists to prevent.
 */
export async function queryAllPages<T extends Rec = Rec>(
  client: RestClient,
  spec: PageSpec,
): Promise<T[]> {
  const pageSize = spec.pageSize ?? PAGE_SIZE;
  const rows: T[] = [];
  const seenTokens = new Set<string>();
  let token: string | undefined;

  for (let page = 0; page < MAX_PAGES; page++) {
    const params = new URLSearchParams();
    if (token !== undefined) params.set("nextToken", token);
    if (spec.method === "GET") params.set("maxResults", String(pageSize));
    const qs = params.toString();
    const url = qs ? `${spec.path}?${qs}` : spec.path;

    const res =
      spec.method === "GET"
        ? await client.get<Rec>(url)
        : await client.post<Rec>(url, { ...(spec.body ?? {}), maxResults: pageSize });

    const collection = res?.[spec.collectionKey];
    const batch = Array.isArray(collection) ? (collection as T[]) : [];
    rows.push(...batch);

    const next = res?.nextToken;
    // A token can come back on the last page too, so an empty page also ends the walk.
    if (typeof next !== "string" || next === "" || batch.length === 0) return rows;
    if (seenTokens.has(next)) {
      throw new Error(
        `Paging ${spec.path} did not advance: the server returned the same nextToken twice after ` +
          `${rows.length} row(s). Refusing to continue with a partial collection.`,
      );
    }
    seenTokens.add(next);
    token = next;
  }

  throw new Error(
    `Paging ${spec.path} exceeded ${MAX_PAGES} pages (${rows.length} rows read). Refusing to act ` +
      `on a partial collection — narrow the query (account, symbol or time range) and retry.`,
  );
}
