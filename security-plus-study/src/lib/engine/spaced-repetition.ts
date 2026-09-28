import type { Confidence, MasteryLevel, ReviewState } from "@/lib/types";

/**
 * Spaced-repetition scheduler.
 *
 * Deliberately simple and fully configurable: mastery moves between five
 * levels, and each level maps to a review interval. Confidence modulates how
 * far mastery moves. Swap `scheduleReview` for another algorithm (e.g. SM-2 or
 * FSRS) without touching callers — they only depend on the ReviewState shape.
 */
export interface SpacedRepetitionConfig {
  /** Delay before a missed question is due again. */
  incorrectDelayMinutes: number;
  /** Delay for a confidently-wrong answer (a misconception): due immediately. */
  confidentIncorrectDelayMinutes: number;
  /** Correct-but-guessed answers come back quickly. */
  guessedCorrectIntervalDays: number;
  /** Base interval (days) after reaching each mastery level. */
  levelIntervalDays: Record<MasteryLevel, number>;
  /** Multiplier applied to the previous interval when a mastered item is answered correctly again. */
  masteredGrowth: number;
  masteredGrowthConfident: number;
  maxIntervalDays: number;
}

export const DEFAULT_SR_CONFIG: SpacedRepetitionConfig = {
  incorrectDelayMinutes: 10,
  confidentIncorrectDelayMinutes: 0,
  guessedCorrectIntervalDays: 1,
  levelIntervalDays: { 0: 0, 1: 1, 2: 4, 3: 8, 4: 21 },
  masteredGrowth: 2,
  masteredGrowthConfident: 2.5,
  maxIntervalDays: 120,
};

export interface ReviewOutcome {
  correct: boolean;
  confidence: Confidence | null;
}

const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;

function clampMastery(value: number): MasteryLevel {
  return Math.min(4, Math.max(0, Math.round(value))) as MasteryLevel;
}

export function nextMastery(current: MasteryLevel, outcome: ReviewOutcome): MasteryLevel {
  const { correct, confidence } = outcome;
  if (!correct) {
    // A confident miss signals a misconception: reset to Learning.
    if (confidence === "confident") return 1;
    return clampMastery(Math.max(1, current - 2));
  }
  switch (confidence) {
    case "guessed":
      // A lucky guess proves little: never promote, and demote strong items slightly.
      return clampMastery(Math.max(1, current >= 3 ? current - 1 : current));
    case "unsure":
      return clampMastery(current >= 3 ? current : current + 1);
    case "confident":
      return clampMastery(current === 0 ? 2 : current + 1);
    default:
      return clampMastery(current + 1);
  }
}

export function scheduleReview(
  previous: ReviewState | null,
  questionId: string,
  outcome: ReviewOutcome,
  now: Date,
  config: SpacedRepetitionConfig = DEFAULT_SR_CONFIG,
): Omit<ReviewState, "lastAttemptId"> {
  const prevMastery = previous?.mastery ?? 0;
  const mastery = nextMastery(prevMastery, outcome);
  const { correct, confidence } = outcome;

  let intervalDays: number;
  let dueAt: Date;
  if (!correct) {
    const minutes = confidence === "confident" ? config.confidentIncorrectDelayMinutes : config.incorrectDelayMinutes;
    intervalDays = 0;
    dueAt = new Date(now.getTime() + minutes * MINUTE_MS);
  } else {
    if (confidence === "guessed") {
      intervalDays = config.guessedCorrectIntervalDays;
    } else if (mastery === 4 && prevMastery === 4 && previous) {
      const growth = confidence === "confident" ? config.masteredGrowthConfident : config.masteredGrowth;
      intervalDays = Math.max(config.levelIntervalDays[4], previous.intervalDays * growth);
    } else {
      intervalDays = config.levelIntervalDays[mastery];
    }
    intervalDays = Math.min(config.maxIntervalDays, intervalDays);
    dueAt = new Date(now.getTime() + intervalDays * DAY_MS);
  }

  const counted = correct && confidence !== "guessed";
  return {
    questionId,
    mastery,
    timesSeen: (previous?.timesSeen ?? 0) + 1,
    timesCorrect: (previous?.timesCorrect ?? 0) + (correct ? 1 : 0),
    timesIncorrect: (previous?.timesIncorrect ?? 0) + (correct ? 0 : 1),
    correctStreak: correct ? (counted ? (previous?.correctStreak ?? 0) + 1 : previous?.correctStreak ?? 0) : 0,
    intervalDays: Math.round(intervalDays * 100) / 100,
    dueAt: dueAt.toISOString(),
    lastAnsweredAt: now.toISOString(),
    lastResult: correct,
    lastConfidence: confidence,
    lastMissedAt: correct ? previous?.lastMissedAt ?? null : now.toISOString(),
  };
}

export function isDue(state: Pick<ReviewState, "dueAt">, now: Date): boolean {
  return new Date(state.dueAt).getTime() <= now.getTime();
}

/** Higher = more urgent. Overdue items and low-mastery items float to the top. */
export function reviewPriority(state: ReviewState, now: Date): number {
  const overdueDays = (now.getTime() - new Date(state.dueAt).getTime()) / DAY_MS;
  const overdueFactor = overdueDays >= 0 ? 1 + Math.min(overdueDays, 30) / Math.max(1, state.intervalDays || 1) : 0;
  const masteryFactor = (5 - state.mastery) / 5;
  const missFactor = state.lastResult ? 0 : 0.5;
  return overdueFactor + masteryFactor + missFactor;
}

/** "Missed" questions: ever answered wrong and not yet re-mastered (or due again). */
export function isInMissedPool(state: ReviewState, now: Date): boolean {
  return state.timesIncorrect > 0 && (state.mastery < 3 || !state.lastResult || isDue(state, now));
}
