import type {
  ConnectInstitutionInput,
  ConnectInstitutionResult,
  FinancialDataProvider,
  NormalizedAccount,
  NormalizedBalance,
  ProviderConnectionRef,
  TransactionSyncPage,
} from "../provider";
import { type SampleDataset, generateSampleDataset } from "./dataset";

const PAGE_SIZE = 100;
const CURSOR_PREFIX = "sample-offset:";

/**
 * Offline provider backed by the deterministic sample dataset. It honours the same
 * contract as a real aggregator (cursor-paged sync, per-connection scoping) so the
 * ingestion pipeline is exercised end-to-end without any network access.
 */
export class SampleFinancialDataProvider implements FinancialDataProvider {
  readonly provider = "sample" as const;
  private readonly dataset: SampleDataset;

  constructor(dataset: SampleDataset = generateSampleDataset()) {
    this.dataset = dataset;
  }

  /** In sample mode the "public token" is simply the sample institution id. */
  async connectInstitution({ publicToken }: ConnectInstitutionInput): Promise<ConnectInstitutionResult> {
    const institution = this.dataset.institutions.find((i) => i.id === publicToken);
    if (!institution) throw new Error("Unknown sample institution");
    return { providerConnectionId: institution.id, institutionName: institution.name };
  }

  async getAccounts(connection: ProviderConnectionRef): Promise<NormalizedAccount[]> {
    return this.dataset.accounts
      .filter((a) => a.institutionId === connection.providerConnectionId)
      .map(({ institutionId: _institutionId, ...account }) => account);
  }

  async syncTransactions(connection: ProviderConnectionRef, cursor: string | null): Promise<TransactionSyncPage> {
    const all = this.dataset.transactions.filter((t) => t.institutionId === connection.providerConnectionId);
    const offset = cursor ? Number(cursor.slice(CURSOR_PREFIX.length)) : 0;
    if (!Number.isInteger(offset) || offset < 0) throw new Error("Invalid sample sync cursor");
    const page = all.slice(offset, offset + PAGE_SIZE);
    const nextOffset = offset + page.length;
    return {
      added: page.map(({ institutionId: _institutionId, ...t }) => t),
      modified: [],
      removed: [],
      nextCursor: `${CURSOR_PREFIX}${nextOffset}`,
      hasMore: nextOffset < all.length,
    };
  }

  async getBalances(connection: ProviderConnectionRef): Promise<NormalizedBalance[]> {
    return this.dataset.balances
      .filter((b) => b.institutionId === connection.providerConnectionId)
      .map(({ institutionId: _institutionId, ...b }) => b);
  }
}
