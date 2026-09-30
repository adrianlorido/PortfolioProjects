/**
 * Financial-data provider boundary.
 *
 * Every aggregator (sample data today, Plaid in a later phase, CSV import, …) implements
 * `FinancialDataProvider` and returns data ALREADY NORMALIZED into the shapes below:
 *   - amounts use our sign convention (positive = increases net worth) in integer minor units;
 *     e.g. a Plaid adapter must negate Plaid's "positive = money out" amounts and flip
 *     liability balances (Plaid reports amount owed as positive);
 *   - account types are mapped onto our AccountType union;
 *   - dates are "YYYY-MM-DD".
 * Core modules (finance, accounts, transactions, analytics) depend only on these types and
 * on the domain model, never on provider SDKs or provider field names.
 *
 * Runtime validation: ingestion re-validates every record against
 * src/modules/sync/normalized-schemas.ts before anything is written, so a buggy adapter can't
 * persist NaN, fractional cents or impossible dates.
 *
 * Credentials: methods receive a `ProviderConnectionRef`, never an access token. Adapters
 * resolve secrets server-side (e.g. from the service-role-only `connection_credentials`
 * table). Adapters must only be imported from server code.
 */
import type { AccountType, Id, IsoDate, IsoDateTime, Provider } from "@/domain/models";
import type { CurrencyCode, Money } from "@/modules/finance/money";

export interface ProviderConnectionRef {
  /** Our FinancialConnection id. */
  connectionId: Id;
  /** The provider's id for the link (e.g. Plaid item_id). */
  providerConnectionId: string;
}

export interface ConnectInstitutionInput {
  userId: Id;
  /** Provider-specific public handle from the client-side link flow (e.g. a Plaid public_token). */
  publicToken: string;
}

export interface ConnectInstitutionResult {
  providerConnectionId: string;
  institutionName: string;
}

export interface NormalizedAccount {
  externalAccountId: string;
  name: string;
  institutionName: string;
  type: AccountType;
  mask: string | null;
  currency: CurrencyCode;
  /** Signed, our convention: liabilities negative. */
  currentBalance: Money;
  balanceAsOf: IsoDateTime;
}

export interface NormalizedTransaction {
  externalTransactionId: string;
  externalAccountId: string;
  date: IsoDate;
  merchantName: string;
  originalDescription: string;
  /** Signed, our convention: outflows negative. */
  amount: Money;
  currency: CurrencyCode;
  pending: boolean;
  /**
   * Set on a POSTED transaction that replaces a pending one: the pending transaction's
   * externalTransactionId. Ingestion then carries the user's edits over from the pending row
   * and deletes it in the same step, so the pair never coexists (no double counting). Providers
   * that don't link pending/posted leave it null and send the pending id in `removed`.
   */
  pendingExternalTransactionId?: string | null;
  /**
   * Optional category suggestion, as a slug of OUR taxonomy (e.g. "credit_card_payment").
   * Adapters map their own taxonomy (e.g. Plaid personal_finance_category) to our slugs inside
   * the adapter. Used at first import only when no user rule matches; unknown slugs are ignored.
   */
  categoryHint?: string | null;
}

export interface RemovedTransactionRef {
  externalAccountId: string;
  externalTransactionId: string;
}

/** One page of an incremental (cursor-based) transaction sync. */
export interface TransactionSyncPage {
  added: NormalizedTransaction[];
  modified: NormalizedTransaction[];
  removed: RemovedTransactionRef[];
  nextCursor: string;
  hasMore: boolean;
}

/** A balance observation. Providers without history return one per account (today). */
export interface NormalizedBalance {
  externalAccountId: string;
  date: IsoDate;
  balance: Money;
}

export interface FinancialDataProvider {
  readonly provider: Provider;
  connectInstitution(input: ConnectInstitutionInput): Promise<ConnectInstitutionResult>;
  getAccounts(connection: ProviderConnectionRef): Promise<NormalizedAccount[]>;
  /** Pass the cursor stored from the previous sync, or null for the initial sync. */
  syncTransactions(connection: ProviderConnectionRef, cursor: string | null): Promise<TransactionSyncPage>;
  getBalances(connection: ProviderConnectionRef): Promise<NormalizedBalance[]>;
}
