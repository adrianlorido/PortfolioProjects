import "server-only";

import { toLocalDate } from "@/lib/analytics/dates";
import { getDomain } from "@/lib/config/domains";
import { MAX_SESSION_QUESTIONS } from "@/lib/config/study";
import { getTopicName } from "@/lib/config/topics";
import { RepositoryError, type Repository } from "@/lib/data/repository";
import { gradeAnswer, validateSelection } from "@/lib/engine/grading";
import { buildDailySession, buildQuiz, type QuizBuildContext } from "@/lib/engine/quiz-builder";
import { createRng } from "@/lib/engine/random";
import { domainBreakdown, type GradedItem } from "@/lib/engine/scoring";
import { scheduleReview } from "@/lib/engine/spaced-repetition";
import { correctChoiceIds, toQuizQuestion } from "@/lib/questions/transform";
import type {
  AppUser,
  AttemptRecord,
  Confidence,
  Difficulty,
  DomainId,
  MasteryLevel,
  MissedOrder,
  Question,
  QuestionPool,
  QuizConfig,
  QuizQuestion,
  QuizSession,
  StudyMode,
  UserSettings,
} from "@/lib/types";
import { UserFacingError } from "./errors";
import { buildFeedback, type AnswerFeedback } from "./feedback";

export interface StartQuizRequest {
  mode: StudyMode;
  count: number;
  domainIds?: DomainId[];
  topicIds?: string[];
  difficulties?: Difficulty[];
  pool?: QuestionPool;
  hardMode?: boolean;
  missedOrder?: MissedOrder;
  questionIds?: string[];
  title?: string;
}

const EMPTY_POOL_MESSAGES: Partial<Record<QuestionPool, string>> = {
  missed: "No missed questions yet. Questions you answer incorrectly will show up here.",
  bookmarked: "No bookmarks yet. Bookmark tricky questions during a quiz to review them here.",
  unanswered: "You've answered every question that matches these filters. Try a different pool.",
  due: "Nothing is due for review right now. Nice work!",
  weak: "Answer more questions to generate weak-topic recommendations.",
};

function randomSeed(): number {
  return Math.floor(Math.random() * 2 ** 31);
}

async function buildContext(repo: Repository, userId: string, filterIds?: string[]): Promise<QuizBuildContext> {
  const [catalog, states, bookmarks, topicStats] = await Promise.all([
    repo.getCatalog(filterIds ? { ids: filterIds } : undefined),
    repo.getReviewStates(userId),
    repo.listBookmarks(userId),
    repo.getTopicStats(userId),
  ]);
  return {
    catalog,
    states: new Map(states.map((s) => [s.questionId, s])),
    bookmarks: new Set(bookmarks.map((b) => b.questionId)),
    topicStats,
    now: new Date(),
    rng: createRng(randomSeed()),
  };
}

function sessionTitle(req: StartQuizRequest): string {
  if (req.title) return req.title.slice(0, 120);
  switch (req.mode) {
    case "daily":
      return "Daily study session";
    case "domain":
      return req.domainIds?.length === 1 ? `${getDomain(req.domainIds[0]).name}` : "Domain practice";
    case "topic":
      return req.topicIds?.length === 1 ? `${getTopicName(req.topicIds[0])} focus` : "Topic focus";
    case "weak":
      return "Weakest topics";
    case "missed":
      return "Missed questions";
    case "bookmarked":
      return "Bookmarked questions";
    case "review":
      return "Due for review";
    case "retry":
      return "Retry missed questions";
    default:
      return req.hardMode ? "Hard mode quiz" : "Quick quiz";
  }
}

export async function startQuizSession(user: AppUser, repo: Repository, req: StartQuizRequest): Promise<QuizSession> {
  const count = Math.max(1, Math.min(MAX_SESSION_QUESTIONS, Math.floor(req.count)));
  const ctx = await buildContext(repo, user.id);
  const config: QuizConfig = {
    count,
    domainIds: req.domainIds,
    topicIds: req.topicIds,
    difficulties: req.difficulties,
    pool: req.pool,
    hardMode: req.hardMode,
    missedOrder: req.missedOrder,
    questionIds: req.questionIds,
  };

  let questionIds: string[];
  if (req.mode === "daily") {
    questionIds = buildDailySession(count, ctx, { difficulties: req.difficulties });
  } else {
    const pool: QuestionPool | undefined =
      req.mode === "weak" ? "weak" : req.mode === "missed" ? "missed" : req.mode === "bookmarked" ? "bookmarked" : req.mode === "review" ? "due" : req.pool;
    if (pool === "weak" && ctx.topicStats.length === 0) throw new UserFacingError(EMPTY_POOL_MESSAGES.weak!);
    questionIds = buildQuiz({ ...config, pool }, ctx);
    config.pool = pool;
  }

  if (questionIds.length === 0) {
    const message = (config.pool && EMPTY_POOL_MESSAGES[config.pool]) || "No questions match these filters yet. Try widening your selection.";
    throw new UserFacingError(message);
  }

  return repo.createQuizSession(user.id, { mode: req.mode, title: sessionTitle(req), config, questionIds });
}

export interface LoadedQuizSession {
  session: QuizSession;
  questions: QuizQuestion[];
  answered: Record<string, AnswerFeedback>;
  bookmarkedIds: string[];
  notes: Record<string, string>;
  settings: UserSettings;
}

async function feedbackForAttempts(repo: Repository, userId: string, questions: Question[], attempts: AttemptRecord[]) {
  const states = await repo.getReviewStates(
    userId,
    attempts.map((a) => a.questionId),
  );
  const stateById = new Map(states.map((s) => [s.questionId, s]));
  const byId = new Map(questions.map((q) => [q.id, q]));
  const out: Record<string, AnswerFeedback> = {};
  for (const attempt of attempts) {
    const q = byId.get(attempt.questionId);
    if (!q) continue;
    const state = stateById.get(q.id);
    const isLatest = state?.lastAttemptId === attempt.id;
    const after = isLatest ? state!.mastery : scheduleReview(attempt.stateBefore, q.id, { correct: attempt.isCorrect, confidence: attempt.confidence }, new Date(attempt.answeredAt)).mastery;
    out[q.id] = buildFeedback(q, attempt, after, isLatest ? state!.dueAt : null);
  }
  return out;
}

export async function loadQuizSession(user: AppUser, repo: Repository, sessionId: string): Promise<LoadedQuizSession | null> {
  const session = await repo.getQuizSession(user.id, sessionId);
  if (!session) return null;
  const [questions, attempts, bookmarks, notes, settings] = await Promise.all([
    repo.getQuestions(session.questionIds),
    repo.getSessionAttempts(user.id, { quizSessionId: session.id }),
    repo.listBookmarks(user.id),
    repo.getNotes(user.id, session.questionIds),
    repo.getSettings(user.id),
  ]);
  const byId = new Map(questions.map((q) => [q.id, q]));
  const ordered = session.questionIds.map((id) => byId.get(id)).filter((q): q is Question => !!q);
  const idSet = new Set(session.questionIds);
  return {
    session,
    questions: ordered.map(toQuizQuestion),
    answered: await feedbackForAttempts(repo, user.id, ordered, attempts),
    bookmarkedIds: bookmarks.map((b) => b.questionId).filter((id) => idSet.has(id)),
    notes: Object.fromEntries(notes.map((n) => [n.questionId, n.body])),
    settings,
  };
}

export interface SubmitAnswerRequest {
  sessionId: string;
  questionId: string;
  selectedChoiceIds: string[];
  timeSpentMs: number;
  confidence?: Confidence | null;
}

export async function submitAnswer(user: AppUser, repo: Repository, req: SubmitAnswerRequest): Promise<AnswerFeedback> {
  const session = await repo.getQuizSession(user.id, req.sessionId);
  if (!session) throw new UserFacingError("This study session could not be found.");
  if (!session.questionIds.includes(req.questionId)) throw new UserFacingError("That question is not part of this session.");

  const question = await repo.getQuestion(req.questionId);
  if (!question) throw new UserFacingError("This question is no longer available.");

  const problem = validateSelection(
    question.choices.map((c) => c.id),
    question.correctCount,
    req.selectedChoiceIds,
  );
  if (problem === "wrong_count") throw new UserFacingError(`Select exactly ${question.correctCount} answers.`);
  if (problem) throw new UserFacingError("Please choose a valid answer.");

  const [previous] = await repo.getReviewStates(user.id, [question.id]);
  const settings = await repo.getSettings(user.id);
  const now = new Date();
  const grade = gradeAnswer(correctChoiceIds(question), req.selectedChoiceIds);
  const confidence = req.confidence ?? null;
  const stateAfter = scheduleReview(previous ?? null, question.id, { correct: grade.isCorrect, confidence }, now);

  let attempt: AttemptRecord;
  try {
    [attempt] = await repo.recordAttempts(user.id, [
      {
        questionId: question.id,
        quizSessionId: session.id,
        examSessionId: null,
        selectedChoiceIds: req.selectedChoiceIds,
        isCorrect: grade.isCorrect,
        confidence,
        timeSpentMs: Math.max(0, Math.min(Math.round(req.timeSpentMs), 3_600_000)),
        answeredAt: now.toISOString(),
        activityDate: toLocalDate(now, settings.timezone),
        stateBefore: previous ?? null,
        stateAfter,
      },
    ]);
  } catch (error) {
    // Double submit (e.g. two tabs): return the answer that was already recorded.
    if (error instanceof RepositoryError && error.code === "conflict") {
      const attempts = await repo.getSessionAttempts(user.id, { quizSessionId: session.id });
      const existing = attempts.find((a) => a.questionId === question.id);
      if (existing) return (await feedbackForAttempts(repo, user.id, [question], [existing]))[question.id];
    }
    throw error;
  }

  if (session.answeredCount + 1 >= session.questionIds.length) {
    await repo.completeQuizSession(user.id, session.id, "completed");
  }
  return buildFeedback(question, attempt, stateAfter.mastery, stateAfter.dueAt);
}

/** Apply a confidence rating after grading by re-running the scheduler from the pre-attempt state. */
export async function rateConfidence(
  user: AppUser,
  repo: Repository,
  attemptId: string,
  confidence: Confidence,
): Promise<{ masteryAfter: MasteryLevel; nextReviewAt: string }> {
  const attempt = await repo.getAttempt(user.id, attemptId);
  if (!attempt) throw new UserFacingError("That answer could not be found.");
  const state = scheduleReview(
    attempt.stateBefore,
    attempt.questionId,
    { correct: attempt.isCorrect, confidence },
    new Date(attempt.answeredAt),
  );
  await repo.applyConfidence(user.id, attemptId, confidence, state);
  return { masteryAfter: state.mastery, nextReviewAt: state.dueAt };
}

export interface QuizSummary {
  session: QuizSession;
  items: { question: Question; attempt: AttemptRecord | null }[];
  correct: number;
  answered: number;
  domainBreakdown: ReturnType<typeof domainBreakdown>;
}

export async function getQuizSummary(user: AppUser, repo: Repository, sessionId: string): Promise<QuizSummary | null> {
  const session = await repo.getQuizSession(user.id, sessionId);
  if (!session) return null;
  const [questions, attempts] = await Promise.all([
    repo.getQuestions(session.questionIds),
    repo.getSessionAttempts(user.id, { quizSessionId: session.id }),
  ]);
  const byId = new Map(questions.map((q) => [q.id, q]));
  const attemptByQuestion = new Map(attempts.map((a) => [a.questionId, a]));
  const items = session.questionIds
    .map((id) => byId.get(id))
    .filter((q): q is Question => !!q)
    .map((question) => ({ question, attempt: attemptByQuestion.get(question.id) ?? null }));
  const graded: GradedItem[] = items
    .filter((i) => i.attempt)
    .map((i) => ({ questionId: i.question.id, domainId: i.question.domainId, topics: i.question.topics, isCorrect: i.attempt!.isCorrect }));
  return {
    session,
    items,
    correct: graded.filter((g) => g.isCorrect).length,
    answered: graded.length,
    domainBreakdown: domainBreakdown(graded),
  };
}
