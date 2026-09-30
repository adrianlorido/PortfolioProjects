import { describe, expect, it } from "vitest";
import { addMonths, isIsoDate, monthPeriod, monthRange } from "./period";

describe("periods", () => {
  it("builds calendar-month periods including leap years", () => {
    expect(monthPeriod("2026-09")).toEqual({ start: "2026-09-01", end: "2026-09-30" });
    expect(monthPeriod("2024-02")).toEqual({ start: "2024-02-01", end: "2024-02-29" });
    expect(monthPeriod("2026-02")).toEqual({ start: "2026-02-01", end: "2026-02-28" });
    expect(() => monthPeriod("2026-13")).toThrow(RangeError);
  });

  it("adds months across year boundaries", () => {
    expect(addMonths("2026-12", 1)).toBe("2027-01");
    expect(addMonths("2026-01", -1)).toBe("2025-12");
    expect(monthRange("2025-11", "2026-02")).toEqual(["2025-11", "2025-12", "2026-01", "2026-02"]);
  });

  it("validates calendar dates", () => {
    expect(isIsoDate("2026-02-29")).toBe(false);
    expect(isIsoDate("2024-02-29")).toBe(true);
    expect(isIsoDate("2026-9-1")).toBe(false);
  });
});
