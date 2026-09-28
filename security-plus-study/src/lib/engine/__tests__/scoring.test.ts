import { describe, expect, it } from "vitest";

import { EXAM_CONFIG } from "@/lib/config/exam";
import { makeCatalog, makeQuestion } from "@/lib/test-utils";
import type { DomainId } from "@/lib/types";
import { allocateByWeight, buildExam } from "../exam-builder";
import { createRng } from "../random";
import { domainBreakdown, percent, scoreExam, toScaledScore, weakestTopicScores } from "../scoring";

describe("percent and scaled score", () => {
  it("rounds percent to one decimal", () => {
    expect(percent(2, 3)).toBe(66.7);
    expect(percent(0, 0)).toBe(0);
  });

  it("maps 0-100% linearly onto the configured scale", () => {
    expect(toScaledScore(0)).toBe(EXAM_CONFIG.scaleMin);
    expect(toScaledScore(100)).toBe(EXAM_CONFIG.scaleMax);
    expect(toScaledScore(50)).toBe(500);
    expect(toScaledScore(150)).toBe(900);
  });
});

describe("scoreExam", () => {
  const q1 = makeQuestion("q1", { domainId: 1, topics: ["pki"] });
  const q2 = makeQuestion("q2", { domainId: 2, topics: ["malware"] });
  const q3 = makeQuestion("q3", {
    domainId: 2,
    topics: ["malware", "pki"],
    questionType: "multiple",
    correctCount: 2,
    choices: [
      { id: "q3-a", text: "A", isCorrect: true, explanation: null },
      { id: "q3-b", text: "B", isCorrect: true, explanation: null },
      { id: "q3-c", text: "C", isCorrect: false, explanation: null },
      { id: "q3-d", text: "D", isCorrect: false, explanation: null },
    ],
  });
  const q4 = makeQuestion("q4", { domainId: 4, topics: ["siem"] });

  it("counts correct, incorrect and unanswered questions", () => {
    const result = scoreExam(
      [q1, q2, q3, q4],
      {
        q1: { selectedChoiceIds: ["q1-a"], flagged: false },
        q2: { selectedChoiceIds: ["q2-b"], flagged: true },
        q3: { selectedChoiceIds: ["q3-a"], flagged: false }, // partial multi-select = incorrect
      },
      600,
    );
    expect(result).toMatchObject({ total: 4, correct: 1, incorrect: 2, unanswered: 1, percent: 25, timeUsedSeconds: 600, avgSecondsPerQuestion: 150 });
    expect(result.passed).toBe(false);
    expect(result.questions.find((q) => q.questionId === "q2")?.flagged).toBe(true);
  });

  it("builds a per-domain breakdown", () => {
    const result = scoreExam(
      [q1, q2, q3],
      { q1: { selectedChoiceIds: ["q1-a"], flagged: false }, q3: { selectedChoiceIds: ["q3-a", "q3-b"], flagged: false } },
      60,
    );
    expect(result.domainBreakdown).toEqual([
      { domainId: 1, total: 1, correct: 1, percent: 100 },
      { domainId: 2, total: 2, correct: 1, percent: 50 },
    ]);
  });

  it("passes when the scaled score reaches the passing score", () => {
    const all = Array.from({ length: 10 }, (_, i) => makeQuestion(`p${i}`));
    const responses = Object.fromEntries(all.slice(0, 9).map((q) => [q.id, { selectedChoiceIds: [`${q.id}-a`], flagged: false }]));
    const result = scoreExam(all, responses, 100);
    expect(result.scaledScore).toBe(820);
    expect(result.passed).toBe(true);
  });
});

describe("weakestTopicScores", () => {
  it("ranks topics by accuracy and ignores perfect topics", () => {
    const items = [
      { questionId: "1", domainId: 1 as DomainId, topics: ["a"], isCorrect: false },
      { questionId: "2", domainId: 1 as DomainId, topics: ["a"], isCorrect: true },
      { questionId: "3", domainId: 1 as DomainId, topics: ["b"], isCorrect: false },
      { questionId: "4", domainId: 1 as DomainId, topics: ["b"], isCorrect: false },
      { questionId: "5", domainId: 1 as DomainId, topics: ["c"], isCorrect: true },
      { questionId: "6", domainId: 1 as DomainId, topics: ["c"], isCorrect: true },
    ];
    expect(weakestTopicScores(items).map((t) => t.topicId)).toEqual(["b", "a"]);
    expect(domainBreakdown(items)[0]).toMatchObject({ total: 6, correct: 3 });
  });
});

describe("exam builder", () => {
  it("allocates by domain weight and sums to the requested count", () => {
    const allocation = allocateByWeight(90, { 1: 100, 2: 100, 3: 100, 4: 100, 5: 100 });
    expect(Object.values(allocation).reduce((a, b) => a + b, 0)).toBe(90);
    expect(allocation[4]).toBeGreaterThan(allocation[1]);
    expect(allocation).toEqual({ 1: 11, 2: 20, 3: 16, 4: 25, 5: 18 });
  });

  it("redistributes when a domain lacks questions", () => {
    const allocation = allocateByWeight(40, { 1: 2, 2: 100, 3: 100, 4: 100, 5: 100 });
    expect(allocation[1]).toBe(2);
    expect(Object.values(allocation).reduce((a, b) => a + b, 0)).toBe(40);
  });

  it("never exceeds the available questions", () => {
    const allocation = allocateByWeight(90, { 1: 3, 2: 4, 3: 5, 4: 6, 5: 7 });
    expect(allocation).toEqual({ 1: 3, 2: 4, 3: 5, 4: 6, 5: 7 });
  });

  it("builds a mixed, unique exam", () => {
    const ids = buildExam(makeCatalog(30), 45, createRng(7));
    expect(ids).toHaveLength(45);
    expect(new Set(ids).size).toBe(45);
    // Mixed: the first 10 questions should not all come from one domain.
    expect(new Set(ids.slice(0, 10).map((id) => id.slice(0, 2))).size).toBeGreaterThan(1);
  });
});
