import type { CurrencyCode } from "./money";

export class MixedCurrencyError extends Error {
  constructor(currencies: Iterable<CurrencyCode>) {
    super(`Cannot aggregate mixed currencies without FX conversion: ${[...currencies].join(", ")}`);
    this.name = "MixedCurrencyError";
  }
}

/**
 * Phase 1 has no FX conversion, so aggregating across currencies would silently add dollars
 * to euros. Refuse instead. Returns the single currency, or null for an empty input.
 */
export function assertSingleCurrency(items: Iterable<{ currency: CurrencyCode }>): CurrencyCode | null {
  const seen = new Set<CurrencyCode>();
  for (const item of items) seen.add(item.currency);
  if (seen.size > 1) throw new MixedCurrencyError(seen);
  return seen.values().next().value ?? null;
}
