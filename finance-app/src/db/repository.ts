/**
 * Data-access contracts. Every method is scoped by `userId`, mirroring the row-level
 * security policies in supabase/migrations: a repository never returns another user's rows.
 *
 * Phase 1 ships only the in-memory implementation (sample mode). A Supabase/Postgres
 * implementation of the same interfaces is Phase 2 work.
 */
import type {
  Account,
  BalanceSnapshot,
  Category,
  CategoryGroup,
  CategoryRule,
  FinancialConnection,
  Id,
  IsoDate,
  Provider,
  Transaction,
  TransactionSplit,
  TransactionUserEdits,
  User,
} from "@/domain/models";
import type { TransactionFilters } from "@/modules/transactions/filters";

export interface SnapshotQuery {
  accountId?: Id;
  startDate?: IsoDate;
  endDate?: IsoDate;
}

export interface FinanceReadRepository {
  getUser(userId: Id): Promise<User | null>;
  listConnections(userId: Id): Promise<FinancialConnection[]>;
  listAccounts(userId: Id): Promise<Account[]>;
  getAccount(userId: Id, accountId: Id): Promise<Account | null>;
  listCategoryGroups(userId: Id): Promise<CategoryGroup[]>;
  listCategories(userId: Id): Promise<Category[]>;
  listCategoryRules(userId: Id): Promise<CategoryRule[]>;
  /** Newest first. */
  listTransactions(userId: Id, filters?: TransactionFilters): Promise<Transaction[]>;
  getTransaction(userId: Id, transactionId: Id): Promise<Transaction | null>;
  /** Ordered by date ascending. */
  listBalanceSnapshots(userId: Id, query?: SnapshotQuery): Promise<BalanceSnapshot[]>;
}

export interface FinanceWriteRepository {
  /**
   * Applies user-editable fields only. Implementations must not accept any other field.
   * Throws NotFoundError when the transaction doesn't exist for this user.
   */
  updateTransactionUserFields(
    userId: Id,
    transactionId: Id,
    edits: TransactionUserEdits,
    now: string,
  ): Promise<Transaction>;
  /**
   * Replaces the transaction's splits (empty array = unsplit). Lines must satisfy
   * validateSplits() and reference the user's own categories. Never changes the amount.
   */
  setTransactionSplits(userId: Id, transactionId: Id, splits: TransactionSplit[], now: string): Promise<Transaction>;
}

/** Write path used only by the sync/ingestion pipeline (server-side, trusted). */
export interface IngestionRepository {
  newId(prefix: string): Id;
  findConnection(userId: Id, provider: Provider, providerConnectionId: string): Promise<FinancialConnection | null>;
  getConnection(userId: Id, connectionId: Id): Promise<FinancialConnection | null>;
  saveConnection(connection: FinancialConnection): Promise<void>;
  findAccountByExternalId(userId: Id, connectionId: Id, externalAccountId: string): Promise<Account | null>;
  saveAccount(account: Account): Promise<void>;
  findTransactionByExternalId(userId: Id, accountId: Id, externalTransactionId: string): Promise<Transaction | null>;
  saveTransaction(transaction: Transaction): Promise<void>;
  deleteTransaction(userId: Id, transactionId: Id): Promise<void>;
  /** Upsert keyed on (accountId, date). */
  saveBalanceSnapshot(snapshot: Omit<BalanceSnapshot, "id">): Promise<void>;
}

export type FinanceRepository = FinanceReadRepository & FinanceWriteRepository & IngestionRepository;
