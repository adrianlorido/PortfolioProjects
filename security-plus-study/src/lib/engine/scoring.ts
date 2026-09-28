import { EXAM_CONFIG, type ExamConfig } from "@/lib/config/exam";
import { DOMAINS } from "@/lib/config/domains";
import type { DomainId, DomainScore, ExamQuestionResult, ExamResponse, ExamResult, Question, TopicScore } from "@/lib/types";
import { gradeAnswer } from "./grading";

export interface GradedItem {
  questionId: string;
  domainId: DomainId;
  topics: string[];
  isCorrect: boolean;
}

export function percent(part: number, whole: number): number {
  return whole > 0 ? Math.round((part / whole) * 1000) / 10 : 0;
}

export function domainBreakdown(items: readonly GradedItem[]): DomainScore[] {
  return DOMAINS.map((d) => {
    const inDomain = items.filter((i) => i.domainId === d.id);
    const correct = inDomain.filter((i) => i.isCorrect).length;
    return { domainId: d.id, total: inDomain.length, correct, percent: percent(correct, inDomain.length) };
  }).filter((s) => s.total > 0);
}

export function topicBreakdown(items: readonly GradedItem[]): TopicScore[] {
  const map = new Map<string, { total: number; correct: number }>();
  for (const item of items) {
    for (const t of item.topics) {
      const entry = map.get(t) ?? { total: 0, correct: 0 };
      entry.total += 1;
      entry.correct += item.isCorrect ? 1 : 0;
      map.set(t, entry);
    }
  }
  return [...map.entries()].map(([topicId, v]) => ({ topicId, ...v, percent: percent(v.correct, v.total) }));
}

/** Weakest topics first; ties broken by larger sample size. */
export function weakestTopicScores(items: readonly GradedItem[], limit = 5, minQuestions = 2): TopicScore[] {
  const all = topicBreakdown(items);
  const eligible = all.filter((t) => t.total >= minQuestions && t.correct < t.total);
  const pool = eligible.length ? eligible : all.filter((t) => t.correct < t.total);
  return pool.sort((a, b) => a.percent - b.percent || b.total - a.total).slice(0, limit);
}

/**
 * Linear estimate of a scaled score. Real certification scaling is not public
 * and not linear, so the UI labels this as an estimate.
 */
export function toScaledScore(pct: number, config: Pick<ExamConfig, "scaleMin" | "scaleMax"> = EXAM_CONFIG): number {
  const clamped = Math.min(100, Math.max(0, pct));
  return Math.round(config.scaleMin + ((config.scaleMax - config.scaleMin) * clamped) / 100);
}

export function scoreExam(
  questions: readonly Question[],
  responses: Readonly<Record<string, ExamResponse>>,
  timeUsedSeconds: number,
  config: ExamConfig = EXAM_CONFIG,
): ExamResult {
  const results: ExamQuestionResult[] = [];
  const graded: GradedItem[] = [];
  for (const q of questions) {
    const response = responses[q.id];
    const selected = response?.selectedChoiceIds ?? [];
    const answered = selected.length > 0;
    const isCorrect =
      answered &&
      gradeAnswer(
        q.choices.filter((c) => c.isCorrect).map((c) => c.id),
        selected,
      ).isCorrect;
    results.push({ questionId: q.id, answered, isCorrect, flagged: response?.flagged ?? false });
    graded.push({ questionId: q.id, domainId: q.domainId, topics: q.topics, isCorrect });
  }

  const total = questions.length;
  const correct = results.filter((r) => r.isCorrect).length;
  const unanswered = results.filter((r) => !r.answered).length;
  const pct = percent(correct, total);
  const scaledScore = toScaledScore(pct, config);
  const timeUsed = Math.max(0, Math.round(timeUsedSeconds));

  return {
    total,
    correct,
    incorrect: total - correct - unanswered,
    unanswered,
    percent: pct,
    scaledScore,
    passingScore: config.passingScaledScore,
    passed: scaledScore >= config.passingScaledScore,
    timeUsedSeconds: timeUsed,
    avgSecondsPerQuestion: total > 0 ? Math.round(timeUsed / total) : 0,
    domainBreakdown: domainBreakdown(graded),
    weakestTopics: weakestTopicScores(graded),
    questions: results,
  };
}
