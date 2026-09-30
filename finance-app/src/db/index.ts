import "server-only";
import { getServerEnv } from "@/lib/env";
import type { FinanceRepository } from "./repository";
import { SAMPLE_DATA_AS_OF, createSampleRepository } from "./sample-bootstrap";

// Kept on globalThis so dev-mode hot reloads don't re-seed (and drop edits) on every change.
const globalStore = globalThis as unknown as { __financeRepository?: Promise<FinanceRepository> };

/**
 * The single entry point to data access. Server-only.
 * Sample mode: one in-memory, per-process store (edits reset when the server restarts).
 */
export function getRepository(): Promise<FinanceRepository> {
  const { DATA_MODE } = getServerEnv();
  if (DATA_MODE !== "sample") {
    throw new Error(`DATA_MODE="${DATA_MODE}" is not implemented in Phase 1. Use DATA_MODE=sample.`);
  }
  globalStore.__financeRepository ??= createSampleRepository();
  return globalStore.__financeRepository;
}

/** What the UI needs to label the data source. Sample mode: the fixed as-of date of the dataset. */
export function getDataSourceInfo(): { mode: "sample"; asOf: string } | { mode: "supabase"; asOf: null } {
  return getServerEnv().DATA_MODE === "sample" ? { mode: "sample", asOf: SAMPLE_DATA_AS_OF } : { mode: "supabase", asOf: null };
}
