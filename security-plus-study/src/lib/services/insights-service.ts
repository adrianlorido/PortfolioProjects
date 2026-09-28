import "server-only";

import { addDays, dateRange, toLocalDate } from "@/lib/analytics/dates";
import {
  activityTimeline,
  difficultyPerformance,
  domainPerformance,
  masteryDistribution,
  overviewStats,
  readinessScore,
  topicPerformance,
  type DomainPerformance,
  type OverviewStats,
  type TimelinePoint,
  type TopicPerformance,
  type DifficultyPerformance,
} from "@/lib/analytics/stats";
import { computeStreaks, type StreakSummary } from "@/lib/analytics/streaks";
import { weakestTopics, type WeakTopic } from "@/lib/analytics/weak-topics";
import { getTopicDefinition, getTopicName } from "@/lib/config/topics";
import { isDue, isInMissedPool } from "@/lib/engine/spaced-repetition";
import type { Repository } from "@/lib/data/repository";
import type { AppUser, DailyActivity, DomainId, ExamSession, MasteryLevel, QuizSession, StudyMode, UserSettings } from "@/lib/types";

export interface RecentActivityItem {
  id: string;
  kind: "quiz" | "exam";
  title: string;
  modeLabel: string;
  startedAt: string;
  questions: number;
  answered: number;
  correct: number;
  percent: number | null;
  timeSeconds: number;
  status: "completed" | "in_progress" | "passed" | "failed" | "abandoned";
  href: string;
}

export interface WeakTopicView extends WeakTopic {
  name: string;
}

export interface Recommendation {
  count: number;
  dueCount: number;
  weakestDomainId: DomainId | null;
  weakestDomainAccuracy: number | null;
  reason: string;
}

export interface DashboardData {
  today: string;
  settings: UserSettings;
  streak: StreakSummary;
  overview: OverviewStats;
  domains: DomainPerformance[];
  weakTopics: WeakTopicView[];
  recommendation: Recommendation;
  recent: RecentActivityItem[];
  readiness: number;
  bankTotal: number;
}

const MODE_LABELS: Record<StudyMode, string> = {
  quick: "Quick quiz",
  domain: "Domain practice",
  topic: "Topic focus",
  weak: "Weak areas",
  missed: "Missed questions",
  bookmarked: "Bookmarks",
  review: "Spaced review",
  daily: "Daily session",
  retry: "Retry",
  custom: "Custom",
};

export function modeLabel(mode: StudyMode): string {
  return MODE_LABELS[mode] ?? "Study";
}

function quizToRecent(s: QuizSession): RecentActivityItem {
  return {
    id: s.id,
    kind: "quiz",
    title: s.title,
    modeLabel: modeLabel(s.mode),
    startedAt: s.startedAt,
    questions: s.questionIds.length,
    answered: s.answeredCount,
    correct: s.correctCount,
    percent: s.answeredCount ? Math.round((s.correctCount / s.answeredCount) * 100) : null,
    timeSeconds: Math.round(s.timeSpentMs / 1000),
    status: s.status === "active" ? "in_progress" : s.status,
    href: s.status === "active" ? `/quiz/${s.id}` : `/quiz/${s.id}/summary`,
  };
}

function examToRecent(e: ExamSession): RecentActivityItem {
  const r = e.result;
  return {
    id: e.id,
    kind: "exam",
    title: e.title,
    modeLabel: "Practice exam",
    startedAt: e.startedAt,
    questions: e.questionIds.length,
    answered: r ? r.total - r.unanswered : 0,
    correct: r?.correct ?? 0,
    percent: r ? Math.round(r.percent) : null,
    timeSeconds: r?.timeUsedSeconds ?? 0,
    status: e.status === "in_progress" ? "in_progress" : r?.passed ? "passed" : "failed",
    href: e.status === "in_progress" ? `/exam/${e.id}` : `/exam/${e.id}/results`,
  };
}

async function loadCore(user: AppUser, repo: Repository) {
  const [settings, catalog, bank, states, topicStats, activity] = await Promise.all([
    repo.getSettings(user.id),
    repo.getCatalog(),
    repo.getBankStats(),
    repo.getReviewStates(user.id),
    repo.getTopicStats(user.id),
    repo.getActivity(user.id),
  ]);
  const now = new Date();
  const today = toLocalDate(now, settings.timezone);
  return { settings, catalog, bank, states, topicStats, activity, now, today };
}

export async function getRecentActivity(user: AppUser, repo: Repository, limit = 6): Promise<RecentActivityItem[]> {
  const [quizzes, exams] = await Promise.all([repo.listQuizSessions(user.id, limit), repo.listExamSessions(user.id, limit)]);
  return [...quizzes.filter((q) => q.answeredCount > 0 || q.status === "active").map(quizToRecent), ...exams.map(examToRecent)]
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
    .slice(0, limit);
}

export async function getDashboardData(user: AppUser, repo: Repository): Promise<DashboardData> {
  const { settings, catalog, bank, states, topicStats, activity, now, today } = await loadCore(user, repo);
  const streak = computeStreaks(activity, today);
  const overview = overviewStats(states, now);
  const domains = domainPerformance(catalog, states, bank, now);
  const weak = weakestTopics(topicStats, 5).map((t) => ({ ...t, name: getTopicName(t.topicId) }));

  const measured = domains.filter((d) => d.answers >= 3 && d.accuracy !== null);
  const weakestDomain = measured.sort((a, b) => (a.accuracy ?? 1) - (b.accuracy ?? 1))[0];
  const remaining = Math.max(0, settings.dailyGoal - streak.answeredToday);
  const count = remaining > 0 ? Math.min(30, Math.max(5, remaining)) : settings.defaultQuizSize;
  const reason =
    overview.needsReview > 0
      ? `${overview.needsReview} question${overview.needsReview === 1 ? " is" : "s are"} due for review. We'll mix them with weak-area and new questions.`
      : streak.answeredToday === 0 && overview.questionsSeen === 0
        ? "Start with a mixed set to calibrate your strengths across all five domains."
        : remaining > 0
          ? `${remaining} more to hit today's goal. The session targets your weakest areas and new material.`
          : "Daily goal complete. Keep momentum with a short bonus round.";

  return {
    today,
    settings,
    streak,
    overview,
    domains,
    weakTopics: weak,
    recommendation: {
      count,
      dueCount: overview.needsReview,
      weakestDomainId: weakestDomain?.domainId ?? null,
      weakestDomainAccuracy: weakestDomain?.accuracy ?? null,
      reason,
    },
    recent: await getRecentActivity(user, repo),
    readiness: readinessScore(domains),
    bankTotal: bank.total,
  };
}

export interface HeatmapDay {
  date: string;
  answered: number;
  correct: number;
  level: 0 | 1 | 2 | 3 | 4;
}

export interface AnalyticsData {
  today: string;
  settings: UserSettings;
  streak: StreakSummary;
  overview: OverviewStats;
  timeline: TimelinePoint[];
  domains: DomainPerformance[];
  difficulty: DifficultyPerformance[];
  topics: (TopicPerformance & { name: string })[];
  mastery: Record<MasteryLevel, number>;
  heatmap: HeatmapDay[];
  totalStudySeconds: number;
  activeDays: number;
  readiness: number;
  examScores: { id: string; date: string; percent: number; scaledScore: number; passed: boolean }[];
}

function heatLevel(answered: number, goal: number): HeatmapDay["level"] {
  if (answered <= 0) return 0;
  const ratio = answered / Math.max(1, goal);
  if (ratio < 0.5) return 1;
  if (ratio < 1) return 2;
  if (ratio < 1.75) return 3;
  return 4;
}

export async function getAnalyticsData(user: AppUser, repo: Repository): Promise<AnalyticsData> {
  const { settings, catalog, bank, states, topicStats, activity, now, today } = await loadCore(user, repo);
  const exams = await repo.listExamSessions(user.id, 20);
  const domains = domainPerformance(catalog, states, bank, now);
  const byDate = new Map<string, DailyActivity>(activity.map((a) => [a.date, a]));

  // 26 weeks, aligned so the grid ends on today.
  const heatDays = dateRange(today, 7 * 26);
  const heatmap = heatDays.map((date) => {
    const a = byDate.get(date);
    return { date, answered: a?.answered ?? 0, correct: a?.correct ?? 0, level: heatLevel(a?.answered ?? 0, settings.dailyGoal) };
  });

  return {
    today,
    settings,
    streak: computeStreaks(activity, today),
    overview: overviewStats(states, now),
    timeline: activityTimeline(activity, today, 90),
    domains,
    difficulty: difficultyPerformance(catalog, states),
    topics: topicPerformance(catalog, states, topicStats, bank).map((t) => ({ ...t, name: getTopicName(t.topicId) })),
    mastery: masteryDistribution(states, bank.total),
    heatmap,
    totalStudySeconds: Math.round(activity.reduce((s, a) => s + a.timeSpentMs, 0) / 1000),
    activeDays: activity.filter((a) => a.answered > 0 && a.date >= addDays(today, -89)).length,
    readiness: readinessScore(domains),
    examScores: exams
      .filter((e) => e.result)
      .map((e) => ({ id: e.id, date: e.startedAt, percent: e.result!.percent, scaledScore: e.result!.scaledScore, passed: e.result!.passed }))
      .reverse(),
  };
}

export interface StudyHubData {
  settings: UserSettings;
  domains: DomainPerformance[];
  weakTopics: WeakTopicView[];
  missedCount: number;
  bookmarkCount: number;
  dueCount: number;
  unansweredCount: number;
  topics: { id: string; name: string; count: number; domainHint: DomainId | null }[];
}

export async function getStudyHubData(user: AppUser, repo: Repository): Promise<StudyHubData> {
  const { settings, catalog, bank, states, topicStats, now } = await loadCore(user, repo);
  const [bookmarks, topics] = await Promise.all([repo.listBookmarks(user.id), repo.listTopics()]);
  const published = new Set(catalog.map((q) => q.id));
  const seen = new Set(states.map((s) => s.questionId));
  return {
    settings,
    domains: domainPerformance(catalog, states, bank, now),
    weakTopics: weakestTopics(topicStats, 3).map((t) => ({ ...t, name: getTopicName(t.topicId) })),
    missedCount: states.filter((s) => published.has(s.questionId) && isInMissedPool(s, now)).length,
    bookmarkCount: bookmarks.filter((b) => published.has(b.questionId)).length,
    dueCount: states.filter((s) => published.has(s.questionId) && isDue(s, now)).length,
    unansweredCount: catalog.filter((q) => !seen.has(q.id)).length,
    topics: topics
      .filter((t) => (bank.byTopic[t.id] ?? 0) > 0)
      .map((t) => ({ id: t.id, name: t.name, count: bank.byTopic[t.id] ?? 0, domainHint: getTopicDefinition(t.id)?.domainHint ?? null })),
  };
}

export interface DomainTopicRow {
  topicId: string;
  name: string;
  questions: number;
  attempted: number;
  answers: number;
  correct: number;
  accuracy: number | null;
}

export interface DomainDetail {
  performance: DomainPerformance;
  topics: DomainTopicRow[];
  difficulty: DifficultyPerformance[];
  masteryCounts: Record<MasteryLevel, number>;
}

export async function getDomainDetail(user: AppUser, repo: Repository, domainId: DomainId): Promise<DomainDetail> {
  const { catalog, bank, states, now } = await loadCore(user, repo);
  const inDomain = catalog.filter((q) => q.domainId === domainId);
  const ids = new Set(inDomain.map((q) => q.id));
  const domainStates = states.filter((s) => ids.has(s.questionId));
  const stateById = new Map(domainStates.map((s) => [s.questionId, s]));

  const rows = new Map<string, DomainTopicRow>();
  for (const q of inDomain) {
    const s = stateById.get(q.id);
    for (const t of q.topics) {
      const row = rows.get(t) ?? { topicId: t, name: getTopicName(t), questions: 0, attempted: 0, answers: 0, correct: 0, accuracy: null };
      row.questions += 1;
      if (s) {
        row.attempted += 1;
        row.answers += s.timesSeen;
        row.correct += s.timesCorrect;
      }
      rows.set(t, row);
    }
  }
  const topics = [...rows.values()]
    .map((r) => ({ ...r, accuracy: r.answers ? r.correct / r.answers : null }))
    .sort((a, b) => (a.accuracy ?? 2) - (b.accuracy ?? 2) || b.questions - a.questions);

  return {
    performance: domainPerformance(catalog, states, bank, now).find((d) => d.domainId === domainId)!,
    topics,
    difficulty: difficultyPerformance(inDomain, domainStates),
    masteryCounts: masteryDistribution(domainStates, inDomain.length),
  };
}
