import { z } from "zod";
import { RestClient } from "../../rest-client.js";
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
    A: [params.accountId],
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

  return client.post("/admin/transfers/edit", body);
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
  if (params.accountId !== undefined) body.A = params.accountId;
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
  const states = await client.post("/admin/accounts/states/query", { A: ids });
  return states;
}
