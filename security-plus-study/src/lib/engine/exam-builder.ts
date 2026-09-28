import { DOMAINS } from "@/lib/config/domains";
import type { CatalogEntry, DomainId } from "@/lib/types";
import { type Rng, shuffle } from "./random";

/**
 * Allocate `count` questions across domains by weight using the largest-remainder
 * method, never asking a domain for more questions than it has. Any shortfall is
 * redistributed to domains with spare capacity.
 */
export function allocateByWeight(
  count: number,
  available: Record<DomainId, number>,
  weights: Record<DomainId, number> = Object.fromEntries(DOMAINS.map((d) => [d.id, d.weight])) as Record<DomainId, number>,
): Record<DomainId, number> {
  const ids = DOMAINS.map((d) => d.id);
  const totalAvailable = ids.reduce((s, id) => s + (available[id] ?? 0), 0);
  let remaining = Math.min(count, totalAvailable);
  const allocation = Object.fromEntries(ids.map((id) => [id, 0])) as Record<DomainId, number>;

  // Iterate because capping one domain frees capacity for the others.
  while (remaining > 0) {
    const open = ids.filter((id) => allocation[id] < (available[id] ?? 0));
    const weightSum = open.reduce((s, id) => s + (weights[id] ?? 0), 0) || open.length;
    const raw = open.map((id) => ({ id, exact: (remaining * (weightSum ? weights[id] ?? 1 : 1)) / weightSum }));
    let assigned = 0;
    for (const r of raw) {
      const add = Math.min(Math.floor(r.exact), (available[r.id] ?? 0) - allocation[r.id]);
      allocation[r.id] += add;
      assigned += add;
    }
    let leftover = remaining - assigned;
    const byRemainder = raw
      .map((r) => ({ id: r.id, rem: r.exact - Math.floor(r.exact) }))
      .sort((a, b) => b.rem - a.rem || a.id - b.id);
    for (const r of byRemainder) {
      if (leftover <= 0) break;
      if (allocation[r.id] < (available[r.id] ?? 0)) {
        allocation[r.id] += 1;
        leftover -= 1;
        assigned += 1;
      }
    }
    if (assigned === 0) break;
    remaining -= assigned;
  }
  return allocation;
}

export function buildExam(
  catalog: readonly CatalogEntry[],
  count: number,
  rng: Rng,
  { useDomainWeights = true }: { useDomainWeights?: boolean } = {},
): string[] {
  if (!useDomainWeights) return shuffle(catalog, rng).slice(0, count).map((q) => q.id);

  const byDomain = new Map<DomainId, CatalogEntry[]>();
  for (const q of catalog) {
    const list = byDomain.get(q.domainId) ?? [];
    list.push(q);
    byDomain.set(q.domainId, list);
  }
  const available = Object.fromEntries(DOMAINS.map((d) => [d.id, byDomain.get(d.id)?.length ?? 0])) as Record<DomainId, number>;
  const allocation = allocateByWeight(count, available);

  const picked: string[] = [];
  for (const d of DOMAINS) {
    const pool = shuffle(byDomain.get(d.id) ?? [], rng);
    picked.push(...pool.slice(0, allocation[d.id]).map((q) => q.id));
  }
  return shuffle(picked, rng);
}
