import type { CategoryRule, Id, Transaction } from "@/domain/models";

export type RuleMatchInput = Pick<Transaction, "merchantName" | "originalDescription">;

export function ruleMatches(rule: CategoryRule, tx: RuleMatchInput): boolean {
  if (!rule.isActive) return false;
  const haystack = (rule.matchField === "merchant_name" ? tx.merchantName : tx.originalDescription).toLowerCase();
  const needle = rule.pattern.toLowerCase();
  switch (rule.matchType) {
    case "contains":
      return haystack.includes(needle);
    case "equals":
      return haystack === needle;
    case "starts_with":
      return haystack.startsWith(needle);
  }
}

/**
 * First matching active rule by (priority asc, id asc) wins. Deterministic regardless of
 * input order. Returns null when nothing matches.
 */
export function findCategoryForTransaction(rules: readonly CategoryRule[], tx: RuleMatchInput): Id | null {
  const ordered = [...rules].sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id));
  return ordered.find((rule) => ruleMatches(rule, tx))?.categoryId ?? null;
}
