import type { Id, IsoDateTime, Transaction } from "@/domain/models";
import type { FinanceWriteRepository } from "@/db/repository";
import { ValidationError } from "@/lib/errors";
import { transactionUpdateSchema } from "./schemas";

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
