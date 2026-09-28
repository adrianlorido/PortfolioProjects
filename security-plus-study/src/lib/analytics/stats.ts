import { DOMAINS } from "@/lib/config/domains";
import { MASTERED_THRESHOLD } from "@/lib/config/study";
import { isDue } from "@/lib/engine/spaced-repetition";
import type {
  BankStats,
  CatalogEntry,
  DailyActivity,
  Difficulty,
  DomainId,
  MasteryLevel,
  ReviewState,
  TopicStat,
} from "@/lib/types";
import { dateRange } from "./dates";

export function ratio(part: number, whole: number): number | null {
  return whole > 0 ? part / whole : null;
}

export interface OverviewStats {
  answered: number;
  correct: number;
  accuracy: number | null;
  questionsSeen: number;
  mastered: number;
  needsReview: number;
}

export function overviewStats(states: readonly ReviewState[], now: Date): OverviewStats {
  let answered = 0;
  let correct = 0;
  let mastered = 0;
  let needsReview = 0;
  for (const s of states) {
    answered += s.timesSeen;
    correct += s.timesCorrect;
    if (s.mastery >= MASTERED_THRESHOLD) mastered++;
    if (isDue(s, now)) needsReview++;
  }
  return { answered, correct, accuracy: ratio(correct, answered), questionsSeen: states.length, mastered, needsReview };
}

/** Mastery as a 0..1 fraction of the maximum possible across `total` questions (unseen count as 0). */
export function masteryFraction(levels: readonly MasteryLevel[], total: number): number {
  if (total <= 0) return 0;
  const sum = levels.reduce<number>((s, m) => s + m, 0);
  return Math.min(1, sum / (4 * total));
}

export function masteryLabelFor(fraction: number): { level: MasteryLevel; label: string } {
  if (fraction >= 0.8) return { level: 4, label: "Mastered" };
  if (fraction >= 0.6) return { level: 3, label: "Strong" };
  if (fraction >= 0.35) return { level: 2, label: "Familiar" };
  if (fraction > 0) return { level: 1, label: "Learning" };
  return { level: 0, label: "Not started" };
}

export interface DomainPerformance {
  domainId: DomainId;
  totalQuestions: number;
  attempted: number;
  answers: number;
  correct: number;
  accuracy: number | null;
  mastery: number;
  masteryLabel: string;
  due: number;
}

function indexCatalog(catalog: readonly CatalogEntry[]): Map<string, CatalogEntry> {
  return new Map(catalog.map((q) => [q.id, q]));
}

export function domainPerformance(
  catalog: readonly CatalogEntry[],
  states: readonly ReviewState[],
  bank: BankStats,
  now: Date,
): DomainPerformance[] {
  const byId = indexCatalog(catalog);
  return DOMAINS.map((d) => {
    const inDomain = states.filter((s) => byId.get(s.questionId)?.domainId === d.id);
    const answers = inDomain.reduce((s, x) => s + x.timesSeen, 0);
    const correct = inDomain.reduce((s, x) => s + x.timesCorrect, 0);
    const totalQuestions = bank.byDomain[d.id] ?? 0;
    const mastery = masteryFraction(
      inDomain.map((s) => s.mastery),
      Math.max(totalQuestions, inDomain.length),
    );
    return {
      domainId: d.id,
      totalQuestions,
      attempted: inDomain.length,
      answers,
      correct,
      accuracy: ratio(correct, answers),
      mastery,
      masteryLabel: masteryLabelFor(mastery).label,
      due: inDomain.filter((s) => isDue(s, now)).length,
    };
  });
}

export interface TopicPerformance {
  topicId: string;
  totalQuestions: number;
  attempted: number;
  correct: number;
  incorrect: number;
  accuracy: number | null;
  recentAccuracy: number | null;
  mastery: number;
  masteryLabel: string;
}

export function topicPerformance(
  catalog: readonly CatalogEntry[],
  states: readonly ReviewState[],
  topicStats: readonly TopicStat[],
  bank: BankStats,
): TopicPerformance[] {
  const byId = indexCatalog(catalog);
  const statsById = new Map(topicStats.map((t) => [t.topicId, t]));
  const levelsByTopic = new Map<string, MasteryLevel[]>();
  for (const s of states) {
    for (const t of byId.get(s.questionId)?.topics ?? []) {
      const list = levelsByTopic.get(t) ?? [];
      list.push(s.mastery);
      levelsByTopic.set(t, list);
    }
  }
  const topicIds = new Set([...Object.keys(bank.byTopic), ...statsById.keys()]);
  return [...topicIds]
    .map((topicId) => {
      const stat = statsById.get(topicId);
      const levels = levelsByTopic.get(topicId) ?? [];
      const totalQuestions = bank.byTopic[topicId] ?? levels.length;
      const mastery = masteryFraction(levels, Math.max(totalQuestions, levels.length));
      return {
        topicId,
        totalQuestions,
        attempted: levels.length,
        correct: stat?.correct ?? 0,
        incorrect: (stat?.attempts ?? 0) - (stat?.correct ?? 0),
        accuracy: stat ? ratio(stat.correct, stat.attempts) : null,
        recentAccuracy: stat ? stat.recentAccuracy : null,
        mastery,
        masteryLabel: masteryLabelFor(mastery).label,
      };
    })
    .sort((a, b) => b.attempted - a.attempted || a.topicId.localeCompare(b.topicId));
}

export interface DifficultyPerformance {
  difficulty: Difficulty;
  answers: number;
  correct: number;
  accuracy: number | null;
}

export function difficultyPerformance(catalog: readonly CatalogEntry[], states: readonly ReviewState[]): DifficultyPerformance[] {
  const byId = indexCatalog(catalog);
  return (["easy", "medium", "hard"] as const).map((difficulty) => {
    const matching = states.filter((s) => byId.get(s.questionId)?.difficulty === difficulty);
    const answers = matching.reduce((s, x) => s + x.timesSeen, 0);
    const correct = matching.reduce((s, x) => s + x.timesCorrect, 0);
    return { difficulty, answers, correct, accuracy: ratio(correct, answers) };
  });
}

export interface TimelinePoint {
  date: string;
  answered: number;
  correct: number;
  /** Accuracy for that day only. */
  dailyAccuracy: number | null;
  /** Rolling 7-day accuracy ending on that day. */
  rollingAccuracy: number | null;
  /** All-time accuracy up to and including that day. */
  cumulativeAccuracy: number | null;
}

export function activityTimeline(activity: readonly DailyActivity[], today: string, days: number): TimelinePoint[] {
  const byDate = new Map(activity.map((a) => [a.date, a]));
  const range = dateRange(today, days);
  const start = range[0];

  let cumAnswered = 0;
  let cumCorrect = 0;
  for (const a of activity) {
    if (a.date < start) {
      cumAnswered += a.answered;
      cumCorrect += a.correct;
    }
  }

  const window: { answered: number; correct: number }[] = [];
  // Seed the rolling window with the 6 days before the range.
  for (const d of dateRange(range[0], 7).slice(0, 6)) {
    const a = byDate.get(d);
    window.push({ answered: a?.answered ?? 0, correct: a?.correct ?? 0 });
  }

  return range.map((date) => {
    const a = byDate.get(date);
    const answered = a?.answered ?? 0;
    const correct = a?.correct ?? 0;
    cumAnswered += answered;
    cumCorrect += correct;
    window.push({ answered, correct });
    if (window.length > 7) window.shift();
    const wAnswered = window.reduce((s, x) => s + x.answered, 0);
    const wCorrect = window.reduce((s, x) => s + x.correct, 0);
    return {
      date,
      answered,
      correct,
      dailyAccuracy: ratio(correct, answered),
      rollingAccuracy: ratio(wCorrect, wAnswered),
      cumulativeAccuracy: ratio(cumCorrect, cumAnswered),
    };
  });
}

export function masteryDistribution(states: readonly ReviewState[], totalQuestions: number): Record<MasteryLevel, number> {
  const dist: Record<MasteryLevel, number> = { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0 };
  for (const s of states) dist[s.mastery] += 1;
  // Unseen questions are "New"; seen-but-reset questions keep their level.
  dist[0] += Math.max(0, totalQuestions - states.length);
  return dist;
}

/**
 * Rough exam-readiness estimate (0..100). Domain accuracy is smoothed toward
 * 50% so a handful of answers cannot produce a confident score, scaled by
 * coverage of the bank, then weighted by the exam blueprint.
 */
export function readinessScore(domains: readonly DomainPerformance[]): number {
  let weighted = 0;
  let weightSum = 0;
  for (const d of domains) {
    const weight = DOMAINS.find((x) => x.id === d.domainId)?.weight ?? 0;
    const smoothed = (d.correct + 0.5 * 10) / (d.answers + 10);
    const coverage = d.totalQuestions > 0 ? Math.min(1, d.attempted / d.totalQuestions) : 0;
    weighted += weight * smoothed * (0.55 + 0.45 * Math.sqrt(coverage));
    weightSum += weight;
  }
  return weightSum ? Math.round((weighted / weightSum) * 100) : 0;
}

export function bankStatsFromCatalog(catalog: readonly CatalogEntry[]): BankStats {
  const stats: BankStats = {
    total: catalog.length,
    byDomain: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
    byTopic: {},
    byDifficulty: { easy: 0, medium: 0, hard: 0 },
  };
  for (const q of catalog) {
    stats.byDomain[q.domainId] += 1;
    stats.byDifficulty[q.difficulty] += 1;
    for (const t of q.topics) stats.byTopic[t] = (stats.byTopic[t] ?? 0) + 1;
  }
  return stats;
}
