// Generic read-modify-write (edit), create and delete helpers for admin config resources.
//
// Every admin resource (symbols, groups, accounts, clients, liquidity connectors, …) shares one
// write contract, confirmed against the admin SDK:
//   - POST /admin/<res>/edit   — upsert; body = the full verbose object the get/query returns,
//     guarded by If-Match (ETag == the resource version).
//   - POST /admin/<res>/delete — body = { <res>Id, version }, also guarded by If-Match.
// RestClient keys ETags by request path, and the GET path differs from the write path, so the
// ETag captured with the read is carried onto the write here.
//
// These helpers back the per-resource, task-shaped tools (update_<res>_plan/commit,
// delete_<res>_plan/commit) — the tool names, schemas, and descriptions stay hand-written.

import { RestClient } from "../../rest-client.js";
import { issuePlan, takeCommit } from "../../preview/plan-commit.js";

type Rec = Record<string, unknown>;

/** Deep-equal by canonical JSON — sufficient for the plain data an admin record is built from. */
export const sameValue = (a: unknown, b: unknown): boolean =>
  JSON.stringify(a) === JSON.stringify(b);

// Fields the server assigns itself. The API marks them read-only and rejects a write that echoes
// them back ("Invalid body"), so they are removed before every write. Only clients and trading
// accounts actually carry them (trading accounts also carry timePasswordLastChanged); stripping is
// a no-op for the other resources.
const SERVER_MANAGED = ["timeCreated", "timeModified", "timePasswordLastChanged"];

export function stripServerManaged(o: Rec): Rec {
  const r = { ...o };
  for (const k of SERVER_MANAGED) delete r[k];
  return r;
}

// Top-level secret fields that must never be echoed back in a preview (they still travel to the
// server in the stashed commit payload). Matches set_account_password_plan's "(hidden)" handling,
// so the generic account/client paths cannot become an unredacted way around it. Deliberately
// top-level only: liquidity-connector session parameters are shown unredacted by owner decision.
const SECRET_FIELDS = ["password"];
export const HIDDEN = "(hidden — the value you supplied is kept and sent to the server)";

/**
 * Fields a generic update must not carry because a dedicated tool owns them.
 *
 * A trading-account password can technically be written through the same upsert as any other
 * field, but `set_account_password_*` exists so that a reset is confirmed with the disclosure it
 * deserves ("anyone using the old password is locked out"). Letting it through here — or through a
 * bulk update, where one call could reset every account on the server — would route the most
 * sensitive write in the API past its own confirmation. Creates are unaffected: a new account
 * requires an initial password by design.
 */
export const RESERVED_UPDATE_FIELDS: Record<string, string> = {
  password:
    "Use set_account_password_plan / set_account_password_commit to change a trading account password — it states who gets locked out and confirms the reset on its own. Remove `password` from these updates.",
};

/** Throw when an update targets a field that a dedicated tool owns. */
export function assertNoReservedFields(updates: Rec, context: string): void {
  for (const [field, guidance] of Object.entries(RESERVED_UPDATE_FIELDS)) {
    if (field in updates) {
      throw new Error(`${context} cannot set \`${field}\`. ${guidance}`);
    }
  }
}

/** Copy of `o` with secret fields masked for display. */
export function redactSecrets(o: Rec): Rec {
  const r = { ...o };
  for (const k of SECRET_FIELDS) if (k in r) r[k] = HIDDEN;
  return r;
}

/**
 * Read a record together with the ETag of that exact response.
 *
 * The ETag is taken from the response itself rather than from RestClient's per-path cache: two
 * concurrent plans for the same resource would otherwise race, and one could pair its body with
 * the other's version — silently defeating the If-Match conflict check.
 */
export async function readWithEtag(
  client: RestClient,
  path: string,
): Promise<{ data: Rec; etag: string | null }> {
  return client.getWithEtag<Rec>(path);
}

/** Back-compat read helper for callers that only need the body. */
export async function readFresh(client: RestClient, path: string): Promise<Rec> {
  return (await readWithEtag(client, path)).data;
}

export interface ResourceSpec {
  /** Human label used in messages, e.g. "group", "trading account", "liquidity connector". */
  label: string;
  /** Read-one path for the resource id. */
  getPath: (id: number) => string;
  /** Upsert path. */
  editPath: string;
  /** Delete path. */
  deletePath: string;
  /** Identifier key in the delete body, e.g. "groupId", "accountId", "connectorId". */
  idKey: string;
  /** Optional display field to surface (e.g. "name"); omitted resources just show the id. */
  nameKey?: string;
}

/**
 * Preview an edit: read current, apply a partial overlay, diff, stash for commit.
 *
 * The diff is built from the object that will ACTUALLY be sent (after read-only fields are
 * stripped), so the preview can never approve a change that the write silently drops. Any update
 * aimed at a read-only field is reported back as ignored instead of vanishing.
 */
export async function planResourceEdit(
  client: RestClient,
  spec: ResourceSpec,
  id: number,
  updates: Rec,
  tool: string,
) {
  assertNoReservedFields(updates, `A generic ${spec.label} update`);
  const { data: current, etag } = await readWithEtag(client, spec.getPath(id));
  const object = stripServerManaged({ ...current, ...updates });

  const ignored = Object.keys(updates).filter((k) => !(k in object));
  const changes: Record<string, { from: unknown; to: unknown }> = {};
  for (const key of Object.keys(updates)) {
    if (ignored.includes(key)) continue;
    if (!sameValue(current[key], object[key])) {
      changes[key] = SECRET_FIELDS.includes(key)
        ? { from: HIDDEN, to: HIDDEN }
        : { from: current[key], to: object[key] };
    }
  }

  const name = spec.nameKey ? current[spec.nameKey] : undefined;
  const ignoredNote =
    ignored.length > 0
      ? {
          ignoredReadOnlyFields: ignored,
          note: `The server assigns ${ignored.join(", ")} itself and rejects a write that sets them, so they are not part of this change.`,
        }
      : {};

  if (Object.keys(changes).length === 0) {
    return {
      resource: spec.label,
      id,
      ...(name !== undefined ? { name } : {}),
      noChanges: true,
      ...ignoredNote,
      message: `The requested values already match the ${spec.label}'s current configuration.`,
    };
  }

  const commitToken = issuePlan({ path: spec.editPath, object, etag }, tool);
  return {
    resource: spec.label,
    id,
    ...(name !== undefined ? { name } : {}),
    version: current.version,
    changes,
    ...ignoredNote,
    commitToken,
    disclosure: `You are confirming a LIVE change to a ${spec.label}'s server-wide configuration via an AI assistant. Review the diff, then call the matching *_commit with this commitToken. Nothing is written until you commit.`,
  };
}

/** Preview a delete: read current (for version + display), stash { idKey, version } for commit. */
export async function planResourceDelete(
  client: RestClient,
  spec: ResourceSpec,
  id: number,
  tool: string,
) {
  const { data: current, etag } = await readWithEtag(client, spec.getPath(id));
  const body: Rec = { [spec.idKey]: id, version: current.version };
  const commitToken = issuePlan({ path: spec.deletePath, body, etag }, tool);
  return {
    resource: spec.label,
    willDelete: {
      [spec.idKey]: id,
      ...(spec.nameKey ? { name: current[spec.nameKey] } : {}),
      version: current.version,
    },
    commitToken,
    disclosure: `You are confirming the LIVE DELETION of a ${spec.label} via an AI assistant. Review the target, then call the matching *_commit with this commitToken. Nothing is deleted until you commit.`,
  };
}

/**
 * Preview a create: build a new object (cloned from a template id and/or a provided object, with
 * overrides applied) with id/version forced to 0, and stash it for commit. Creates carry NO
 * If-Match (a new resource has no version to match).
 *
 * `willCreate` is the stripped object — the exact body that will be posted, except that secret
 * fields are masked for display — so a clone cannot show fields in the preview that the created
 * record will not have.
 */
export async function planResourceCreate(
  client: RestClient,
  spec: ResourceSpec,
  opts: { fromId?: number; object?: Rec; overrides?: Rec },
  tool: string,
) {
  // The tool descriptions promise "clone via fromId AND/OR pass a full object", so when both are
  // given the template is the base and the explicit object overlays it (overrides win last).
  const template = opts.fromId != null ? await readFresh(client, spec.getPath(opts.fromId)) : {};
  const object = stripServerManaged({
    ...template,
    ...(opts.object ?? {}),
    ...(opts.overrides ?? {}),
    id: 0,
    version: 0,
  });
  const commitToken = issuePlan({ path: spec.editPath, object }, tool); // no etag → no If-Match
  return {
    resource: spec.label,
    action: "create",
    willCreate: redactSecrets(object),
    commitToken,
    disclosure: `You are confirming the LIVE CREATION of a new ${spec.label} via an AI assistant. Review the object, then call the matching *_commit with this commitToken. Nothing is written until you commit.`,
  };
}

/**
 * Apply an edit, delete, or create previewed above. Single-use token consumption (takeCommit)
 * makes a retried commit unable to re-apply a stale write.
 *
 * The ETag is ALWAYS written to the path — set to the stashed value for updates/deletes, cleared
 * for creates. Leaving a previous write's ETag in place would send someone else's version as
 * If-Match, which either fails confusingly or defeats the conflict check outright.
 */
export async function commitResourceWrite(client: RestClient, commitToken: string, tool: string) {
  const plan = takeCommit(commitToken, tool) as {
    path: string;
    object?: Rec;
    body?: Rec;
    etag?: string | null;
  };
  client.setEtag(plan.path, plan.etag ?? "");
  // Never transport-retry: a connection reset does not prove non-delivery. For creates (no
  // If-Match) a retry could mint a duplicate live record; for updates/deletes it could only
  // turn into a confusing 412 after the delivered first attempt bumped the version.
  return client.post(plan.path, plan.object ?? plan.body ?? {}, { retryOnConnectionError: false });
}

/**
 * Build the plan/commit pair for one resource from its spec.
 *
 * Every resource used to repeat the same ~35 lines of wrappers; generating them means a change to
 * shared behaviour (a disclosure wording, a new read-only field, an ETag fix) lands everywhere at
 * once instead of needing seven edits.
 */
export function makeResourceTools(
  spec: ResourceSpec,
  tools: { update: string; delete: string; create: string },
) {
  return {
    planEdit: (client: RestClient, id: number, updates: Rec) =>
      planResourceEdit(client, spec, id, updates, tools.update),
    commitEdit: (client: RestClient, commitToken: string) =>
      commitResourceWrite(client, commitToken, tools.update),
    planDelete: (client: RestClient, id: number) =>
      planResourceDelete(client, spec, id, tools.delete),
    commitDelete: (client: RestClient, commitToken: string) =>
      commitResourceWrite(client, commitToken, tools.delete),
    planCreate: (client: RestClient, opts: { fromId?: number; object?: Rec; overrides?: Rec }) =>
      planResourceCreate(client, spec, opts, tools.create),
    commitCreate: (client: RestClient, commitToken: string) =>
      commitResourceWrite(client, commitToken, tools.create),
  };
}
