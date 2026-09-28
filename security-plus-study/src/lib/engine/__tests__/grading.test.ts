import { describe, expect, it } from "vitest";

import { gradeAnswer, validateSelection } from "../grading";

describe("gradeAnswer", () => {
  it("marks an exact single-answer match as correct", () => {
    expect(gradeAnswer(["b"], ["b"]).isCorrect).toBe(true);
  });

  it("marks a wrong single answer as incorrect and reports the miss", () => {
    const result = gradeAnswer(["b"], ["c"]);
    expect(result.isCorrect).toBe(false);
    expect(result.incorrectlySelected).toEqual(["c"]);
    expect(result.missed).toEqual(["b"]);
  });

  describe("multiple-answer questions", () => {
    it("requires every correct choice", () => {
      expect(gradeAnswer(["a", "c"], ["a"]).isCorrect).toBe(false);
    });

    it("is order-independent", () => {
      expect(gradeAnswer(["a", "c"], ["c", "a"]).isCorrect).toBe(true);
    });

    it("gives no partial credit when an extra wrong choice is selected", () => {
      const result = gradeAnswer(["a", "c"], ["a", "c", "d"]);
      expect(result.isCorrect).toBe(false);
      expect(result.correctlySelected.sort()).toEqual(["a", "c"]);
      expect(result.incorrectlySelected).toEqual(["d"]);
    });

    it("ignores duplicate selections", () => {
      expect(gradeAnswer(["a", "c"], ["a", "a", "c"]).isCorrect).toBe(true);
    });
  });

  it("never grades an empty answer key as correct", () => {
    expect(gradeAnswer([], []).isCorrect).toBe(false);
  });
});

describe("validateSelection", () => {
  const choices = ["a", "b", "c", "d"];

  it("accepts a valid selection", () => {
    expect(validateSelection(choices, 2, ["a", "b"])).toBeNull();
  });

  it("rejects empty, unknown, duplicate and wrong-count selections", () => {
    expect(validateSelection(choices, 1, [])).toBe("empty");
    expect(validateSelection(choices, 1, ["z"])).toBe("unknown_choice");
    expect(validateSelection(choices, 2, ["a", "a"])).toBe("duplicate");
    expect(validateSelection(choices, 2, ["a"])).toBe("wrong_count");
  });

  it("allows partial selections when exact count is not required (exam autosave)", () => {
    expect(validateSelection(choices, 3, ["a"], { requireExactCount: false })).toBeNull();
    expect(validateSelection(choices, 1, ["a", "b"], { requireExactCount: false })).toBe("wrong_count");
  });
});
