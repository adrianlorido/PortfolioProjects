import { describe, expect, it } from "vitest";
import {
  MAX_MONEY,
  MIN_MONEY,
  MoneyError,
  add,
  moneyFromBigInt,
  multiplyByFraction,
  negate,
  subtract,
  dollars,
  formatBasisPoints,
  formatMoney,
  money,
  parseMoney,
  ratioInBasisPoints,
  sum,
  toDecimalString,
} from "./money";

describe("money: safe integer minor units (requirement G)", () => {
  it("0.10 + 0.20 is exactly 0.30, unlike floating point", () => {
    expect(0.1 + 0.2).not.toBe(0.3); // the bug we are avoiding
    expect(add(parseMoney("0.10"), parseMoney("0.20"))).toBe(parseMoney("0.30"));
    expect(toDecimalString(add(parseMoney("0.1"), parseMoney("0.2")))).toBe("0.30");
  });

  it("summing one cent 10,000 times is exactly $100.00", () => {
    let float = 0;
    for (let i = 0; i < 10_000; i++) float += 0.01;
    expect(float).not.toBe(100); // float drift
    const cents = sum(Array.from({ length: 10_000 }, () => parseMoney("0.01")));
    expect(cents).toBe(10_000);
    expect(toDecimalString(cents)).toBe("100.00");
  });

  it("classic problem values convert exactly", () => {
    expect(1.15 * 100).not.toBe(115);
    expect(parseMoney("1.15")).toBe(115);
    expect(dollars(0.29)).toBe(29);
    expect(dollars(19.99)).toBe(1999);
    expect(dollars(-4.35)).toBe(-435);
  });

  it("mixed payments and refunds net to exact values", () => {
    const values = ["19.99", "-5.01", "0.07", "1234.56", "-1234.56"].map(parseMoney);
    expect(sum(values)).toBe(1505);
  });

  it("rejects fractional minor units and unsafe magnitudes", () => {
    expect(() => money(10.5)).toThrow(MoneyError);
    expect(() => money(Number.MAX_SAFE_INTEGER + 1)).toThrow(MoneyError);
    expect(() => add(money(Number.MAX_SAFE_INTEGER), money(1))).toThrow(MoneyError);
    expect(() => money(Number.NaN)).toThrow(MoneyError);
  });

  it("parseMoney rejects ambiguous input instead of rounding", () => {
    expect(() => parseMoney("1.234")).toThrow(MoneyError);
    expect(() => parseMoney("abc")).toThrow(MoneyError);
    expect(() => parseMoney("1e3")).toThrow(MoneyError);
    expect(() => parseMoney("99999999999999999")).toThrow(MoneyError);
    expect(parseMoney("$1,234.5")).toBe(123450);
    expect(parseMoney("-0.07")).toBe(-7);
    expect(() => dollars(1.005)).toThrow(MoneyError);
  });

  it("normalises negative zero", () => {
    expect(Object.is(money(-0), 0)).toBe(true);
  });

  it("formats from the exact decimal string", () => {
    expect(formatMoney(money(123456789))).toBe("$1,234,567.89");
    expect(formatMoney(money(-5))).toBe("-$0.05");
    expect(formatMoney(money(2500), { showPlus: true })).toBe("+$25.00");
    expect(formatMoney(money(0), { showPlus: true })).toBe("$0.00");
    // Large but safe value keeps every cent.
    expect(formatMoney(money(9_007_199_254_740_991))).toBe("$90,071,992,547,409.91");
  });

  it("computes ratios in integer basis points with half-away-from-zero rounding", () => {
    expect(ratioInBasisPoints(money(150000), money(500000))).toBe(3000);
    expect(ratioInBasisPoints(money(1), money(3))).toBe(3333);
    expect(ratioInBasisPoints(money(2), money(3))).toBe(6667);
    expect(ratioInBasisPoints(money(-1), money(3))).toBe(-3333);
    expect(ratioInBasisPoints(money(1), money(0))).toBeNull();
  });

  it("formats basis points as percentages with rounding", () => {
    expect(formatBasisPoints(3000)).toBe("30.0%");
    expect(formatBasisPoints(3049)).toBe("30.5%");
    expect(formatBasisPoints(-1234, 2)).toBe("-12.34%");
    expect(formatBasisPoints(3050, 0)).toBe("31%");
    expect(formatBasisPoints(null)).toBe("—");
  });
});

describe("money: safe-integer boundaries (review area A)", () => {
  const MAX = Number.MAX_SAFE_INTEGER; // 9,007,199,254,740,991 minor units = $90,071,992,547,409.91

  it("the largest representable amount is $90,071,992,547,409.91", () => {
    expect(MAX_MONEY).toBe(9_007_199_254_740_991);
    expect(toDecimalString(MAX_MONEY)).toBe("90071992547409.91");
    expect(toDecimalString(MIN_MONEY)).toBe("-90071992547409.91");
    expect(parseMoney("90071992547409.91")).toBe(MAX);
    expect(() => parseMoney("90071992547409.92")).toThrow(MoneyError);
    expect(() => parseMoney("-90071992547409.92")).toThrow(MoneyError);
  });

  it("add/subtract/negate/sum throw instead of silently leaving the safe range", () => {
    expect(() => add(MAX_MONEY, money(1))).toThrow(MoneyError);
    expect(() => subtract(MIN_MONEY, money(1))).toThrow(MoneyError);
    expect(() => add(MIN_MONEY, money(-1))).toThrow(MoneyError);
    expect(() => sum([MAX_MONEY, money(1), money(-1)])).toThrow(MoneyError); // intermediate overflow is caught
    expect(negate(MIN_MONEY)).toBe(MAX); // symmetric range: negation is always safe
    expect(add(MAX_MONEY, money(-1))).toBe(MAX - 1);
  });

  it("exact decimal output near the limit (no division rounding)", () => {
    expect(toDecimalString(money(9_007_199_254_740_899))).toBe("90071992547408.99");
    expect(toDecimalString(money(-1))).toBe("-0.01");
  });

  it("multiplyByFraction multiplies in BigInt, so a product above 2^53 is still exact", () => {
    // Found by randomized search: the float product 4356127882428965 × 757 exceeds 2^53 and
    // rounds, so the naive formula is off by one cent. The BigInt path is exact.
    const a = money(4_356_127_882_428_965);
    expect(Math.round((a * 757) / 1739)).toBe(1_896_255_783_208_009); // float: wrong
    expect(multiplyByFraction(a, 757, 1739)).toBe(1_896_255_783_208_008); // exact: floor(3297588806998726505/1739 + 0.5)
    expect(BigInt(1_896_255_783_208_008) * 1739n <= 4_356_127_882_428_965n * 757n).toBe(true);
    expect(multiplyByFraction(money(1_680_000), 590, 120_000)).toBe(8260); // 5.90% APR monthly on $16,800
    expect(multiplyByFraction(money(5), 1, 2)).toBe(3); // half away from zero
    expect(multiplyByFraction(money(-5), 1, 2)).toBe(-3);
    expect(multiplyByFraction(money(-4), 1, 3)).toBe(-1);
  });

  it("multiplyByFraction rejects results outside the safe range and non-integer factors", () => {
    expect(() => multiplyByFraction(MAX_MONEY, 2, 1)).toThrow(MoneyError);
    expect(() => multiplyByFraction(money(100), 1.5, 1)).toThrow(MoneyError);
    expect(() => multiplyByFraction(money(100), 1, 0)).toThrow(MoneyError);
    expect(() => multiplyByFraction(10.5 as never, 1, 1)).toThrow(MoneyError);
  });

  it("ratioInBasisPoints refuses to return an unsafe number", () => {
    expect(() => ratioInBasisPoints(MAX_MONEY, money(1))).toThrow(MoneyError);
    expect(ratioInBasisPoints(MAX_MONEY, MAX_MONEY)).toBe(10_000);
  });

  it("moneyFromBigInt guards the BigInt -> number conversion", () => {
    expect(moneyFromBigInt(9_007_199_254_740_991n)).toBe(MAX);
    expect(() => moneyFromBigInt(9_007_199_254_740_992n)).toThrow(MoneyError);
    expect(() => moneyFromBigInt(-9_007_199_254_740_992n)).toThrow(MoneyError);
  });
});
