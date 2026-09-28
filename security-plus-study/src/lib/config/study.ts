import type { MasteryLevel } from "@/lib/types";

export const QUIZ_SIZES = [5, 10, 20, 30, 50] as const;
export const DAILY_GOALS = [5, 10, 20, 30, 50] as const;
export const DOMAIN_PRACTICE_SIZES = [10, 20, 50] as const;
export const MAX_SESSION_QUESTIONS = 100;

export const MASTERY_LABELS: Record<MasteryLevel, string> = {
  0: "New",
  1: "Learning",
  2: "Familiar",
  3: "Strong",
  4: "Mastered",
};

export const MASTERY_DESCRIPTIONS: Record<MasteryLevel, string> = {
  0: "Not answered yet",
  1: "Recently missed or still shaky",
  2: "Answered correctly, needs reinforcement",
  3: "Consistently correct",
  4: "Long-term retention",
};

/** A question counts as "mastered" for dashboard totals at this level or above. */
export const MASTERED_THRESHOLD: MasteryLevel = 4;

/** Topics need at least this many answers before they can be flagged as weak. */
export const WEAK_TOPIC_MIN_ATTEMPTS = 3;

/** Smoothing factor for the recency-weighted topic accuracy (0..1). Higher = more reactive. */
export const TOPIC_RECENCY_ALPHA = 0.3;
