import type { AccountType } from "@/domain/models";

export type AccountClass = "asset" | "liability";

/**
 * Net-worth classification is a property of the account TYPE, never of the balance sign
 * or of transaction history. An overdrawn checking account is still an asset (with a
 * negative balance); an overpaid credit card is still a liability (with a positive balance).
 */
export const ACCOUNT_CLASS: Readonly<Record<AccountType, AccountClass>> = {
  checking: "asset",
  savings: "asset",
  cash: "asset",
  investment: "asset",
  other_asset: "asset",
  credit: "liability",
  loan: "liability",
  other_liability: "liability",
};

export function classifyAccount(type: AccountType): AccountClass {
  return ACCOUNT_CLASS[type];
}
