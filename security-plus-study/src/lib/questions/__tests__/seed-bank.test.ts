import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { DOMAIN_IDS } from "@/lib/config/domains";
import { buildSeedBank } from "../seed-builder";

const dir = path.resolve(__dirname, "../../../../data/questions");
const files = readdirSync(dir)
  .filter((f) => f.endsWith(".json"))
  .map((f) => JSON.parse(readFileSync(path.join(dir, f), "utf8")) as unknown);

describe("bundled question bank", () => {
  const bank = buildSeedBank(files);

  it("passes import validation with no errors", () => {
    expect(bank.issues).toEqual([]);
    expect(bank.questions.length).toBeGreaterThanOrEqual(150);
  });

  it("has stable, unique question and choice ids", () => {
    const again = buildSeedBank(files);
    expect(again.questions.map((q) => q.id)).toEqual(bank.questions.map((q) => q.id));
    expect(new Set(bank.questions.map((q) => q.id)).size).toBe(bank.questions.length);
    const choiceIds = bank.questions.flatMap((q) => q.choices.map((c) => c.id));
    expect(new Set(choiceIds).size).toBe(choiceIds.length);
  });

  it("covers every domain, difficulty and question style", () => {
    for (const d of DOMAIN_IDS) expect(bank.questions.filter((q) => q.domainId === d).length).toBeGreaterThanOrEqual(15);
    for (const level of ["easy", "medium", "hard"] as const) expect(bank.questions.some((q) => q.difficulty === level)).toBe(true);
    expect(bank.questions.filter((q) => q.questionType === "multiple").length).toBeGreaterThanOrEqual(8);
    expect(bank.questions.filter((q) => q.isScenario).length).toBeGreaterThanOrEqual(40);
    for (const phrase of ["BEST", "MOST", "FIRST"]) expect(bank.questions.some((q) => q.stem.includes(phrase))).toBe(true);
  });

  it("gives every question complete study aids", () => {
    for (const q of bank.questions) {
      expect(q.examClue, q.stem).not.toBe("");
      expect(q.memoryTip, q.stem).not.toBe("");
      for (const c of q.choices.filter((c) => !c.isCorrect)) expect(c.explanation, q.stem).toBeTruthy();
    }
  });
});
