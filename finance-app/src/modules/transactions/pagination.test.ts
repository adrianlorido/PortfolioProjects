import { describe, expect, it } from "vitest";
import { paginate } from "./pagination";

describe("paginate", () => {
  const items = Array.from({ length: 120 }, (_, i) => i);
  it("returns the requested page", () => {
    expect(paginate(items, "2", 50)).toMatchObject({ page: 2, pageCount: 3, total: 120, items: items.slice(50, 100) });
  });
  it("clamps and sanitises the page number", () => {
    expect(paginate(items, "99", 50).page).toBe(3);
    expect(paginate(items, "0", 50).page).toBe(1);
    expect(paginate(items, "-1", 50).page).toBe(1);
    expect(paginate(items, "abc", 50).page).toBe(1);
    expect(paginate(items, undefined, 50).page).toBe(1);
  });
  it("has one empty page for no items", () => {
    expect(paginate([], "1", 50)).toEqual({ items: [], page: 1, pageCount: 1, total: 0 });
  });
});
