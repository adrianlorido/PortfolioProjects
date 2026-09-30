import type { RuleMatchType } from "@/domain/models";

/**
 * Starter categorization rules for the sample user: (description pattern -> category slug).
 * They are seeded as ordinary CategoryRule rows and run through the same rule engine that
 * user-defined rules will use. They cover MERCHANT spending only: income, transfers, card and
 * loan payments and interest are classified by the provider's category hint (see dataset.ts),
 * so treating a card payment as a transfer does not depend on matching description text.
 */
export const SAMPLE_RULES: readonly { pattern: string; categorySlug: string; matchType?: RuleMatchType }[] = [
  { pattern: "ACME CORP EXPENSE REIMB", categorySlug: "other_income" },
  { pattern: "OAKWOOD PROPERTIES", categorySlug: "rent" },
  { pattern: "GEICO", categorySlug: "insurance" },
  { pattern: "PGANDE", categorySlug: "utilities" },
  { pattern: "TRADER JOE", categorySlug: "groceries" },
  { pattern: "WHOLEFDS", categorySlug: "groceries" },
  { pattern: "SAFEWAY", categorySlug: "groceries" },
  { pattern: "CHIPOTLE", categorySlug: "restaurants" },
  { pattern: "NOPA RESTAURANT", categorySlug: "restaurants" },
  { pattern: "HOPS & HOMINY", categorySlug: "restaurants" },
  { pattern: "DOORDASH", categorySlug: "restaurants" },
  { pattern: "SWEETGREEN", categorySlug: "restaurants" },
  { pattern: "BLUE BOTTLE", categorySlug: "coffee" },
  { pattern: "STARBUCKS", categorySlug: "coffee" },
  { pattern: "AMAZON", categorySlug: "general_merchandise" },
  { pattern: "TARGET ", categorySlug: "general_merchandise", matchType: "starts_with" },
  { pattern: "UNIQLO", categorySlug: "clothing" },
  { pattern: "BEST BUY", categorySlug: "electronics" },
  { pattern: "SHELL OIL", categorySlug: "gas" },
  { pattern: "CHEVRON", categorySlug: "gas" },
  { pattern: "UBER", categorySlug: "rideshare_transit" },
  { pattern: "CITY FITNESS", categorySlug: "fitness" },
  { pattern: "NETFLIX", categorySlug: "streaming" },
  { pattern: "SPOTIFY", categorySlug: "streaming" },
  { pattern: "APPLE.COM/BILL", categorySlug: "streaming" },
  { pattern: "XFINITY", categorySlug: "internet" },
  { pattern: "VERIZON", categorySlug: "phone" },
  { pattern: "CVS/PHARMACY", categorySlug: "pharmacy" },
  { pattern: "AMC ", categorySlug: "events", matchType: "starts_with" },
  { pattern: "ATM WITHDRAWAL", categorySlug: "cash_atm" },
  { pattern: "UNITED ", categorySlug: "flights", matchType: "starts_with" },
  { pattern: "DELTA AIR LINES", categorySlug: "flights" },
  { pattern: "MARRIOTT", categorySlug: "lodging" },
];
