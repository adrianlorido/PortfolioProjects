/**
 * Money representation
 * --------------------
 * All money is an integer count of minor units (cents for USD), typed as `Money`.
 *
 * - Integer addition/subtraction is exact in IEEE-754 doubles up to 2^53 - 1
 *   (~$90 trillion in cents), so sums never drift the way 0.1 + 0.2 does.
 * - Every constructor/operation asserts the result is a safe integer, so an
 *   overflow or an accidental fractional value fails loudly instead of silently.
 * - Decimal strings are converted by string parsing, never by `parseFloat * 100`.
 * - Ratios (savings rate) are integer basis points computed with BigInt.
 * - Scaling (interest = balance × rate) goes through multiplyByFraction(), which multiplies in
 *   BigInt so the intermediate product can't lose precision, then rounds once.
 *
 * Safe range: |value| <= Number.MAX_SAFE_INTEGER = 9,007,199,254,740,991 minor units
 * (= $90,071,992,547,409.91). Postgres `*_minor bigint` columns carry CHECK constraints
 * limiting them to the same range, and the database boundary converts values with
 * src/db/money-codec.ts (bigint values are never trusted to fit in a JS number unchecked).
 */

declare const moneyBrand: unique symbol;
export type Money = number & { readonly [moneyBrand]: "Money" };

/** ISO-4217 code. Phase 1 data is USD only; engine functions reject mixed currencies. */
export type CurrencyCode = string;

export const MINOR_UNITS_PER_MAJOR = 100;

export class MoneyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MoneyError";
  }
}

export function assertMoney(value: number, label = "amount"): asserts value is Money {
  if (!Number.isSafeInteger(value)) {
    throw new MoneyError(`${label} must be a safe integer number of minor units, got ${value}`);
  }
}

/** Wrap an integer count of minor units. Throws on non-integers or unsafe magnitudes. */
export function money(minorUnits: number): Money {
  assertMoney(minorUnits);
  // Normalise -0 so equality and formatting behave.
  return (minorUnits === 0 ? 0 : minorUnits) as Money;
}

export const ZERO = money(0);

/** Largest representable amount, in minor units. */
export const MAX_MONEY = money(Number.MAX_SAFE_INTEGER);
export const MIN_MONEY = money(Number.MIN_SAFE_INTEGER);

/** Converts a safe BigInt count of minor units to Money, rejecting anything out of range. */
export function moneyFromBigInt(value: bigint, label = "amount"): Money {
  if (value > BigInt(Number.MAX_SAFE_INTEGER) || value < BigInt(Number.MIN_SAFE_INTEGER)) {
    throw new MoneyError(`${label} ${value} is outside the safe money range`);
  }
  return money(Number(value));
}

export function add(a: Money, b: Money): Money {
  return money(a + b);
}

export function subtract(a: Money, b: Money): Money {
  return money(a - b);
}

export function negate(a: Money): Money {
  return money(-a);
}

export function abs(a: Money): Money {
  return money(Math.abs(a));
}

export function sum(values: Iterable<Money>): Money {
  let total = 0;
  for (const v of values) {
    total += v;
    // Check at every step so an intermediate overflow can't be masked by a later subtraction.
    assertMoney(total, "running total");
  }
  return money(total);
}

const DECIMAL_PATTERN = /^(-)?(\d+)(?:\.(\d{1,2}))?$/;

/**
 * Parse a decimal string such as "1234.5", "-0.07" or "1,234.56" into minor units.
 * Accepts at most two fractional digits; anything else is rejected rather than rounded.
 */
export function parseMoney(input: string): Money {
  const cleaned = input.trim().replace(/[$,\s]/g, "");
  const match = DECIMAL_PATTERN.exec(cleaned);
  if (!match) {
    throw new MoneyError(`Invalid money string: "${input}"`);
  }
  const [, sign, whole, fraction = ""] = match;
  const minor = BigInt(whole!) * 100n + BigInt(fraction.padEnd(2, "0"));
  const signed = sign ? -minor : minor;
  return moneyFromBigInt(signed, `Money string "${input}"`);
}

/** Convenience for tests and fixtures: dollars(12.34) === 1234. Only accepts whole cents. */
export function dollars(amount: number): Money {
  // Go through the decimal string so 0.29 * 100 = 28.999999999999996 can't happen.
  const fixed = amount.toFixed(2);
  if (Number(fixed) !== amount) {
    throw new MoneyError(`dollars() accepts at most two decimal places, got ${amount}`);
  }
  return parseMoney(fixed);
}

/** Exact decimal string, e.g. -123456 -> "-1234.56". */
export function toDecimalString(value: Money): string {
  const negative = value < 0;
  const magnitude = Math.abs(value);
  const major = Math.trunc(magnitude / MINOR_UNITS_PER_MAJOR);
  const minor = magnitude % MINOR_UNITS_PER_MAJOR;
  return `${negative ? "-" : ""}${major}.${String(minor).padStart(2, "0")}`;
}

const formatterCache = new Map<string, Intl.NumberFormat>();

function getFormatter(currency: CurrencyCode, compact: boolean, signDisplay: "auto" | "exceptZero"): Intl.NumberFormat {
  const key = `${currency}|${compact}|${signDisplay}`;
  let formatter = formatterCache.get(key);
  if (!formatter) {
    formatter = new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      signDisplay,
      ...(compact ? { notation: "compact", maximumFractionDigits: 1 } : {}),
    });
    formatterCache.set(key, formatter);
  }
  return formatter;
}

export interface FormatMoneyOptions {
  currency?: CurrencyCode;
  /** "$1.2K" style, for chart axes. */
  compact?: boolean;
  /** Show "+" for positive values. */
  showPlus?: boolean;
}

/**
 * Display formatting. The exact decimal string is handed to Intl (which accepts
 * decimal strings), so no float conversion happens even for display.
 */
export function formatMoney(value: Money, options: FormatMoneyOptions = {}): string {
  const { currency = "USD", compact = false, showPlus = false } = options;
  const formatter = getFormatter(currency, compact, showPlus ? "exceptZero" : "auto");
  // Intl.NumberFormat.format accepts decimal strings at runtime (ES2023); the TS lib types lag behind.
  return formatter.format(toDecimalString(value) as unknown as number);
}

/** Integer division rounding half away from zero (BigInt; `denominator` must be non-zero). */
function divideRoundHalfAwayFromZero(numerator: bigint, denominator: bigint): bigint {
  const negative = numerator < 0n !== denominator < 0n;
  const absN = numerator < 0n ? -numerator : numerator;
  const absD = denominator < 0n ? -denominator : denominator;
  const rounded = (absN * 2n + absD) / (absD * 2n);
  return negative ? -rounded : rounded;
}

/**
 * amount × numerator / denominator, rounded once (half away from zero) to whole minor units.
 * Example: monthly interest at 5.90% APR = multiplyByFraction(balance, 590, 10_000 * 12).
 * The product is formed in BigInt, so it can't overflow or lose precision even when
 * amount × numerator exceeds 2^53; only the final result must be in the safe range.
 * Numerator and denominator must be safe integers (express decimal rates as integer ratios).
 */
export function multiplyByFraction(amount: Money, numerator: number, denominator: number): Money {
  if (!Number.isSafeInteger(numerator) || !Number.isSafeInteger(denominator) || denominator === 0) {
    throw new MoneyError(`multiplyByFraction needs safe integer numerator/denominator (denominator != 0), got ${numerator}/${denominator}`);
  }
  assertMoney(amount);
  return moneyFromBigInt(divideRoundHalfAwayFromZero(BigInt(amount) * BigInt(numerator), BigInt(denominator)), "product");
}

/** Basis points: 10_000 = 100%. */
export type BasisPoints = number;

/**
 * round(numerator / denominator * 10_000) using BigInt, half away from zero.
 * Returns null when the denominator is zero. Throws if the ratio itself is too large to be a
 * safe integer (e.g. $90T of savings on $0.01 of income) rather than returning a lossy number.
 */
export function ratioInBasisPoints(numerator: Money, denominator: Money): BasisPoints | null {
  if (denominator === 0) return null;
  const bps = divideRoundHalfAwayFromZero(BigInt(numerator) * 10_000n, BigInt(denominator));
  if (bps > BigInt(Number.MAX_SAFE_INTEGER) || bps < BigInt(Number.MIN_SAFE_INTEGER)) {
    throw new MoneyError(`Ratio ${numerator}/${denominator} is too large to represent in basis points`);
  }
  return Number(bps);
}

export function formatBasisPoints(bps: BasisPoints | null, fractionDigits = 1): string {
  if (bps === null) return "—";
  if (![0, 1, 2].includes(fractionDigits)) throw new RangeError("fractionDigits must be 0, 1 or 2");
  const negative = bps < 0;
  // Integer rounding (half away from zero) to the requested precision.
  const unit = 10 ** (2 - fractionDigits);
  const scale = 10 ** fractionDigits;
  const rounded = Math.floor((Math.abs(bps) * 2 + unit) / (unit * 2));
  const whole = Math.floor(rounded / scale);
  const text = fractionDigits === 0 ? String(whole) : `${whole}.${String(rounded % scale).padStart(fractionDigits, "0")}`;
  return `${negative && rounded !== 0 ? "-" : ""}${text}%`;
}
