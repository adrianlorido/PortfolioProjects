import { describe, expect, it } from "vitest";
import { MoneyError } from "@/modules/finance/money";
import { moneyFromDb, moneyToDb } from "./money-codec";

describe("moneyFromDb", () => {
  it("accepts integer strings, bigints and safe-integer numbers", () => {
    expect(moneyFromDb("-4512")).toBe(-4512);
    expect(moneyFromDb("0")).toBe(0);
    expect(moneyFromDb(123n)).toBe(123);
    expect(moneyFromDb(9_007_199_254_740_991)).toBe(9_007_199_254_740_991);
    expect(moneyFromDb("9007199254740991")).toBe(9_007_199_254_740_991);
    expect(moneyFromDb("-9007199254740991")).toBe(-9_007_199_254_740_991);
  });

  it("rejects bigint values beyond 2^53-1 instead of rounding them", () => {
    // What a Postgres bigint could hold without the CHECK constraint:
    expect(() => moneyFromDb("9007199254740992")).toThrow(MoneyError);
    expect(() => moneyFromDb("9223372036854775807")).toThrow(MoneyError);
    expect(() => moneyFromDb(9_223_372_036_854_775_807n)).toThrow(MoneyError);
    // What JSON.parse produces from the JSON number 9007199254740993 (already rounded):
    expect(() => moneyFromDb(JSON.parse("9007199254740993"))).toThrow(MoneyError);
  });

  it("rejects non-integers and junk", () => {
    for (const bad of ["12.5", "1e3", "", " 1", "+1", "abc", "--1", "01", 12.5, Number.NaN, Infinity, null, undefined, {}, true]) {
      expect(() => moneyFromDb(bad)).toThrow(MoneyError);
    }
  });

  it("round-trips through moneyToDb", () => {
    for (const v of [0, 1, -1, 4512, -9_007_199_254_740_991, 9_007_199_254_740_991]) {
      expect(moneyFromDb(moneyToDb(moneyFromDb(v)))).toBe(v);
    }
  });
});
