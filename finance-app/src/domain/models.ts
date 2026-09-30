/**
 * Internal domain model.
 *
 * These types are the application's source of truth. External provider data (Plaid, CSV,
 * sample data, …) is normalized into these shapes by an integration adapter before it
 * touches anything else, so no module outside `src/integrations/*` ever sees provider
 * field names.
 *
 * Sign convention (applies to Transaction.amount AND Account balances):
 *   positive  = increases the user's net worth (paycheck, refund, loan principal paid down)
 *   negative  = decreases the user's net worth (purchase, fee, new debt)
 * Consequently liability accounts normally carry NEGATIVE balances
 * (a credit card with $1,200 owed has currentBalance = -120000).
 * See docs/finance-rules.md.
 */
import type { CurrencyCode, Money } from "@/modules/finance/money";

export type Id = string;

/** Calendar date without time zone, "YYYY-MM-DD". Transactions are dated, not timestamped. */
export type IsoDate = string;
/** Full ISO-8601 timestamp. */
export type IsoDateTime = string;

export interface User {
  id: Id;
  displayName: string;
}

export const PROVIDERS = ["sample", "plaid", "manual"] as const;
export type Provider = (typeof PROVIDERS)[number];

export const CONNECTION_STATUSES = ["active", "needs_reauth", "disconnected", "error"] as const;
export type ConnectionStatus = (typeof CONNECTION_STATUSES)[number];

/**
 * A link to one institution through one provider. Holds no credentials: provider access
 * tokens live in a separate server-only store (see `connection_credentials` in the schema).
 */
export interface FinancialConnection {
  id: Id;
  userId: Id;
  provider: Provider;
  /** The provider's identifier for this link (e.g. a Plaid item_id). */
  providerConnectionId: string;
  institutionName: string;
  status: ConnectionStatus;
  /** Opaque incremental-sync cursor returned by the provider. */
  syncCursor: string | null;
  lastSyncedAt: IsoDateTime | null;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

export const ACCOUNT_TYPES = [
  "checking",
  "savings",
  "credit",
  "loan",
  "investment",
  "cash",
  "other_asset",
  "other_liability",
] as const;
export type AccountType = (typeof ACCOUNT_TYPES)[number];

export interface Account {
  id: Id;
  userId: Id;
  /** Null for manually-created accounts. */
  connectionId: Id | null;
  /** Provider's account id; immutable once set. */
  externalAccountId: string | null;
  name: string;
  institutionName: string;
  type: AccountType;
  /** Last 2–4 digits for display. */
  mask: string | null;
  currency: CurrencyCode;
  /** Signed per the sign convention above: liabilities are normally negative. */
  currentBalance: Money;
  balanceAsOf: IsoDateTime;
  isHidden: boolean;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

export const CATEGORY_KINDS = ["income", "expense", "transfer"] as const;
/**
 * How a category participates in reports:
 *   income   – counted in income
 *   expense  – counted in spending (inflows here are refunds and reduce spending)
 *   transfer – money moving between the user's own accounts; never income or spending
 */
export type CategoryKind = (typeof CATEGORY_KINDS)[number];

export interface CategoryGroup {
  id: Id;
  userId: Id;
  name: string;
  sortOrder: number;
}

export interface Category {
  id: Id;
  userId: Id;
  groupId: Id;
  /** Stable machine key, unique per user (e.g. "groceries"). */
  slug: string;
  name: string;
  kind: CategoryKind;
  sortOrder: number;
}

export const RULE_MATCH_FIELDS = ["original_description", "merchant_name"] as const;
export type RuleMatchField = (typeof RULE_MATCH_FIELDS)[number];
export const RULE_MATCH_TYPES = ["contains", "equals", "starts_with"] as const;
export type RuleMatchType = (typeof RULE_MATCH_TYPES)[number];

/** Assigns a category to newly-imported transactions whose text matches. Case-insensitive. */
export interface CategoryRule {
  id: Id;
  userId: Id;
  categoryId: Id;
  matchField: RuleMatchField;
  matchType: RuleMatchType;
  pattern: string;
  /** Lower number wins. */
  priority: number;
  isActive: boolean;
}

export const CATEGORY_SOURCES = ["none", "rule", "user"] as const;
/** Where the current category came from. "user" is never overwritten by imports or rules. */
export type CategorySource = (typeof CATEGORY_SOURCES)[number];

export interface Transaction {
  id: Id;
  userId: Id;
  accountId: Id;
  /** Provider transaction id. Immutable; with accountId forms the idempotency key for imports. */
  externalTransactionId: string | null;
  date: IsoDate;
  /** Cleaned display name. */
  merchantName: string;
  /** Raw bank description, kept verbatim. Immutable from the UI. */
  originalDescription: string;
  /** Signed per the sign convention. Immutable from the UI. */
  amount: Money;
  currency: CurrencyCode;
  pending: boolean;
  categoryId: Id | null;
  categorySource: CategorySource;
  notes: string | null;
  excludedFromReports: boolean;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

/** The only transaction fields a user may edit. Everything else is provider-owned. */
export interface TransactionUserEdits {
  categoryId?: Id | null;
  notes?: string | null;
  excludedFromReports?: boolean;
}

export const SNAPSHOT_SOURCES = ["provider", "sample", "manual"] as const;
export type SnapshotSource = (typeof SNAPSHOT_SOURCES)[number];

/** End-of-day balance for one account on one date. Signed like Account.currentBalance. */
export interface BalanceSnapshot {
  id: Id;
  userId: Id;
  accountId: Id;
  date: IsoDate;
  balance: Money;
  source: SnapshotSource;
}
