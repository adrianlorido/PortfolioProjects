import { z } from "zod";
import { isIsoDate } from "@/modules/finance/period";
import type { TransactionFilters } from "./filters";

const idSchema = z.string().trim().min(1).max(100).regex(/^[A-Za-z0-9_-]+$/, "Invalid id");
const isoDateSchema = z.string().refine(isIsoDate, "Expected YYYY-MM-DD");

/** Search params arrive from the URL; invalid values are dropped rather than failing the page. */
const filterParamsSchema = z.object({
  account: idSchema.optional().catch(undefined),
  category: idSchema.optional().catch(undefined),
  q: z.string().trim().max(100).optional().catch(undefined),
  from: isoDateSchema.optional().catch(undefined),
  to: isoDateSchema.optional().catch(undefined),
});

type RawSearchParams = Record<string, string | string[] | undefined>;

export function parseTransactionFilters(params: RawSearchParams): TransactionFilters {
  const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) || undefined;
  const parsed = filterParamsSchema.parse({
    account: first(params.account),
    category: first(params.category),
    q: first(params.q),
    from: first(params.from),
    to: first(params.to),
  });
  return {
    accountId: parsed.account,
    categoryId: parsed.category,
    search: parsed.q || undefined,
    startDate: parsed.from,
    endDate: parsed.to,
  };
}

export const NOTES_MAX_LENGTH = 1000;

/**
 * The ONLY fields a user may change on a transaction. `.strict()` rejects anything else
 * (amount, date, account, external ids, descriptions…), so provider-owned fields can't be
 * altered through the UI even by a hand-crafted request.
 */
export const transactionUpdateSchema = z
  .object({
    transactionId: idSchema,
    categoryId: idSchema.nullable(),
    notes: z
      .string()
      .max(NOTES_MAX_LENGTH)
      .transform((s) => s.trim())
      .transform((s) => (s === "" ? null : s))
      .nullable(),
    excludedFromReports: z.boolean(),
  })
  .strict();

export type TransactionUpdateInput = z.infer<typeof transactionUpdateSchema>;

/** Untrusted input for replacing a transaction's splits. Sum/ownership rules are enforced downstream. */
export const transactionSplitsSchema = z
  .object({
    transactionId: idSchema,
    splits: z
      .array(
        z
          .object({
            amount: z.number().refine(Number.isSafeInteger, "amount must be integer minor units"),
            categoryId: idSchema.nullable(),
          })
          .strict(),
      )
      .max(20),
  })
  .strict();
