import type { TransactionSplit } from "@/domain/models";
import { type Money, assertMoney, sum } from "./money";

export const MAX_SPLIT_LINES = 20;

export class SplitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SplitError";
  }
}

/**
 * Split invariants:
 *   - zero lines = not split; otherwise 2..MAX_SPLIT_LINES lines;
 *   - every line is a non-zero safe integer amount (mixed signs are allowed, e.g. a paycheck
 *     split into gross pay and withheld tax);
 *   - lines sum EXACTLY to the parent amount, so splitting can never create or destroy money.
 */
export function validateSplits(parentAmount: Money, splits: readonly TransactionSplit[]): void {
  if (splits.length === 0) return;
  if (splits.length === 1) throw new SplitError("A split needs at least two lines");
  if (splits.length > MAX_SPLIT_LINES) throw new SplitError(`A split can have at most ${MAX_SPLIT_LINES} lines`);
  for (const line of splits) {
    assertMoney(line.amount, "split amount");
    if (line.amount === 0) throw new SplitError("Split lines must be non-zero");
  }
  const total = sum(splits.map((s) => s.amount));
  if (total !== parentAmount) {
    throw new SplitError(`Split lines sum to ${total} but the transaction amount is ${parentAmount}`);
  }
}
