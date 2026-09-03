import { z } from "zod";
import { RestClient } from "../../rest-client.js";
import { accountFilterSchema, buildAccountFilter } from "./filters.js";
import { fetchRecord } from "./lookup.js";
import { readWithEtag, stripServerManaged, commitResourceWrite } from "./resource-write.js";
import { issuePlan, takeCommit } from "../../preview/plan-commit.js";
import { completenessMessage } from "../../validation.js";

export const getAccountStateSchema = z.object({
  accountId: z.number().describe("Trading account ID (login)"),
});

export async function getAccountState(
  client: RestClient,
  params: z.infer<typeof getAccountStateSchema>,
) {
  const states = await client.post("/admin/accounts/states/query", {
    accountFilter: { accounts: [params.accountId] },
  });
  return states;
}

export const getAccountInfoSchema = z.object({
  accountId: z.number().describe("Trading account ID (login)"),
});

export async function getAccountInfo(
  client: RestClient,
  params: z.infer<typeof getAccountInfoSchema>,
) {
  return client.get(`/admin/accounts/get/${params.accountId}`);
}

export const getAllAccountsSchema = z.object({});

export async function getAllAccounts(client: RestClient) {
  return client.get("/admin/accounts/query");
}

export const cashTransferSchema = z.object({
  accountId: z.number().describe("Trading account ID"),
  amount: z.number().describe("Transfer amount"),
  type: z
    .enum([
      "Balance",
      "Credit",
      "Fee",
      "Adjustment",
      "Bonus",
      "CreditBonus",
      "Commission",
      "Interest",
      "Dividend",
      "Tax",
    ])
    .describe("Transfer type (Balance = deposit/withdrawal, use negative amount for withdrawal)"),
  currency: z.string().optional().default("USD").describe("Currency or asset name"),
  comment: z.string().optional().describe("Transfer comment"),
});

export async function cashTransfer(client: RestClient, params: z.infer<typeof cashTransferSchema>) {
  const body: Record<string, unknown> = {
    A: params.accountId,
    a: params.amount,
    T: params.type,
    c: params.currency || "USD",
    t: Date.now() * 1000, // microseconds
  };
  if (params.comment) body.ct = params.comment;

  // Moving money is not idempotent: a connection reset does not prove the server never booked the
  // transfer, and doSend would resend the identical body — a second live deposit or withdrawal.
  return client.post("/admin/transfers/edit", body, { retryOnConnectionError: false });
}

// ===== cash_transfer preview/commit (confirm-before-execute) =====
// cash_transfer moves real money irreversibly, so — like the trading money-movers — it is gated:
// cash_transfer_plan validates + previews + issues a single-use token WITHOUT executing;
// cash_transfer_commit consumes the token (bound to "cash_transfer") and runs the unchanged
// cashTransfer() above.
export const cashTransferPlanSchema = z.object({
  accountId: z.number().optional().describe("Trading account ID"),
  amount: z
    .number()
    .optional()
    .describe("Transfer amount. Positive = deposit/credit, negative = withdrawal/debit"),
  type: cashTransferSchema.shape.type
    .optional()
    .describe("Transfer type (Balance = deposit/withdrawal)"),
  currency: z.string().optional().describe("Currency or asset name (default USD)"),
  comment: z.string().optional().describe("Transfer comment"),
});

const CASH_TRANSFER_DISCLOSURE =
  "You are confirming a LIVE cash transfer on a client account via an AI assistant — this moves " +
  "real money and is irreversible. Review the account, amount, and direction, then call " +
  "cash_transfer_commit with this commitToken to execute. Nothing is sent until you commit.";

export async function cashTransferPlan(
  client: RestClient,
  params: z.infer<typeof cashTransferPlanSchema>,
) {
  const need = completenessMessage("cash_transfer_plan", params, [
    { name: "accountId", label: "account ID" },
    { name: "amount", label: "amount (positive = deposit, negative = withdrawal)" },
    { name: "type", label: "transfer type", options: cashTransferSchema.shape.type.options },
  ]);
  if (need) return { needMoreInfo: need };
  const preview = {
    action: "cash_transfer",
    accountId: params.accountId,
    amount: params.amount,
    direction:
      (params.amount ?? 0) < 0 ? "withdrawal (debit from account)" : "deposit (credit to account)",
    type: params.type,
    // Match cashTransfer()'s executor default (|| "USD") so an empty-string currency previews as
    // exactly what will execute, not as "".
    currency: params.currency || "USD",
    ...(params.comment ? { comment: params.comment } : {}),
  };
  const commitToken = issuePlan(params, "cash_transfer");
  return { preview, commitToken, disclosure: CASH_TRANSFER_DISCLOSURE };
}

export const cashTransferCommitSchema = z.object({
  commitToken: z.string().describe("The commitToken returned by cash_transfer_plan"),
});

export async function cashTransferCommit(
  client: RestClient,
  params: z.infer<typeof cashTransferCommitSchema>,
) {
  return cashTransfer(
    client,
    cashTransferSchema.parse(takeCommit(params.commitToken, "cash_transfer")),
  );
}

export const getTransferHistorySchema = z.object({
  accountId: z.number().optional().describe("Filter by account ID"),
  from: z.number().optional().describe("Start time (microseconds since epoch)"),
  to: z.number().optional().describe("End time (microseconds since epoch)"),
  limit: z.number().optional().describe("Max results"),
});

export async function getTransferHistory(
  client: RestClient,
  params: z.infer<typeof getTransferHistorySchema>,
) {
  const body: Record<string, unknown> = {};
  // The server expects `accountFilter` / `symbolNames`; a bare { A, s } filter is SILENTLY IGNORED
  // and the endpoint then returns EVERY record (verified live), so the wrong rows look like a match.
  if (params.accountId !== undefined) body.accountFilter = { accounts: [params.accountId] };
  if (params.from !== undefined) body.from = params.from;
  if (params.to !== undefined) body.to = params.to;
  if (params.limit !== undefined) body.limit = params.limit;

  return client.post("/admin/transfers/query", body);
}

export const getBalancesSchema = z.object({});

export async function getBalances(client: RestClient) {
  // Get all accounts
  const result = (await client.get("/admin/accounts/query")) as {
    accounts?: Array<{ id?: number }>;
  };
  const accounts = result.accounts ?? [];

  // Extract account IDs
  const ids: number[] = [];
  for (const acc of accounts) {
    if (acc.id !== undefined) ids.push(acc.id);
  }

  if (ids.length === 0) return { accounts, note: "No account IDs found" };

  // Query states for all accounts at once
  const states = await client.post("/admin/accounts/states/query", {
    accountFilter: { accounts: ids },
  });
  return states;
}

export const getTransferSchema = z.object({
  transferId: z.number().describe("Transfer unique identifier (from get_transfer_history)"),
  accountId: z
    .number()
    .optional()
    .describe(
      "Owning account ID — narrows the lookup and is required on servers that do not serve get-by-id",
    ),
});

export async function getTransfer(client: RestClient, params: z.infer<typeof getTransferSchema>) {
  return fetchRecord(
    client,
    {
      label: "transfer",
      getPath: `/admin/transfers/get/${params.transferId}`,
      queryPath: "/admin/transfers/query",
      queryBody:
        params.accountId === undefined ? {} : { accountFilter: { accounts: [params.accountId] } },
      collectionKey: "transfers",
      accountId: params.accountId,
    },
    params.transferId,
  );
}

export const getMarginCallAccountsSchema = z.object({
  ...accountFilterSchema,
  maxResults: z.number().optional().describe("Max results to return"),
  sortOrder: z.enum(["asc", "desc"]).optional().describe("Sort direction"),
});

export async function getMarginCallAccounts(
  client: RestClient,
  params: z.infer<typeof getMarginCallAccountsSchema>,
) {
  const body: Record<string, unknown> = {};
  const accountFilter = buildAccountFilter(params);
  if (accountFilter) body.accountFilter = accountFilter;
  if (params.maxResults !== undefined) body.maxResults = params.maxResults;
  if (params.sortOrder !== undefined) body.sortOrder = params.sortOrder;
  return client.post("/admin/accounts/margin-call/query", body);
}

// === PASSWORD OPERATIONS (plan/commit) ===
//
// Two distinct things, deliberately separate tools:
//   * set_account_password — a manager resetting SOME OTHER trading account's password, done by
//     writing the `password` field through /admin/accounts/edit (the account upsert).
//   * change_my_password  — POST /password, which takes no account and therefore changes the
//     password of the account this MCP is signed in as.
// The password value is never echoed back in a preview or result: previews show "(hidden)".

export const setAccountPasswordPlanSchema = z.object({
  accountId: z.number().describe("Trading account whose password should be reset"),
  password: z.string().min(1).describe("The new password, supplied by the user"),
});

const SET_ACCOUNT_PASSWORD_DISCLOSURE =
  "You are confirming a LIVE password reset for a client trading account via an AI assistant. Anyone using the old password will be locked out. Review the target account, then call set_account_password_commit with this commitToken. Nothing is written until you commit.";

export async function setAccountPasswordPlan(
  client: RestClient,
  params: z.infer<typeof setAccountPasswordPlanSchema>,
) {
  const path = `/admin/accounts/get/${params.accountId}`;
  // Body and ETag from the same response — reading the ETag back out of the shared cache
  // would race with any concurrent read of the same account (see readWithEtag).
  const { data: current, etag } = await readWithEtag(client, path);
  const object = stripServerManaged({ ...current, password: params.password });
  return {
    accountId: params.accountId,
    group: current.groupId,
    client: current.clientId,
    change: { password: "(hidden — will be set to the value you supplied)" },
    commitToken: issuePlan({ path: "/admin/accounts/edit", object, etag }, "set_account_password"),
    disclosure: SET_ACCOUNT_PASSWORD_DISCLOSURE,
  };
}

export const setAccountPasswordCommitSchema = z.object({
  commitToken: z.string().describe("The commitToken returned by set_account_password_plan"),
});

export async function setAccountPasswordCommit(
  client: RestClient,
  params: z.infer<typeof setAccountPasswordCommitSchema>,
) {
  return commitResourceWrite(client, params.commitToken, "set_account_password");
}

export const changeMyPasswordPlanSchema = z.object({
  password: z.string().min(1).describe("The new password for the signed-in account"),
});

const CHANGE_MY_PASSWORD_DISCLOSURE =
  "You are confirming a LIVE password change for THE ACCOUNT THIS MCP IS SIGNED IN AS (POST /password takes no account id). The stored MCP configuration will still hold the OLD password, so the connection will fail on its next sign-in until you update YB_PASSWORD yourself. Only commit if that is genuinely what you want.";

export async function changeMyPasswordPlan(
  client: RestClient,
  params: z.infer<typeof changeMyPasswordPlanSchema>,
) {
  return {
    target: "the account this MCP session is signed in as",
    change: { password: "(hidden — will be set to the value you supplied)" },
    warning:
      "This does NOT reset a client's password — use set_account_password_plan for that. After committing, update YB_PASSWORD in your MCP configuration or the server will stop connecting.",
    commitToken: issuePlan({ password: params.password }, "change_my_password"),
    disclosure: CHANGE_MY_PASSWORD_DISCLOSURE,
  };
}

export const changeMyPasswordCommitSchema = z.object({
  commitToken: z.string().describe("The commitToken returned by change_my_password_plan"),
});

export async function changeMyPasswordCommit(
  client: RestClient,
  params: z.infer<typeof changeMyPasswordCommitSchema>,
) {
  await client.post("/password", takeCommit(params.commitToken, "change_my_password"), {
    retryOnConnectionError: false,
  });
  return {
    result: "success",
    reminder:
      "Update YB_PASSWORD in the MCP configuration now — the running session keeps working until its token expires, after which sign-in will fail with the old password.",
  };
}
