import { describe, expect, it } from "vitest";

import { makeState } from "@/lib/test-utils";
import { DEFAULT_SR_CONFIG, isDue, isInMissedPool, nextMastery, scheduleReview } from "../spaced-repetition";

const NOW = new Date("2026-03-01T12:00:00.000Z");
const DAY = 86_400_000;

describe("nextMastery", () => {
  it("promotes on a plain correct answer", () => {
    expect(nextMastery(0, { correct: true, confidence: null })).toBe(1);
    expect(nextMastery(3, { correct: true, confidence: null })).toBe(4);
    expect(nextMastery(4, { correct: true, confidence: null })).toBe(4);
  });

  it("gives a stronger boost for correct + confident", () => {
    expect(nextMastery(0, { correct: true, confidence: "confident" })).toBe(2);
  });

  it("does not promote correct + guessed, and demotes strong items", () => {
    expect(nextMastery(0, { correct: true, confidence: "guessed" })).toBe(1);
    expect(nextMastery(2, { correct: true, confidence: "guessed" })).toBe(2);
    expect(nextMastery(4, { correct: true, confidence: "guessed" })).toBe(3);
  });

  it("caps unsure answers below Mastered", () => {
    expect(nextMastery(2, { correct: true, confidence: "unsure" })).toBe(3);
    expect(nextMastery(3, { correct: true, confidence: "unsure" })).toBe(3);
  });

  it("lowers mastery on an incorrect answer", () => {
    expect(nextMastery(4, { correct: false, confidence: null })).toBe(2);
    expect(nextMastery(2, { correct: false, confidence: null })).toBe(1);
    expect(nextMastery(0, { correct: false, confidence: null })).toBe(1);
  });

  it("resets incorrect + confident to Learning (misconception)", () => {
    expect(nextMastery(4, { correct: false, confidence: "confident" })).toBe(1);
  });
});

describe("scheduleReview", () => {
  it("schedules a new incorrect answer to come back soon", () => {
    const state = scheduleReview(null, "q1", { correct: false, confidence: null }, NOW);
    expect(state.mastery).toBe(1);
    expect(state.timesSeen).toBe(1);
    expect(state.timesIncorrect).toBe(1);
    expect(new Date(state.dueAt).getTime() - NOW.getTime()).toBe(DEFAULT_SR_CONFIG.incorrectDelayMinutes * 60_000);
    expect(state.lastMissedAt).toBe(NOW.toISOString());
  });

  it("makes a confident miss due immediately (highest priority)", () => {
    const state = scheduleReview(null, "q1", { correct: false, confidence: "confident" }, NOW);
    expect(isDue(state, NOW)).toBe(true);
  });

  it("maps mastery levels to growing intervals", () => {
    let state = scheduleReview(null, "q1", { correct: true, confidence: null }, NOW);
    expect(state.mastery).toBe(1);
    expect(state.intervalDays).toBe(1);
    state = scheduleReview({ ...state, lastAttemptId: null }, "q1", { correct: true, confidence: null }, NOW);
    expect(state.mastery).toBe(2);
    expect(state.intervalDays).toBe(4);
    state = scheduleReview({ ...state, lastAttemptId: null }, "q1", { correct: true, confidence: null }, NOW);
    expect(state.intervalDays).toBe(8);
    state = scheduleReview({ ...state, lastAttemptId: null }, "q1", { correct: true, confidence: null }, NOW);
    expect(state.mastery).toBe(4);
    expect(state.intervalDays).toBe(21);
  });

  it("grows the interval for repeated correct answers on mastered items, up to the cap", () => {
    const mastered = makeState("q1", { mastery: 4, intervalDays: 21, lastResult: true, timesIncorrect: 0 });
    const next = scheduleReview(mastered, "q1", { correct: true, confidence: null }, NOW);
    expect(next.intervalDays).toBe(42);
    const huge = scheduleReview({ ...mastered, intervalDays: 100 }, "q1", { correct: true, confidence: "confident" }, NOW);
    expect(huge.intervalDays).toBe(DEFAULT_SR_CONFIG.maxIntervalDays);
  });

  it("brings guessed-correct answers back the next day", () => {
    const prev = makeState("q1", { mastery: 3, intervalDays: 8, lastResult: true });
    const next = scheduleReview(prev, "q1", { correct: true, confidence: "guessed" }, NOW);
    expect(next.mastery).toBe(2);
    expect(next.intervalDays).toBe(1);
    expect(next.correctStreak).toBe(prev.correctStreak);
  });

  it("tracks counters and streaks", () => {
    const prev = makeState("q1", { timesSeen: 3, timesCorrect: 2, timesIncorrect: 1, correctStreak: 2, mastery: 2 });
    const correct = scheduleReview(prev, "q1", { correct: true, confidence: "confident" }, NOW);
    expect(correct).toMatchObject({ timesSeen: 4, timesCorrect: 3, timesIncorrect: 1, correctStreak: 3 });
    const wrong = scheduleReview(prev, "q1", { correct: false, confidence: null }, NOW);
    expect(wrong).toMatchObject({ timesSeen: 4, timesIncorrect: 2, correctStreak: 0 });
  });

  it("respects a custom configuration", () => {
    const config = { ...DEFAULT_SR_CONFIG, levelIntervalDays: { 0: 0, 1: 2, 2: 5, 3: 10, 4: 30 } as const };
    const state = scheduleReview(null, "q1", { correct: true, confidence: null }, NOW, config);
    expect(new Date(state.dueAt).getTime() - NOW.getTime()).toBe(2 * DAY);
  });
});

describe("isInMissedPool", () => {
  it("includes questions still being recovered", () => {
    expect(isInMissedPool(makeState("q", { mastery: 1, timesIncorrect: 2 }), NOW)).toBe(true);
  });

  it("drops re-mastered questions until they are due again", () => {
    const recovered = makeState("q", {
      mastery: 3,
      lastResult: true,
      timesIncorrect: 1,
      dueAt: new Date(NOW.getTime() + 5 * DAY).toISOString(),
    });
    expect(isInMissedPool(recovered, NOW)).toBe(false);
    expect(isInMissedPool({ ...recovered, dueAt: new Date(NOW.getTime() - DAY).toISOString() }, NOW)).toBe(true);
  });

  it("excludes questions never missed", () => {
    expect(isInMissedPool(makeState("q", { timesIncorrect: 0, lastResult: true, mastery: 1 }), NOW)).toBe(false);
  });
});
