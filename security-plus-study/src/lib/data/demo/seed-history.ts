import { toLocalDate } from "@/lib/analytics/dates";
import { EXAM_CONFIG, getExamPreset } from "@/lib/config/exam";
import { DEFAULT_SETTINGS } from "@/lib/config/defaults";
import { buildExam } from "@/lib/engine/exam-builder";
import { buildQuiz } from "@/lib/engine/quiz-builder";
import { createRng, type Rng } from "@/lib/engine/random";
import { scoreExam } from "@/lib/engine/scoring";
import { scheduleReview } from "@/lib/engine/spaced-repetition";
import { toCatalogEntry } from "@/lib/questions/transform";
import type { AttemptWrite, Confidence, ExamResponse, Question, ReviewState, StudyMode } from "@/lib/types";
import { applyAttemptWrite, createDemoUser, DEMO_ACCOUNT, insertExamSession, insertQuizSession } from "./operations";
import type { DemoData } from "./store";

/**
 * Generates ~4 weeks of plausible study history for the demo account using
 * the real scheduling engine, so the dashboard, analytics, weak-topic
 * detection and review queues are populated on first launch.
 */

const DOMAIN_SKILL: Record<number, number> = { 1: 0.84, 2: 0.72, 3: 0.7, 4: 0.75, 5: 0.8 };
const TOPIC_MODIFIER: Record<string, number> = {
  pki: -0.3,
  certificates: -0.25,
  "cloud-security": -0.22,
  "incident-response": -0.2,
  forensics: -0.15,
  "risk-management": -0.12,
  "cia-triad": 0.1,
  malware: 0.08,
};
const SKIPPED_DAYS = new Set([22, 18, 15, 11, 8]);
const HISTORY_DAYS = 26;
const EXAM_DAY = 2;

function probabilityCorrect(q: Question, state: ReviewState | undefined): number {
  const topicAdj = Math.min(0, ...q.topics.map((t) => TOPIC_MODIFIER[t] ?? 0)) + Math.max(0, ...q.topics.map((t) => TOPIC_MODIFIER[t] ?? 0));
  const difficultyAdj = q.difficulty === "hard" ? -0.12 : q.difficulty === "easy" ? 0.08 : 0;
  const learning = Math.min(0.2, (state?.timesCorrect ?? 0) * 0.07);
  return Math.min(0.97, Math.max(0.12, DOMAIN_SKILL[q.domainId] + topicAdj + difficultyAdj + learning));
}

function pickConfidence(correct: boolean, rng: Rng): Confidence {
  const r = rng();
  if (correct) return r < 0.6 ? "confident" : r < 0.87 ? "unsure" : "guessed";
  return r < 0.22 ? "confident" : r < 0.65 ? "unsure" : "guessed";
}

function pickSelection(q: Question, correct: boolean, rng: Rng): string[] {
  const right = q.choices.filter((c) => c.isCorrect).map((c) => c.id);
  if (correct) return right;
  const wrong = q.choices.filter((c) => !c.isCorrect).map((c) => c.id);
  const wrongPick = wrong[Math.floor(rng() * wrong.length)];
  return q.correctCount > 1 ? [...right.slice(0, q.correctCount - 1), wrongPick] : [wrongPick];
}

function daysAgo(now: Date, days: number, hour: number, minute = 0): Date {
  const d = new Date(now);
  d.setUTCDate(d.getUTCDate() - days);
  d.setUTCHours(hour, minute, 0, 0);
  return d;
}

export function seedDemoAccount(data: DemoData, now = new Date()): void {
  const user = createDemoUser(data, { ...DEMO_ACCOUNT, role: "admin" });
  data.settings[user.id] = { ...DEFAULT_SETTINGS, dailyGoal: 20, defaultQuizSize: 10 };
  const rng = createRng(20260928);
  const questions = Object.values(data.questions).filter((q) => q.status === "published");
  const byId = new Map(questions.map((q) => [q.id, q]));
  const catalog = questions.map(toCatalogEntry);
  const states = () => new Map(Object.entries(data.reviewStates[user.id] ?? {}));

  const answer = (q: Question, at: Date, ref: { quizSessionId?: string; examSessionId?: string }) => {
    const prev = data.reviewStates[user.id]?.[q.id] ?? null;
    const correct = rng() < probabilityCorrect(q, prev ?? undefined);
    const confidence = pickConfidence(correct, rng);
    const write: AttemptWrite = {
      questionId: q.id,
      quizSessionId: ref.quizSessionId ?? null,
      examSessionId: ref.examSessionId ?? null,
      selectedChoiceIds: pickSelection(q, correct, rng),
      isCorrect: correct,
      confidence,
      timeSpentMs: Math.round(25_000 + rng() * 70_000),
      answeredAt: at.toISOString(),
      activityDate: toLocalDate(at, "UTC"),
      stateBefore: prev,
      stateAfter: scheduleReview(prev, q.id, { correct, confidence }, at),
    };
    return applyAttemptWrite(data, user.id, write);
  };

  const modes: { mode: StudyMode; title: string }[] = [
    { mode: "daily", title: "Daily study session" },
    { mode: "quick", title: "Quick quiz" },
    { mode: "weak", title: "Weakest topics" },
    { mode: "domain", title: "Domain practice" },
  ];

  // A completed practice exam two days ago, after that evening's study session.
  const runExam = (day: number) => {
    const preset = getExamPreset("sprint");
    const examStart = daysAgo(now, day, 22, 5);
    const examIds = buildExam(catalog, preset.questionCount, rng, { useDomainWeights: EXAM_CONFIG.useDomainWeights });
    const exam = insertExamSession(data, {
      userId: user.id,
      presetId: preset.id,
      title: preset.name,
      questionIds: examIds,
      timeLimitSeconds: preset.timeLimitMinutes * 60,
      startedAt: examStart.toISOString(),
      expiresAt: new Date(examStart.getTime() + preset.timeLimitMinutes * 60_000).toISOString(),
      submittedAt: null,
      status: "in_progress",
      responses: {},
      result: null,
    });
    const at = new Date(examStart);
    const responses: Record<string, ExamResponse> = {};
    examIds.forEach((id, i) => {
      at.setTime(at.getTime() + 45_000 + Math.floor(rng() * 20_000));
      if (i === examIds.length - 1) return; // leave one unanswered for a realistic report
      const attempt = answer(byId.get(id)!, at, { examSessionId: exam.id });
      responses[id] = { selectedChoiceIds: attempt.selectedChoiceIds, flagged: i % 7 === 3 };
    });
    exam.responses = responses;
    exam.result = scoreExam(
      examIds.map((id) => byId.get(id)!),
      responses,
      (at.getTime() - examStart.getTime()) / 1000,
    );
    exam.status = "submitted";
    exam.submittedAt = at.toISOString();
  };

  for (let day = HISTORY_DAYS; day >= 0; day--) {
    if (SKIPPED_DAYS.has(day)) continue;
    const count = day === 0 ? 8 : 10 + Math.floor(rng() * 15);
    const start = daysAgo(now, day, day === 0 ? Math.max(0, Math.min(now.getUTCHours() - 1, 12)) : 18 + Math.floor(rng() * 3), Math.floor(rng() * 50));
    if (start > now) start.setTime(now.getTime() - count * 90_000);
    const { mode, title } = modes[day % modes.length];
    const ids = buildQuiz(
      { count, pool: mode === "weak" && day < 20 ? "weak" : "all" },
      { catalog, states: states(), bookmarks: new Set(), topicStats: Object.values(data.topicStats[user.id] ?? {}), now: start, rng },
    );
    const session = insertQuizSession(data, {
      userId: user.id,
      mode,
      title,
      config: { count },
      questionIds: ids,
      status: "active",
      startedAt: start.toISOString(),
      completedAt: null,
      answeredCount: 0,
      correctCount: 0,
      timeSpentMs: 0,
    });
    const at = new Date(start);
    for (const id of ids) {
      at.setTime(at.getTime() + 30_000 + Math.floor(rng() * 60_000));
      answer(byId.get(id)!, at, { quizSessionId: session.id });
    }
    session.status = "completed";
    session.completedAt = at.toISOString();
    if (day === EXAM_DAY) runExam(day);
  }

  // A few bookmarks and a note on weak topics.
  const weakQuestions = questions.filter((q) => q.topics.includes("pki") || q.topics.includes("cloud-security"));
  data.bookmarks[user.id] = Object.fromEntries(
    weakQuestions.slice(0, 4).map((q, i) => [q.id, daysAgo(now, 6 - i, 19).toISOString()]),
  );
  const ocsp = questions.find((q) => q.stem.includes("revocation status"));
  if (ocsp) {
    data.notes[user.id] = {
      [ocsp.id]: {
        questionId: ocsp.id,
        body: "OCSP = real-time status for ONE certificate. CRL = the whole published list (can be stale).",
        updatedAt: daysAgo(now, 5, 20).toISOString(),
      },
    };
  }
}
