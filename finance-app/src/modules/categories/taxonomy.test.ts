import { describe, expect, it } from "vitest";
import type { CategoryRule } from "@/domain/models";
import { findCategoryForTransaction } from "./rules";
import { DEFAULT_TAXONOMY, buildDefaultTaxonomy } from "./taxonomy";

describe("default taxonomy", () => {
  const { groups, categories } = buildDefaultTaxonomy("u1");

  it("contains the required top-level groups", () => {
    expect(groups.map((g) => g.name)).toEqual(
      expect.arrayContaining([
        "Income", "Housing", "Food & Dining", "Shopping", "Transportation", "Entertainment",
        "Health", "Bills & Utilities", "Travel", "Transfers", "Debt Payments", "Other",
      ]),
    );
  });

  it("has unique slugs and ids", () => {
    expect(new Set(categories.map((c) => c.slug)).size).toBe(categories.length);
    expect(new Set(categories.map((c) => c.id)).size).toBe(categories.length);
  });

  it("marks income, transfer and debt-payment categories with the right kinds", () => {
    const kindOf = (slug: string) => categories.find((c) => c.slug === slug)?.kind;
    expect(kindOf("paycheck")).toBe("income");
    expect(kindOf("transfer")).toBe("transfer");
    expect(kindOf("credit_card_payment")).toBe("transfer");
    expect(kindOf("loan_payment")).toBe("transfer");
    expect(kindOf("interest_fees")).toBe("expense");
    const incomeGroup = DEFAULT_TAXONOMY.find((g) => g.slug === "income")!;
    expect(incomeGroup.categories.every((c) => c.kind === "income")).toBe(true);
  });
});

describe("category rules", () => {
  const rule = (id: string, pattern: string, categoryId: string, priority = 100, extra: Partial<CategoryRule> = {}): CategoryRule => ({
    id, userId: "u1", categoryId, matchField: "original_description", matchType: "contains", pattern, priority, isActive: true, ...extra,
  });
  const tx = { merchantName: "Whole Foods", originalDescription: "WHOLEFDS MKT #10234 SAN FRANCISCO" };

  it("matches case-insensitively", () => {
    expect(findCategoryForTransaction([rule("r1", "wholefds", "cat_groceries")], tx)).toBe("cat_groceries");
  });

  it("lower priority number wins regardless of input order", () => {
    const rules = [rule("r2", "MKT", "cat_misc", 50), rule("r1", "WHOLEFDS", "cat_groceries", 10)];
    expect(findCategoryForTransaction(rules, tx)).toBe("cat_groceries");
    expect(findCategoryForTransaction([...rules].reverse(), tx)).toBe("cat_groceries");
  });

  it("ignores inactive rules and supports merchant/equals matching", () => {
    expect(findCategoryForTransaction([rule("r1", "WHOLEFDS", "x", 1, { isActive: false })], tx)).toBeNull();
    expect(
      findCategoryForTransaction([rule("r1", "whole foods", "cat_groceries", 1, { matchField: "merchant_name", matchType: "equals" })], tx),
    ).toBe("cat_groceries");
  });
});
