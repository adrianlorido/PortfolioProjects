import { z } from "zod";
import { ACCOUNT_TYPES } from "@/domain/models";
import { isIsoDate } from "@/modules/finance/period";

/**
 * Runtime validation of provider output. The TypeScript types in integrations/provider.ts are
 * only compile-time promises; adapters parse external JSON, so every record is checked here
 * before it can reach storage or the finance engine. Limits mirror the database constraints.
 */
const moneySchema = z.number().refine(Number.isSafeInteger, "must be a safe integer number of minor units");
const externalId = z.string().min(1).max(255);
const isoDate = z.string().refine(isIsoDate, "must be a valid YYYY-MM-DD date");
const currency = z.string().regex(/^[A-Z]{3}$/, "must be an ISO-4217 code");

export const normalizedAccountSchema = z.object({
  externalAccountId: externalId,
  name: z.string().min(1).max(200),
  institutionName: z.string().max(200),
  type: z.enum(ACCOUNT_TYPES),
  mask: z.string().regex(/^[0-9A-Za-z]{2,4}$/).nullable(),
  currency,
  currentBalance: moneySchema,
  balanceAsOf: z.iso.datetime({ offset: true }),
});

export const normalizedTransactionSchema = z
  .object({
    externalTransactionId: externalId,
    externalAccountId: externalId,
    date: isoDate,
    merchantName: z.string().max(200),
    originalDescription: z.string().max(500),
    amount: moneySchema,
    currency,
    pending: z.boolean(),
    pendingExternalTransactionId: externalId.nullish(),
    categoryHint: z.string().regex(/^[a-z0-9_]{1,64}$/).nullish(),
  })
  .refine((t) => !(t.pending && t.pendingExternalTransactionId), "a pending transaction cannot replace another pending transaction")
  .refine((t) => t.pendingExternalTransactionId !== t.externalTransactionId, "a transaction cannot replace itself");

export const removedTransactionSchema = z.object({ externalAccountId: externalId, externalTransactionId: externalId });

export const normalizedBalanceSchema = z.object({ externalAccountId: externalId, date: isoDate, balance: moneySchema });

export function describeZodError(error: z.ZodError): string {
  return error.issues.map((i) => `${i.path.join(".") || "record"}: ${i.message}`).join("; ");
}
