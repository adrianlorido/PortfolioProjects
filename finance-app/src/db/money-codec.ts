/**
 * Money <-> database conversion. The ONLY place a database value becomes `Money`.
 *
 * PostgreSQL `bigint` holds up to 2^63-1, but a JS number is exact only to 2^53-1.
 * Drivers differ in how they hand a bigint over:
 *   - node-postgres (`pg`) returns int8 as a decimal STRING by default;
 *   - PostgREST / supabase-js serialise int8 as a JSON NUMBER, and JSON.parse silently
 *     rounds anything above 2^53 (e.g. 9007199254740993 becomes 9007199254740992).
 * Two defences make this safe:
 *   1. Every `*_minor` column has a CHECK constraint limiting it to ±(2^53-1)
 *      (migration 20261001000000), so the database can never hold a value JS can't represent.
 *   2. Repositories convert every money column through moneyFromDb(), which accepts a string,
 *      bigint or number and rejects anything that isn't an exact safe integer.
 * A Supabase repository should still prefer selecting `amount_minor::text` (or a view that
 * does) so the value travels as a string and is validated here.
 */
import { type Money, MoneyError, assertMoney, moneyFromBigInt } from "@/modules/finance/money";

const INTEGER_STRING = /^-?(0|[1-9]\d{0,18})$/;

export function moneyFromDb(value: unknown, column = "amount_minor"): Money {
  if (typeof value === "string") {
    if (!INTEGER_STRING.test(value)) throw new MoneyError(`${column}: "${value}" is not an integer string`);
    return moneyFromBigInt(BigInt(value), column);
  }
  if (typeof value === "bigint") return moneyFromBigInt(value, column);
  if (typeof value === "number") {
    // A number can only be trusted if it is a safe integer; anything else may already have
    // been rounded by JSON.parse, and we cannot know the original value.
    assertMoney(value, column);
    return value === 0 ? (0 as Money) : value;
  }
  throw new MoneyError(`${column}: unsupported database value type ${value === null ? "null" : typeof value}`);
}

/** Serialise for a database write. Strings avoid any driver-side float coercion. */
export function moneyToDb(value: Money): string {
  assertMoney(value);
  return String(value);
}
