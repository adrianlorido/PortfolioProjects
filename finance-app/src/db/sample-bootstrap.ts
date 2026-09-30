import type { CategoryRule, User } from "@/domain/models";
import { SAMPLE_AS_OF_TIMESTAMP, SAMPLE_INSTITUTIONS, type SampleDataset, generateSampleDataset } from "@/integrations/sample/dataset";
import { SampleFinancialDataProvider } from "@/integrations/sample/provider";
import { SAMPLE_RULES } from "@/integrations/sample/rules";
import { buildDefaultTaxonomy, categoryIdFor } from "@/modules/categories/taxonomy";
import { connectInstitution, syncConnection } from "@/modules/sync/ingest";
import { InMemoryFinanceRepository } from "./in-memory-repository";

export const SAMPLE_USER: User = { id: "sample-user", displayName: "Alex Sample" };
export { SAMPLE_AS_OF_DATE as SAMPLE_DATA_AS_OF } from "@/integrations/sample/dataset";

/**
 * Builds a fully populated, deterministic in-memory repository for sample mode:
 * seed user + taxonomy + rules, then connect and sync every sample institution through the
 * same provider/ingestion path a real aggregator would use.
 */
export async function createSampleRepository(dataset: SampleDataset = generateSampleDataset()): Promise<InMemoryFinanceRepository> {
  const repo = new InMemoryFinanceRepository();
  const userId = SAMPLE_USER.id;
  repo.seedUser(SAMPLE_USER);

  const { groups, categories } = buildDefaultTaxonomy(userId);
  repo.seedTaxonomy(groups, categories);
  repo.seedRules(
    SAMPLE_RULES.map(
      (rule, index): CategoryRule => ({
        id: `rule_${String(index + 1).padStart(3, "0")}`,
        userId,
        categoryId: categoryIdFor(rule.categorySlug),
        matchField: "original_description",
        matchType: rule.matchType ?? "contains",
        pattern: rule.pattern,
        priority: (index + 1) * 10,
        isActive: true,
      }),
    ),
  );

  const deps = { repo, provider: new SampleFinancialDataProvider(dataset), now: () => SAMPLE_AS_OF_TIMESTAMP };
  for (const institution of Object.values(SAMPLE_INSTITUTIONS)) {
    const connection = await connectInstitution(deps, userId, institution.id);
    await syncConnection(deps, userId, connection.id);
  }

  // Demonstrate user annotations (exclusions, notes) exactly as the UI would apply them.
  const transactions = await repo.listTransactions(userId);
  for (const annotation of dataset.annotations) {
    const tx = transactions.find((t) => t.externalTransactionId === annotation.externalTransactionId);
    if (!tx) throw new Error(`Sample annotation target missing: ${annotation.externalTransactionId}`);
    await repo.updateTransactionUserFields(
      userId,
      tx.id,
      { notes: annotation.notes, excludedFromReports: annotation.excludedFromReports },
      SAMPLE_AS_OF_TIMESTAMP,
    );
  }
  return repo;
}
