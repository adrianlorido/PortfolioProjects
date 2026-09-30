import type { Account, AccountType } from "@/domain/models";
import { type AccountClass, classifyAccount } from "@/modules/finance/accounts";
import { type Money, ZERO, add, negate } from "@/modules/finance/money";

export type AccountGroupKey = "cash" | "credit" | "investments" | "loans" | "other_assets" | "other_liabilities";

export const ACCOUNT_GROUPS: readonly { key: AccountGroupKey; label: string; types: readonly AccountType[] }[] = [
  { key: "cash", label: "Cash", types: ["checking", "savings", "cash"] },
  { key: "credit", label: "Credit Cards", types: ["credit"] },
  { key: "investments", label: "Investments", types: ["investment"] },
  { key: "loans", label: "Loans", types: ["loan"] },
  { key: "other_assets", label: "Other Assets", types: ["other_asset"] },
  { key: "other_liabilities", label: "Other Liabilities", types: ["other_liability"] },
];

export const ACCOUNT_TYPE_LABELS: Readonly<Record<AccountType, string>> = {
  checking: "Checking",
  savings: "Savings",
  credit: "Credit card",
  loan: "Loan",
  investment: "Investment",
  cash: "Cash",
  other_asset: "Other asset",
  other_liability: "Other liability",
};

/**
 * Balance as users expect to read it: assets as held, liabilities as the positive amount
 * owed. Display-only; calculations always use the signed stored balance.
 */
export function displayBalance(account: Pick<Account, "type" | "currentBalance">): Money {
  return classifyAccount(account.type) === "liability" ? negate(account.currentBalance) : account.currentBalance;
}

export interface AccountGroup<T extends Account = Account> {
  key: AccountGroupKey;
  label: string;
  accountClass: AccountClass;
  accounts: T[];
  /** Sum of displayBalance over the group (amount held, or amount owed). */
  displayTotal: Money;
}

export function groupAccounts<T extends Account>(accounts: readonly T[]): AccountGroup<T>[] {
  return ACCOUNT_GROUPS.map((group) => {
    const members = accounts
      .filter((a) => group.types.includes(a.type))
      .sort((a, b) => a.name.localeCompare(b.name));
    return {
      key: group.key,
      label: group.label,
      accountClass: classifyAccount(group.types[0]!),
      accounts: members,
      displayTotal: members.reduce((t, a) => add(t, displayBalance(a)), ZERO),
    };
  }).filter((g) => g.accounts.length > 0);
}
