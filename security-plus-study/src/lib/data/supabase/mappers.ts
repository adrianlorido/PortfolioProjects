import type {
  AttemptRecord,
  Confidence,
  DomainId,
  ExamResponse,
  ExamResult,
  ExamSession,
  MasteryLevel,
  Question,
  QuizConfig,
  QuizSession,
  ReviewState,
  StudyMode,
  UserSettings,
} from "@/lib/types";

export const QUESTION_SELECT =
  "id, stem, domain_id, difficulty, question_type, correct_count, explanation, exam_clue, memory_tip, is_scenario, status, created_at, updated_at, question_choices(id, position, body, is_correct, explanation), question_topics(topic_id)";

export interface QuestionRow {
  id: string;
  stem: string;
  domain_id: number;
  difficulty: Question["difficulty"];
  question_type: Question["questionType"];
  correct_count: number;
  explanation: string;
  exam_clue: string;
  memory_tip: string;
  is_scenario: boolean;
  status: Question["status"];
  created_at: string;
  updated_at: string;
  question_choices: { id: string; position: number; body: string; is_correct: boolean; explanation: string | null }[];
  question_topics: { topic_id: string }[];
}

export function mapQuestion(r: QuestionRow): Question {
  return {
    id: r.id,
    stem: r.stem,
    choices: [...r.question_choices]
      .sort((a, b) => a.position - b.position)
      .map((c) => ({ id: c.id, text: c.body, isCorrect: c.is_correct, explanation: c.explanation })),
    domainId: r.domain_id as DomainId,
    topics: r.question_topics.map((t) => t.topic_id).sort(),
    difficulty: r.difficulty,
    questionType: r.question_type,
    correctCount: r.correct_count,
    explanation: r.explanation,
    examClue: r.exam_clue,
    memoryTip: r.memory_tip,
    isScenario: r.is_scenario,
    status: r.status,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export interface ReviewStateRow {
  question_id: string;
  mastery: number;
  times_seen: number;
  times_correct: number;
  times_incorrect: number;
  correct_streak: number;
  interval_days: number | string;
  due_at: string;
  last_answered_at: string;
  last_result: boolean;
  last_confidence: Confidence | null;
  last_missed_at: string | null;
  last_attempt_id: string | null;
}

export function mapReviewState(r: ReviewStateRow): ReviewState {
  return {
    questionId: r.question_id,
    mastery: r.mastery as MasteryLevel,
    timesSeen: r.times_seen,
    timesCorrect: r.times_correct,
    timesIncorrect: r.times_incorrect,
    correctStreak: r.correct_streak,
    intervalDays: Number(r.interval_days),
    dueAt: r.due_at,
    lastAnsweredAt: r.last_answered_at,
    lastResult: r.last_result,
    lastConfidence: r.last_confidence,
    lastMissedAt: r.last_missed_at,
    lastAttemptId: r.last_attempt_id,
  };
}

/** Snake-case shape consumed by record_attempt_item / update_attempt_confidence. */
export function reviewStateToRow(s: Omit<ReviewState, "lastAttemptId">) {
  return {
    mastery: s.mastery,
    times_seen: s.timesSeen,
    times_correct: s.timesCorrect,
    times_incorrect: s.timesIncorrect,
    correct_streak: s.correctStreak,
    interval_days: s.intervalDays,
    due_at: s.dueAt,
    last_answered_at: s.lastAnsweredAt,
    last_result: s.lastResult,
    last_confidence: s.lastConfidence,
    last_missed_at: s.lastMissedAt,
  };
}

export interface AttemptRow {
  id: string;
  user_id: string;
  question_id: string;
  quiz_session_id: string | null;
  exam_session_id: string | null;
  selected_choice_ids: string[];
  is_correct: boolean;
  confidence: Confidence | null;
  time_spent_ms: number;
  answered_at: string;
  state_before: ReviewState | null;
}

export function mapAttempt(r: AttemptRow): AttemptRecord {
  return {
    id: r.id,
    userId: r.user_id,
    questionId: r.question_id,
    quizSessionId: r.quiz_session_id,
    examSessionId: r.exam_session_id,
    selectedChoiceIds: r.selected_choice_ids ?? [],
    isCorrect: r.is_correct,
    confidence: r.confidence,
    timeSpentMs: r.time_spent_ms,
    answeredAt: r.answered_at,
    stateBefore: r.state_before,
  };
}

export interface QuizSessionRow {
  id: string;
  user_id: string;
  mode: StudyMode;
  title: string;
  config: QuizConfig;
  question_ids: string[];
  status: QuizSession["status"];
  answered_count: number;
  correct_count: number;
  time_spent_ms: number | string;
  started_at: string;
  completed_at: string | null;
}

export function mapQuizSession(r: QuizSessionRow): QuizSession {
  return {
    id: r.id,
    userId: r.user_id,
    mode: r.mode,
    title: r.title,
    config: r.config ?? { count: r.question_ids.length },
    questionIds: r.question_ids,
    status: r.status,
    startedAt: r.started_at,
    completedAt: r.completed_at,
    answeredCount: r.answered_count,
    correctCount: r.correct_count,
    timeSpentMs: Number(r.time_spent_ms),
  };
}

export interface ExamRow {
  id: string;
  user_id: string;
  preset_id: string;
  title: string;
  question_ids: string[];
  time_limit_seconds: number;
  started_at: string;
  expires_at: string;
  submitted_at: string | null;
  status: ExamSession["status"];
  result: ExamResult | null;
}

export function mapExam(r: ExamRow, responses: { question_id: string; selected_choice_ids: string[]; flagged: boolean }[]): ExamSession {
  return {
    id: r.id,
    userId: r.user_id,
    presetId: r.preset_id,
    title: r.title,
    questionIds: r.question_ids,
    timeLimitSeconds: r.time_limit_seconds,
    startedAt: r.started_at,
    expiresAt: r.expires_at,
    submittedAt: r.submitted_at,
    status: r.status,
    responses: Object.fromEntries(
      responses.map((x): [string, ExamResponse] => [x.question_id, { selectedChoiceIds: x.selected_choice_ids ?? [], flagged: x.flagged }]),
    ),
    result: r.result,
  };
}

export function mapSettings(r: Record<string, unknown>): UserSettings {
  return {
    theme: r.theme as UserSettings["theme"],
    dailyGoal: Number(r.daily_goal),
    defaultQuizSize: Number(r.default_quiz_size),
    defaultDifficulty: r.default_difficulty as UserSettings["defaultDifficulty"],
    showExplanationsImmediately: Boolean(r.show_explanations_immediately),
    confidenceEnabled: Boolean(r.confidence_enabled),
    timerEnabled: Boolean(r.timer_enabled),
    timezone: String(r.timezone ?? "UTC"),
  };
}
