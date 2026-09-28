import { WEAK_TOPIC_MIN_ATTEMPTS } from "@/lib/config/study";
import type { TopicStat } from "@/lib/types";

export interface WeakTopic {
  topicId: string;
  attempts: number;
  correct: number;
  accuracy: number;
  recentAccuracy: number;
  /** Blended weakness score, 0..1 (lower = weaker). */
  score: number;
}

const PRIOR_ACCURACY = 0.75;
const PRIOR_WEIGHT = 2;

/**
 * Rank topics from weakest to strongest. Overall accuracy is smoothed toward a
 * prior so a single miss does not dominate, then blended with recency-weighted
 * accuracy so topics the learner has since improved on drop off the list.
 */
export function rankTopics(
  stats: readonly TopicStat[],
  { minAttempts = WEAK_TOPIC_MIN_ATTEMPTS }: { minAttempts?: number } = {},
): WeakTopic[] {
  return stats
    .filter((s) => s.attempts >= minAttempts)
    .map((s) => {
      const accuracy = s.attempts > 0 ? s.correct / s.attempts : 0;
      const smoothed = (s.correct + PRIOR_ACCURACY * PRIOR_WEIGHT) / (s.attempts + PRIOR_WEIGHT);
      const score = 0.6 * smoothed + 0.4 * s.recentAccuracy;
      return { topicId: s.topicId, attempts: s.attempts, correct: s.correct, accuracy, recentAccuracy: s.recentAccuracy, score };
    })
    .sort((a, b) => a.score - b.score || b.attempts - a.attempts || a.topicId.localeCompare(b.topicId));
}

export function weakestTopics(stats: readonly TopicStat[], limit = 5, options?: { minAttempts?: number }): WeakTopic[] {
  return rankTopics(stats, options).slice(0, limit);
}

/** Recency-weighted accuracy update used by both storage adapters. */
export function updateRecentAccuracy(previous: number | null, correct: boolean, alpha: number): number {
  const value = correct ? 1 : 0;
  if (previous === null) return value;
  return previous * (1 - alpha) + value * alpha;
}
