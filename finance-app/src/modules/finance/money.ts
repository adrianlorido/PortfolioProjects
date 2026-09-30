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
 *
 * Postgres stores the same value in `bigint` columns (`*_minor`).
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
  if (signed > BigInt(Number.MAX_SAFE_INTEGER) || signed < BigInt(Number.MIN_SAFE_INTEGER)) {
    throw new MoneyError(`Money value out of range: "${input}"`);
  }
  return money(Number(signed));
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

/** Basis points: 10_000 = 100%. */
export type BasisPoints = number;

/**
 * round(numerator / denominator * 10_000) using BigInt, half away from zero.
 * Returns null when the denominator is zero.
 */
export function ratioInBasisPoints(numerator: Money, denominator: Money): BasisPoints | null {
  if (denominator === 0) return null;
  const n = BigInt(numerator) * 10_000n;
  const d = BigInt(denominator);
  const negative = n < 0n !== d < 0n;
  const absN = n < 0n ? -n : n;
  const absD = d < 0n ? -d : d;
  const rounded = (absN * 2n + absD) / (absD * 2n);
  return Number(negative ? -rounded : rounded);
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
