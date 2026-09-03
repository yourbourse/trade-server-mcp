// Bulk (batch) edits across a whole class of admin config records.
//
// The API exposes `/admin/<res>/batch/edit` and `/admin/<res>/batch/delete` for every config
// resource, taking an ARRAY of the same objects the single-record endpoints take — and, unlike the
// single-record writes, **no If-Match** (each object carries its own `version`).
//
// Rather than 14 near-identical tools, this is one parameterised pair per operation: the caller
// names the resource and selects records by id or by a name glob. The tools are still task-shaped
// ("change this field on every EUR* symbol"), which is the shape an AI actually needs; the per-
// resource knowledge lives in the spec table below.

import { z } from "zod";
import { RestClient } from "../../rest-client.js";
import { issuePlan, takeCommit } from "../../preview/plan-commit.js";
import {
  assertNoReservedFields,
  redactSecrets,
  sameValue,
  stripServerManaged,
} from "./resource-write.js";
import { queryAllPages } from "./paging.js";

type Rec = Record<string, unknown>;

export const BULK_RESOURCES = [
  "symbols",
  "groups",
  "accounts",
  "clients",
  "holidays",
  "managers",
  "liquidity",
] as const;

export type BulkResource = (typeof BULK_RESOURCES)[number];

interface BulkSpec {
  /** How to list every record of this kind. */
  queryPath: string;
  queryMethod: "GET" | "POST";
  /** Key holding the array in the query response. */
  collectionKey: string;
  /** Identity field ON THE RECORD (managers are keyed by accountId, everything else by id). */
  idField: string;
  /** Identity key expected in the DELETE body. */
  idKey: string;
  /** Human-readable field used for name-glob selection and previews, when the record has one. */
  nameField?: string;
  /** Fields the edit endpoint requires on every record; a source record missing one aborts the plan. */
  requiredFields?: string[];
  editPath: string;
  deletePath: string;
}

const SPECS: Record<BulkResource, BulkSpec> = {
  symbols: {
    queryPath: "/admin/symbols/query",
    queryMethod: "GET",
    collectionKey: "symbols",
    idField: "id",
    idKey: "symbolId",
    nameField: "name",
    editPath: "/admin/symbols/batch/edit",
    deletePath: "/admin/symbols/batch/delete",
  },
  groups: {
    queryPath: "/admin/groups/query",
    queryMethod: "GET",
    collectionKey: "groups",
    idField: "id",
    idKey: "groupId",
    nameField: "name",
    editPath: "/admin/groups/batch/edit",
    deletePath: "/admin/groups/batch/delete",
  },
  accounts: {
    queryPath: "/admin/accounts/query",
    queryMethod: "GET",
    collectionKey: "accounts",
    idField: "id",
    idKey: "accountId",
    editPath: "/admin/accounts/batch/edit",
    deletePath: "/admin/accounts/batch/delete",
  },
  clients: {
    queryPath: "/admin/clients/query",
    queryMethod: "GET",
    collectionKey: "clients",
    idField: "id",
    idKey: "clientId",
    editPath: "/admin/clients/batch/edit",
    deletePath: "/admin/clients/batch/delete",
  },
  holidays: {
    queryPath: "/admin/holidays/query",
    queryMethod: "POST",
    collectionKey: "holidays",
    idField: "id",
    idKey: "holidayId",
    nameField: "description",
    editPath: "/admin/holidays/batch/edit",
    deletePath: "/admin/holidays/batch/delete",
  },
  managers: {
    queryPath: "/admin/managers/query",
    queryMethod: "GET",
    collectionKey: "managers",
    idField: "accountId",
    idKey: "accountId",
    editPath: "/admin/managers/batch/edit",
    deletePath: "/admin/managers/batch/delete",
    // /admin/managers/edit rejects a record without `groups` as "Invalid body" (seen live), and
    // at least one manager read endpoint omits it — refuse to batch-post an incomplete record.
    requiredFields: ["groups"],
  },
  liquidity: {
    queryPath: "/admin/liquidity/query",
    queryMethod: "GET",
    collectionKey: "connectors",
    idField: "id",
    idKey: "connectorId",
    nameField: "type",
    editPath: "/admin/liquidity/batch/edit",
    deletePath: "/admin/liquidity/batch/delete",
  },
};

const globToRegExp = (pattern: string) =>
  new RegExp(
    `^${pattern
      .replace(/[.+^${}()|[\]\\]/g, "\\$&")
      .replace(/\*/g, ".*")
      .replace(/\?/g, ".")}$`,
    "i",
  );

/**
 * List every record of a resource, following the cursor to the end.
 *
 * Reading a single page would make the selection — and the exact count in the preview — quietly
 * describe only the first page of the resource.
 */
async function loadAll(client: RestClient, spec: BulkSpec): Promise<Rec[]> {
  return queryAllPages(client, {
    path: spec.queryPath,
    method: spec.queryMethod,
    body: {},
    collectionKey: spec.collectionKey,
  });
}

/** Resolve the selection: explicit ids, or a glob over the resource's name field. */
function select(
  spec: BulkSpec,
  resource: BulkResource,
  all: Rec[],
  ids?: number[],
  namePattern?: string,
): { matched: Rec[]; missingIds: number[] } {
  if (ids?.length) {
    const wanted = new Set(ids.map(Number));
    const matched = all.filter((r) => wanted.has(Number(r[spec.idField])));
    const found = new Set(matched.map((r) => Number(r[spec.idField])));
    return { matched, missingIds: ids.map(Number).filter((id) => !found.has(id)) };
  }
  if (namePattern) {
    if (!spec.nameField) {
      throw new Error(
        `${resource} records have no name to match on — select them with \`ids\` instead.`,
      );
    }
    const re = globToRegExp(namePattern);
    return {
      matched: all.filter((r) => re.test(String(r[spec.nameField as string] ?? ""))),
      missingIds: [],
    };
  }
  throw new Error("Select the records to change with either `ids` or `namePattern`.");
}

const label = (spec: BulkSpec, r: Rec) =>
  spec.nameField ? `${r[spec.nameField]} (${r[spec.idField]})` : String(r[spec.idField]);

/** Cap on how many affected records are listed back; the count is always exact. */
const PREVIEW_LIMIT = 20;
const previewList = (names: string[]) =>
  names.length <= PREVIEW_LIMIT
    ? names
    : [...names.slice(0, PREVIEW_LIMIT), `…and ${names.length - PREVIEW_LIMIT} more`];

export async function planBulkUpdate(
  client: RestClient,
  resource: BulkResource,
  updates: Rec,
  ids?: number[],
  namePattern?: string,
) {
  const spec = SPECS[resource];
  // One bulk call could otherwise reset the password of every account on the server.
  assertNoReservedFields(updates, `A bulk ${resource} update`);
  const { matched, missingIds } = select(
    spec,
    resource,
    await loadAll(client, spec),
    ids,
    namePattern,
  );
  // An id the server does not have must be visible in the preview: confirming "3 records" and
  // getting 2 changed is exactly the silent partial this tool must not produce.
  const selectionNote =
    missingIds.length > 0
      ? {
          requested: ids?.length,
          missingIds,
          note: `${missingIds.length} requested id(s) do not exist on the server and are not part of this change: ${missingIds.join(", ")}.`,
        }
      : {};
  if (matched.length === 0) {
    return {
      resource,
      matched: 0,
      ...selectionNote,
      message: "Nothing matched that selection — nothing to do.",
    };
  }

  // Server-managed fields are stripped from every posted object, so an update aimed at one can
  // never take effect — drop such keys BEFORE change detection (otherwise records would be
  // selected for a pure no-op write that still bumps their version) and report them.
  const effective = stripServerManaged(updates);
  const ignored = Object.keys(updates).filter((k) => !(k in effective));
  const ignoredNote =
    ignored.length > 0
      ? {
          ignoredReadOnlyFields: ignored,
          note: `The server assigns ${ignored.join(", ")} itself and rejects a write that sets them, so they are not part of this change.`,
        }
      : {};
  if (Object.keys(effective).length === 0) {
    return {
      resource,
      matched: matched.length,
      willChange: 0,
      ...selectionNote,
      ...ignoredNote,
      message: "Every requested field is server-managed — nothing to do.",
    };
  }

  // Only records that actually change are sent: a no-op write would still bump versions.
  const changed = matched.filter((r) =>
    Object.keys(effective).some((k) => !sameValue(r[k], effective[k])),
  );
  if (changed.length === 0) {
    return {
      resource,
      matched: matched.length,
      willChange: 0,
      ...selectionNote,
      ...ignoredNote,
      message: "Every matched record already holds those values — nothing to do.",
    };
  }

  for (const req of spec.requiredFields ?? []) {
    const incomplete = changed.filter((r) => !(req in r));
    if (incomplete.length > 0) {
      throw new Error(
        `Cannot batch-edit ${resource}: the ${spec.queryPath} response omits the required \`${req}\` field for ${incomplete.length} record(s) (${incomplete
          .slice(0, 5)
          .map((r) => label(spec, r))
          .join(
            ", ",
          )}). Posting an incomplete record would be rejected — use the single-record update tool instead.`,
      );
    }
  }

  const objects = changed.map((r) => stripServerManaged({ ...r, ...effective }));
  return {
    resource,
    matched: matched.length,
    willChange: changed.length,
    setting: redactSecrets(effective),
    ...selectionNote,
    ...ignoredNote,
    affected: previewList(changed.map((r) => label(spec, r))),
    unchangedSkipped: matched.length - changed.length,
    commitToken: issuePlan({ path: spec.editPath, objects }, "bulk_update"),
    disclosure: `You are confirming a LIVE bulk change to ${changed.length} ${resource} record(s) server-wide via an AI assistant. Review the selection and values, then call bulk_update_commit with this commitToken. Nothing is written until you commit.`,
  };
}

export async function planBulkDelete(
  client: RestClient,
  resource: BulkResource,
  ids?: number[],
  namePattern?: string,
) {
  const spec = SPECS[resource];
  const { matched, missingIds } = select(
    spec,
    resource,
    await loadAll(client, spec),
    ids,
    namePattern,
  );
  const selectionNote =
    missingIds.length > 0
      ? {
          requested: ids?.length,
          missingIds,
          note: `${missingIds.length} requested id(s) do not exist on the server and will not be deleted: ${missingIds.join(", ")}.`,
        }
      : {};
  if (matched.length === 0) {
    return {
      resource,
      matched: 0,
      ...selectionNote,
      message: "Nothing matched that selection — nothing to delete.",
    };
  }
  const objects = matched.map((r) => ({
    [spec.idKey]: r[spec.idField],
    version: r.version,
  }));
  return {
    resource,
    willDelete: matched.length,
    ...selectionNote,
    affected: previewList(matched.map((r) => label(spec, r))),
    commitToken: issuePlan({ path: spec.deletePath, objects }, "bulk_delete"),
    disclosure: `You are confirming the LIVE DELETION of ${matched.length} ${resource} record(s) server-wide via an AI assistant. Review the list, then call bulk_delete_commit with this commitToken. Nothing is deleted until you commit.`,
  };
}

/**
 * Apply a bulk plan. The batch endpoints take a bare array and carry no If-Match, so any ETag
 * cached on the path is cleared first. Not retried on a connection error: a partially applied
 * batch must not be silently repeated.
 */
export async function commitBulk(client: RestClient, commitToken: string, tool: string) {
  const plan = takeCommit(commitToken, tool) as { path: string; objects: Rec[] };
  client.setEtag(plan.path, "");
  return client.post(plan.path, plan.objects, { retryOnConnectionError: false });
}

// --- tool-facing schemas ---

const selectionFields = {
  resource: z.enum(BULK_RESOURCES).describe("Which kind of record to change"),
  ids: z
    .array(z.number())
    .optional()
    .describe("Explicit record IDs (managers: account IDs). Use this or namePattern."),
  namePattern: z
    .string()
    .optional()
    .describe(
      "Glob over the record's name — 'EUR*' for symbols, 'Real/*' for groups, '*' for all. Only for resources that have a name (symbols, groups, holidays, liquidity).",
    ),
};

export const bulkUpdatePlanSchema = z.object({
  ...selectionFields,
  updates: z
    .record(z.unknown())
    .describe(
      "Fields to set on every selected record, using the exact names the matching get_* returns (e.g. { bidMarkup: 5, askMarkup: 5 }).",
    ),
});

export const bulkUpdatePlan = (client: RestClient, p: z.infer<typeof bulkUpdatePlanSchema>) =>
  planBulkUpdate(client, p.resource, p.updates, p.ids, p.namePattern);

export const bulkUpdateCommitSchema = z.object({
  commitToken: z.string().describe("The commitToken returned by bulk_update_plan"),
});

export const bulkUpdateCommit = (client: RestClient, p: z.infer<typeof bulkUpdateCommitSchema>) =>
  commitBulk(client, p.commitToken, "bulk_update");

export const bulkDeletePlanSchema = z.object(selectionFields);

export const bulkDeletePlan = (client: RestClient, p: z.infer<typeof bulkDeletePlanSchema>) =>
  planBulkDelete(client, p.resource, p.ids, p.namePattern);

export const bulkDeleteCommitSchema = z.object({
  commitToken: z.string().describe("The commitToken returned by bulk_delete_plan"),
});

export const bulkDeleteCommit = (client: RestClient, p: z.infer<typeof bulkDeleteCommitSchema>) =>
  commitBulk(client, p.commitToken, "bulk_delete");
