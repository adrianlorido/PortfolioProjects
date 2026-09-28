import { describe, expect, it } from "vitest";

import { looksLikeScenario, validateImport, validateQuestion } from "../import-schema";

const base = {
  question: "Which protocol provides centralized AAA for network device administration and encrypts the entire payload?",
  choices: ["RADIUS", "TACACS+", "LDAP", "Kerberos"],
  correctAnswers: [1],
  domain: "Security Operations",
  topics: ["TACACS+", "AAA"],
  difficulty: "medium",
  explanation: "TACACS+ encrypts the full packet body and separates authentication, authorization and accounting.",
  incorrectAnswerExplanations: ["RADIUS only encrypts the password.", null, "LDAP is a directory protocol.", "Kerberos is a ticketing system."],
  examClue: "Device administration + full encryption = TACACS+.",
  memoryTip: "TACACS+ = Total encryption, TCP.",
};

describe("validateQuestion", () => {
  it("normalizes a valid question", () => {
    const { input, issues } = validateQuestion(base, 0);
    expect(issues.filter((i) => i.severity === "error")).toEqual([]);
    expect(input).toMatchObject({ domainId: 4, difficulty: "medium", status: "published" });
    expect(input!.choices[1]).toMatchObject({ text: "TACACS+", isCorrect: true });
    expect(input!.choices[0].explanation).toBe("RADIUS only encrypts the password.");
    expect(input!.topics.map((t) => t.id)).toEqual(["tacacs", "aaa"]);
  });

  it("accepts letters, 1-based indexes and domain codes", () => {
    expect(validateQuestion({ ...base, correctAnswers: ["B"], domain: "4.0" }, 0).input?.choices[1].isCorrect).toBe(true);
    expect(validateQuestion({ ...base, correctAnswers: [2] }, 0, 1).input?.choices[1].isCorrect).toBe(true);
    expect(validateQuestion({ ...base, domain: 4 }, 0).input?.domainId).toBe(4);
  });

  it("infers multiple-answer questions", () => {
    const { input } = validateQuestion({ ...base, correctAnswers: [0, 1] }, 0);
    expect(input!.choices.filter((c) => c.isCorrect)).toHaveLength(2);
  });

  it("rejects structural problems with clear messages", () => {
    const cases: [object, string][] = [
      [{ ...base, choices: ["Only one"] }, "choices"],
      [{ ...base, correctAnswers: [7] }, "correctAnswers"],
      [{ ...base, correctAnswers: [] }, "correctAnswers"],
      [{ ...base, correctAnswers: [0, 1, 2, 3] }, "correctAnswers"],
      [{ ...base, domain: "Underwater Basket Weaving" }, "domain"],
      [{ ...base, topics: [] }, "topics"],
      [{ ...base, difficulty: "extreme" }, "difficulty"],
      [{ ...base, questionType: "multiple" }, "questionType"],
      [{ ...base, choices: ["Same", "same", "Other"] }, "choices.1"],
      [{ ...base, explanation: "" }, "explanation"],
      [{ ...base, id: "not-a-uuid" }, "id"],
    ];
    for (const [raw, path] of cases) {
      const { input, issues } = validateQuestion(raw, 3);
      expect(input, path).toBeNull();
      expect(issues.some((i) => i.severity === "error" && i.path === path && i.index === 3), path).toBe(true);
    }
  });

  it("reports missing required fields", () => {
    const { input, issues } = validateQuestion({ choices: ["a", "b"] }, 0);
    expect(input).toBeNull();
    expect(issues.map((i) => i.path)).toEqual(expect.arrayContaining(["question", "domain", "explanation"]));
  });

  it("reports every problem in one pass", () => {
    const { issues } = validateQuestion({ question: "x", choices: ["only one"], domain: "nope" }, 0);
    expect(issues.filter((i) => i.severity === "error").map((i) => i.path)).toEqual(
      expect.arrayContaining(["explanation", "choices", "domain", "topics"]),
    );
  });

  it("rejects wrong field types", () => {
    const { input, issues } = validateQuestion({ ...base, choices: "A, B, C" }, 0);
    expect(input).toBeNull();
    expect(issues[0]).toMatchObject({ path: "choices", severity: "error" });
  });

  it("warns (but accepts) when optional study aids are missing", () => {
    const { input, issues } = validateQuestion({ ...base, examClue: undefined, incorrectAnswerExplanations: undefined }, 0);
    expect(input).not.toBeNull();
    expect(issues.map((i) => i.path)).toEqual(expect.arrayContaining(["examClue", "incorrectAnswerExplanations"]));
    expect(issues.every((i) => i.severity === "warning")).toBe(true);
  });
});

describe("validateImport", () => {
  it("accepts a bare array and a wrapper object", () => {
    expect(validateImport([base]).valid).toHaveLength(1);
    expect(validateImport({ indexBase: 1, questions: [{ ...base, correctAnswers: [2] }] }).valid).toHaveLength(1);
  });

  it("parses JSON strings and reports invalid JSON", () => {
    expect(validateImport(JSON.stringify([base])).valid).toHaveLength(1);
    expect(validateImport("{nope").fileError).toMatch(/Invalid JSON/);
    expect(validateImport("[]").fileError).toMatch(/No questions/);
    expect(validateImport({ indexBase: 2, questions: [base] }).fileError).toMatch(/indexBase/);
  });

  it("keeps valid rows and reports errors per row", () => {
    const result = validateImport([base, { ...base, question: "Another one?", domain: "nope" }]);
    expect(result.total).toBe(2);
    expect(result.valid.map((v) => v.index)).toEqual([0]);
    expect(result.issues.find((i) => i.severity === "error")).toMatchObject({ index: 1, path: "domain" });
  });

  it("flags duplicates within the file and against the existing bank", () => {
    const dupes = validateImport([base, { ...base }]);
    expect(dupes.valid).toHaveLength(1);
    expect(dupes.issues.find((i) => i.index === 1)?.message).toMatch(/Duplicate/);

    const existing = validateImport([base], [base.question.toUpperCase()]);
    expect(existing.valid).toHaveLength(1);
    expect(existing.issues.some((i) => i.severity === "warning" && /already exists/.test(i.message))).toBe(true);
  });
});

describe("looksLikeScenario", () => {
  it("detects scenario-style stems", () => {
    expect(
      looksLikeScenario(
        "A security analyst notices repeated failed logins across many accounts from a single IP address within a few minutes. Which attack is MOST likely occurring?",
      ),
    ).toBe(true);
    expect(looksLikeScenario("What does AES stand for?")).toBe(false);
  });
});
