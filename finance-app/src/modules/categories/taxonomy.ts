import type { Category, CategoryGroup, CategoryKind, Id } from "@/domain/models";

interface CategoryDefinition {
  slug: string;
  name: string;
  kind: CategoryKind;
}

interface GroupDefinition {
  slug: string;
  name: string;
  categories: CategoryDefinition[];
}

const expense = (slug: string, name: string): CategoryDefinition => ({ slug, name, kind: "expense" });
const income = (slug: string, name: string): CategoryDefinition => ({ slug, name, kind: "income" });
const transfer = (slug: string, name: string): CategoryDefinition => ({ slug, name, kind: "transfer" });

/**
 * Default taxonomy, seeded per user. A category's `kind` (not its group) decides how it is
 * treated in reports, which lets "Debt Payments" hold both transfers (the payments
 * themselves) and a genuine expense (interest & fees).
 */
export const DEFAULT_TAXONOMY: readonly GroupDefinition[] = [
  {
    slug: "income",
    name: "Income",
    categories: [income("paycheck", "Paycheck"), income("interest_income", "Interest Income"), income("other_income", "Other Income")],
  },
  {
    slug: "housing",
    name: "Housing",
    categories: [expense("rent", "Rent & Mortgage"), expense("home_maintenance", "Home Maintenance")],
  },
  {
    slug: "food_dining",
    name: "Food & Dining",
    categories: [expense("groceries", "Groceries"), expense("restaurants", "Restaurants"), expense("coffee", "Coffee Shops")],
  },
  {
    slug: "shopping",
    name: "Shopping",
    categories: [expense("general_merchandise", "General Merchandise"), expense("clothing", "Clothing"), expense("electronics", "Electronics")],
  },
  {
    slug: "transportation",
    name: "Transportation",
    categories: [expense("gas", "Gas & Fuel"), expense("rideshare_transit", "Rideshare & Transit"), expense("parking_tolls", "Parking & Tolls"), expense("auto_maintenance", "Auto Maintenance")],
  },
  {
    slug: "entertainment",
    name: "Entertainment",
    categories: [expense("streaming", "Streaming & Subscriptions"), expense("events", "Events & Recreation")],
  },
  {
    slug: "health",
    name: "Health",
    categories: [expense("pharmacy", "Pharmacy"), expense("medical", "Medical"), expense("fitness", "Fitness")],
  },
  {
    slug: "bills_utilities",
    name: "Bills & Utilities",
    categories: [expense("utilities", "Electric & Gas"), expense("internet", "Internet"), expense("phone", "Phone"), expense("insurance", "Insurance")],
  },
  {
    slug: "travel",
    name: "Travel",
    categories: [expense("flights", "Flights"), expense("lodging", "Lodging")],
  },
  {
    slug: "transfers",
    name: "Transfers",
    categories: [transfer("transfer", "Transfer"), transfer("investment_contribution", "Investment Contribution")],
  },
  {
    slug: "debt_payments",
    name: "Debt Payments",
    categories: [transfer("credit_card_payment", "Credit Card Payment"), transfer("loan_payment", "Loan Payment"), expense("interest_fees", "Interest & Fees")],
  },
  {
    slug: "other",
    name: "Other",
    categories: [expense("gifts_donations", "Gifts & Donations"), expense("cash_atm", "Cash & ATM"), expense("miscellaneous", "Miscellaneous")],
  },
];

export const groupIdFor = (slug: string): Id => `grp_${slug}`;
export const categoryIdFor = (slug: string): Id => `cat_${slug}`;

/** Deterministic per-user seed of the default taxonomy (ids are stable slugs in sample mode). */
export function buildDefaultTaxonomy(userId: Id): { groups: CategoryGroup[]; categories: Category[] } {
  const groups: CategoryGroup[] = [];
  const categories: Category[] = [];
  DEFAULT_TAXONOMY.forEach((group, groupIndex) => {
    groups.push({ id: groupIdFor(group.slug), userId, name: group.name, sortOrder: groupIndex });
    group.categories.forEach((category, categoryIndex) => {
      categories.push({
        id: categoryIdFor(category.slug),
        userId,
        groupId: groupIdFor(group.slug),
        slug: category.slug,
        name: category.name,
        kind: category.kind,
        sortOrder: categoryIndex,
      });
    });
  });
  return { groups, categories };
}
