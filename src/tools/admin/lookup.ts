// Single-record lookup with a query fallback.
//
// The admin API documents `GET /admin/<res>/get/{id}` for positions, trades and transfers, but
// some server builds do not serve those routes (observed live: every id, including a nonexistent
// one, answers 502 — while the same records come back fine from `/admin/<res>/query`). Reading a
// record is the first step of the position/trade maintenance plans, so a tool that only knew the
// get-by-id route would be unusable on those servers.
//
// So: try the documented route first (cheap, exact) and fall back to the collection query when the
// server does not serve it. The fallback discriminates by status — a 404 means the record is not
// there, and a 401/403 means the request was refused; neither is a reason to go look somewhere
// else, and swallowing them would turn a permissions problem into a confusing "not found".
//
// Whichever path answers, a record that does not belong to the account the caller named is never
// returned: the account only narrows the fallback query server-side, and the maintenance plans then
// write to `A: current.A` — the record's real owner. Without this check, `accountId` reads like a
// lock on the target while doing nothing, and a correction can land on a stranger's position.

import { ApiError, RestClient } from "../../rest-client.js";
import { queryAllPages } from "./paging.js";

type Rec = Record<string, unknown>;

/** Statuses that mean "this build does not serve get-by-id" rather than "no such record". */
const ROUTE_NOT_SERVED = [405, 501, 502, 503];

export interface LookupSpec {
  /** Human label used in the not-found message, e.g. "position". */
  label: string;
  /** Documented single-record path, e.g. `/admin/positions/get/123`. */
  getPath: string;
  /** Collection endpoint used as the fallback, e.g. `/admin/positions/query`. */
  queryPath: string;
  /** Body for the fallback query (narrow it with the account when the caller supplied one). */
  queryBody: Rec;
  /** Key holding the array in the query response, e.g. "positions". */
  collectionKey: string;
  /** When the caller named an owning account, the record must belong to it. */
  accountId?: number;
}

/** Reject a record that belongs to someone else, whichever path produced it. */
function assertOwned(record: Rec, spec: LookupSpec, id: number): Rec {
  if (spec.accountId === undefined) return record;
  const owner = record.A;
  if (owner === undefined || owner === null) {
    throw new Error(
      `Cannot verify that ${spec.label} ${id} belongs to account ${spec.accountId}: the record ` +
        `came back without an account field. Refusing to use it.`,
    );
  }
  if (Number(owner) !== Number(spec.accountId)) {
    throw new Error(
      `${spec.label[0].toUpperCase()}${spec.label.slice(1)} ${id} belongs to account ${owner}, ` +
        `not ${spec.accountId}. Re-run with the owning account if that is the record you meant.`,
    );
  }
  return record;
}

export async function fetchRecord(client: RestClient, spec: LookupSpec, id: number): Promise<Rec> {
  try {
    return assertOwned(await client.get<Rec>(spec.getPath), spec, id);
  } catch (e) {
    // Only a server that cannot serve the route sends us to the collection query. A 404 is a real
    // answer, and anything else (401/403/400/…) is a real failure — surface both as they are.
    if (!(e instanceof ApiError)) throw e;
    if (!ROUTE_NOT_SERVED.includes(e.statusCode)) {
      if (e.statusCode !== 404) throw e;
      throw new Error(`No ${spec.label} with id ${id} exists (${spec.getPath} returned 404).`);
    }
  }

  const list = await queryAllPages(client, {
    path: spec.queryPath,
    method: "POST",
    body: spec.queryBody,
    collectionKey: spec.collectionKey,
  });
  const found = list.find((r) => Number(r.id) === Number(id));
  if (found) return assertOwned(found, spec, id);

  throw new Error(
    `No ${spec.label} with id ${id} was found. The server did not serve ${spec.getPath}, and it ` +
      `is not in the ${spec.collectionKey} returned by ${spec.queryPath}` +
      (spec.accountId === undefined
        ? " — pass accountId to narrow the search."
        : ` for account ${spec.accountId}.`),
  );
}
