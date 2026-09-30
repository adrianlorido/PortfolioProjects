import type { Id, IsoDateTime, Transaction } from "@/domain/models";
import type { FinanceWriteRepository } from "@/db/repository";
import { ValidationError } from "@/lib/errors";
import { money } from "@/modules/finance/money";
import { transactionSplitsSchema, transactionUpdateSchema } from "./schemas";

/**
 * Validates untrusted input and applies ONLY user-editable fields.
 * `userId` must come from the server-side session, never from the request.
 */
export async function updateTransactionFromInput(
  repo: FinanceWriteRepository,
  userId: Id,
  input: unknown,
  now: IsoDateTime,
): Promise<Transaction> {
  const parsed = transactionUpdateSchema.safeParse(input);
  if (!parsed.success) {
    throw new ValidationError(parsed.error.issues.map((i) => `${i.path.join(".") || "input"}: ${i.message}`).join("; "));
  }
  const { transactionId, categoryId, notes, excludedFromReports } = parsed.data;
  return repo.updateTransactionUserFields(userId, transactionId, { categoryId, notes, excludedFromReports }, now);
}

/**
 * Replace a transaction's splits from untrusted input (empty list = unsplit). The repository
 * enforces that lines sum exactly to the transaction amount and use the user's own categories.
 */
export async function setTransactionSplitsFromInput(
  repo: FinanceWriteRepository,
  userId: Id,
  input: unknown,
  now: IsoDateTime,
): Promise<Transaction> {
  const parsed = transactionSplitsSchema.safeParse(input);
  if (!parsed.success) {
    throw new ValidationError(parsed.error.issues.map((i) => `${i.path.join(".") || "input"}: ${i.message}`).join("; "));
  }
  const splits = parsed.data.splits.map((s) => ({ amount: money(s.amount), categoryId: s.categoryId }));
  return repo.setTransactionSplits(userId, parsed.data.transactionId, splits, now);
}
