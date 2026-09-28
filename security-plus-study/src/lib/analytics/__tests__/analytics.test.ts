import { describe, expect, it } from "vitest";

import { makeEntry, makeState, makeTopicStat } from "@/lib/test-utils";
import type { DailyActivity } from "@/lib/types";
import { addDays, dateRange, diffDays, toLocalDate } from "../dates";
import {
  activityTimeline,
  bankStatsFromCatalog,
  difficultyPerformance,
  domainPerformance,
  masteryDistribution,
  masteryFraction,
  overviewStats,
  readinessScore,
  topicPerformance,
} from "../stats";
import { computeStreaks } from "../streaks";
import { rankTopics, updateRecentAccuracy, weakestTopics } from "../weak-topics";

const NOW = new Date("2026-03-10T12:00:00.000Z");

function day(date: string, answered: number, correct = answered): DailyActivity {
  return { date, answered, correct, timeSpentMs: answered * 30_000 };
}

describe("dates", () => {
  it("formats local dates in a timezone", () => {
    const late = new Date("2026-03-10T03:30:00.000Z");
    expect(toLocalDate(late, "UTC")).toBe("2026-03-10");
    expect(toLocalDate(late, "America/New_York")).toBe("2026-03-09");
    expect(toLocalDate(late, "Not/AZone")).toBe("2026-03-10");
  });

  it("does calendar arithmetic across month boundaries", () => {
    expect(addDays("2026-02-28", 1)).toBe("2026-03-01");
    expect(diffDays("2026-03-02", "2026-02-27")).toBe(3);
    expect(dateRange("2026-03-02", 3)).toEqual(["2026-02-28", "2026-03-01", "2026-03-02"]);
  });
});

describe("computeStreaks", () => {
  it("counts consecutive days including today", () => {
    const s = computeStreaks([day("2026-03-08", 5), day("2026-03-09", 3), day("2026-03-10", 1)], "2026-03-10");
    expect(s).toMatchObject({ current: 3, longest: 3, studiedToday: true, answeredToday: 1 });
  });

  it("keeps the streak alive when today has no activity yet", () => {
    const s = computeStreaks([day("2026-03-08", 5), day("2026-03-09", 3)], "2026-03-10");
    expect(s.current).toBe(2);
    expect(s.studiedToday).toBe(false);
  });

  it("breaks the streak after a missed day but remembers the longest", () => {
    const s = computeStreaks(
      [day("2026-02-01", 1), day("2026-02-02", 1), day("2026-02-03", 1), day("2026-02-04", 1), day("2026-03-07", 2)],
      "2026-03-10",
    );
    expect(s.current).toBe(0);
    expect(s.longest).toBe(4);
  });

  it("ignores days with zero answers", () => {
    expect(computeStreaks([day("2026-03-09", 0), day("2026-03-10", 2)], "2026-03-10").current).toBe(1);
  });
});

describe("weak topic detection", () => {
  it("ranks the lowest-accuracy topics first and requires a minimum sample", () => {
    const ranked = rankTopics([
      makeTopicStat("pki", 10, 5),
      makeTopicStat("cloud", 10, 9),
      makeTopicStat("ir", 10, 6),
      makeTopicStat("tiny", 1, 0),
    ]);
    expect(ranked.map((t) => t.topicId)).toEqual(["pki", "ir", "cloud"]);
    expect(ranked[0].accuracy).toBe(0.5);
  });

  it("lets recent improvement lift a topic out of the weakest spot", () => {
    const ranked = weakestTopics([makeTopicStat("pki", 10, 5, 0.95), makeTopicStat("ir", 10, 6, 0.4)], 1);
    expect(ranked[0].topicId).toBe("ir");
  });

  it("updates recency-weighted accuracy", () => {
    expect(updateRecentAccuracy(null, true, 0.3)).toBe(1);
    expect(updateRecentAccuracy(1, false, 0.3)).toBeCloseTo(0.7);
  });
});

describe("performance aggregation", () => {
  const catalog = [
    makeEntry("a", { domainId: 1, topics: ["pki"], difficulty: "easy" }),
    makeEntry("b", { domainId: 1, topics: ["pki", "hashing"], difficulty: "hard" }),
    makeEntry("c", { domainId: 4, topics: ["siem"], difficulty: "hard" }),
    makeEntry("d", { domainId: 4, topics: ["siem"], difficulty: "medium" }),
  ];
  const bank = bankStatsFromCatalog(catalog);
  const states = [
    makeState("a", { mastery: 4, timesSeen: 3, timesCorrect: 3, timesIncorrect: 0, dueAt: "2026-04-01T00:00:00Z" }),
    makeState("b", { mastery: 1, timesSeen: 2, timesCorrect: 0, timesIncorrect: 2, dueAt: "2026-03-01T00:00:00Z" }),
    makeState("c", { mastery: 2, timesSeen: 4, timesCorrect: 3, timesIncorrect: 1, dueAt: "2026-03-20T00:00:00Z" }),
  ];

  it("computes bank stats", () => {
    expect(bank).toMatchObject({ total: 4, byDomain: { 1: 2, 4: 2 }, byTopic: { pki: 2, hashing: 1, siem: 2 } });
  });

  it("summarizes the overview", () => {
    expect(overviewStats(states, NOW)).toEqual({ answered: 9, correct: 6, accuracy: 6 / 9, questionsSeen: 3, mastered: 1, needsReview: 1 });
  });

  it("computes domain accuracy, coverage and mastery", () => {
    const perf = domainPerformance(catalog, states, bank, NOW);
    const d1 = perf.find((d) => d.domainId === 1)!;
    expect(d1).toMatchObject({ totalQuestions: 2, attempted: 2, answers: 5, correct: 3, due: 1 });
    expect(d1.accuracy).toBeCloseTo(0.6);
    expect(d1.mastery).toBeCloseTo(5 / 8);
    expect(perf.find((d) => d.domainId === 3)).toMatchObject({ attempted: 0, accuracy: null, masteryLabel: "Not started" });
  });

  it("computes topic performance from topic stats and question states", () => {
    const perf = topicPerformance(catalog, states, [makeTopicStat("pki", 5, 3), makeTopicStat("siem", 4, 3)], bank);
    expect(perf.find((t) => t.topicId === "pki")).toMatchObject({ attempted: 2, totalQuestions: 2, correct: 3, incorrect: 2, accuracy: 0.6 });
    expect(perf.find((t) => t.topicId === "hashing")).toMatchObject({ attempted: 1, accuracy: null });
  });

  it("computes accuracy by difficulty", () => {
    const perf = difficultyPerformance(catalog, states);
    expect(perf.find((d) => d.difficulty === "hard")).toMatchObject({ answers: 6, correct: 3, accuracy: 0.5 });
    expect(perf.find((d) => d.difficulty === "medium")?.accuracy).toBeNull();
  });

  it("computes the mastery distribution including unseen questions", () => {
    expect(masteryDistribution(states, 4)).toEqual({ 0: 1, 1: 1, 2: 1, 3: 0, 4: 1 });
    expect(masteryFraction([4, 4], 4)).toBe(0.5);
  });

  it("produces a bounded readiness score", () => {
    const score = readinessScore(domainPerformance(catalog, states, bank, NOW));
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThanOrEqual(100);
  });
});

describe("activityTimeline", () => {
  it("computes daily, rolling and cumulative accuracy", () => {
    const activity = [day("2026-03-01", 10, 5), day("2026-03-08", 10, 10), day("2026-03-10", 10, 8)];
    const points = activityTimeline(activity, "2026-03-10", 3);
    expect(points.map((p) => p.date)).toEqual(["2026-03-08", "2026-03-09", "2026-03-10"]);
    expect(points[0]).toMatchObject({ answered: 10, dailyAccuracy: 1, cumulativeAccuracy: 0.75 });
    expect(points[1].dailyAccuracy).toBeNull();
    expect(points[2].rollingAccuracy).toBeCloseTo(18 / 20);
    expect(points[2].cumulativeAccuracy).toBeCloseTo(23 / 30);
  });
});
