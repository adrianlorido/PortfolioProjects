import "server-only";

import type { Repository, ReviewListFilter } from "@/lib/data/repository";
import { isDue } from "@/lib/engine/spaced-repetition";
import { toQuizQuestion } from "@/lib/questions/transform";
import type { AppUser, AttemptRecord, Difficulty, DomainId, Question, QuizQuestion, ReviewState } from "@/lib/types";

export interface ReviewFilters {
  result?: "correct" | "incorrect";
  guessed?: boolean;
  bookmarked?: boolean;
  domainId?: DomainId;
  topicId?: string;
  difficulty?: Difficulty;
}

export interface ReviewItem {
  question: Question;
  state: ReviewState | null;
  attempt: AttemptRecord | null;
  /** True for exam questions the learner never answered. */
  unanswered: boolean;
  bookmarked: boolean;
  note: string | null;
}

export interface ReviewPage {
  items: ReviewItem[];
  total: number;
  page: number;
  pageSize: number;
}

function toListFilter(f: ReviewFilters): ReviewListFilter {
  return {
    result: f.result,
    confidence: f.guessed ? "guessed" : undefined,
    bookmarkedOnly: f.bookmarked,
    domainId: f.domainId,
    topicId: f.topicId,
    difficulty: f.difficulty,
  };
}

async function decorate(
  user: AppUser,
  repo: Repository,
  rows: { questionId: string; attempt: AttemptRecord | null; unanswered?: boolean }[],
): Promise<ReviewItem[]> {
  const ids = rows.map((r) => r.questionId);
  const [questions, states, bookmarks, notes] = await Promise.all([
    repo.getQuestions(ids),
    repo.getReviewStates(user.id, ids),
    repo.listBookmarks(user.id),
    repo.getNotes(user.id, ids),
  ]);
  const qById = new Map(questions.map((q) => [q.id, q]));
  const sById = new Map(states.map((s) => [s.questionId, s]));
  const marked = new Set(bookmarks.map((b) => b.questionId));
  const noteById = new Map(notes.map((n) => [n.questionId, n.body]));
  return rows
    .filter((r) => qById.has(r.questionId))
    .map((r) => ({
      question: qById.get(r.questionId)!,
      state: sById.get(r.questionId) ?? null,
      attempt: r.attempt,
      unanswered: Boolean(r.unanswered),
      bookmarked: marked.has(r.questionId),
      note: noteById.get(r.questionId) ?? null,
    }));
}

/** All answered questions (latest attempt per question), newest first. */
export async function getReviewPage(user: AppUser, repo: Repository, filters: ReviewFilters, page: number, pageSize = 10): Promise<ReviewPage> {
  const states = await repo.listReviewStates(user.id, toListFilter(filters), page, pageSize);
  const attempts = await repo.getAttemptsByIds(
    user.id,
    states.items.map((s) => s.lastAttemptId).filter((id): id is string => !!id),
  );
  const attemptById = new Map(attempts.map((a) => [a.id, a]));
  const items = await decorate(
    user,
    repo,
    states.items.map((s) => ({ questionId: s.questionId, attempt: s.lastAttemptId ? attemptById.get(s.lastAttemptId) ?? null : null })),
  );
  return { items, total: states.total, page, pageSize };
}

function applyFilters(items: ReviewItem[], f: ReviewFilters): ReviewItem[] {
  return items.filter((i) => {
    const correct = i.attempt?.isCorrect ?? false;
    if (f.result === "correct" && !correct) return false;
    if (f.result === "incorrect" && correct) return false;
    if (f.guessed && i.attempt?.confidence !== "guessed") return false;
    if (f.bookmarked && !i.bookmarked) return false;
    if (f.domainId && i.question.domainId !== f.domainId) return false;
    if (f.topicId && !i.question.topics.includes(f.topicId)) return false;
    if (f.difficulty && i.question.difficulty !== f.difficulty) return false;
    return true;
  });
}

/** Review scoped to a single quiz session or exam, in the original question order. */
export async function getSessionReview(
  user: AppUser,
  repo: Repository,
  scope: { quizSessionId?: string; examId?: string },
  filters: ReviewFilters,
): Promise<{ title: string; items: ReviewItem[] } | null> {
  if (scope.quizSessionId) {
    const session = await repo.getQuizSession(user.id, scope.quizSessionId);
    if (!session) return null;
    const attempts = await repo.getSessionAttempts(user.id, { quizSessionId: session.id });
    const byQuestion = new Map(attempts.map((a) => [a.questionId, a]));
    const rows = session.questionIds.filter((id) => byQuestion.has(id)).map((id) => ({ questionId: id, attempt: byQuestion.get(id)! }));
    return { title: session.title, items: applyFilters(await decorate(user, repo, rows), filters) };
  }
  if (scope.examId) {
    const exam = await repo.getExamSession(user.id, scope.examId);
    if (!exam || exam.status !== "submitted") return null;
    const attempts = await repo.getSessionAttempts(user.id, { examSessionId: exam.id });
    const byQuestion = new Map(attempts.map((a) => [a.questionId, a]));
    const rows = exam.questionIds.map((id) => ({ questionId: id, attempt: byQuestion.get(id) ?? null, unanswered: !byQuestion.has(id) }));
    return { title: exam.title, items: applyFilters(await decorate(user, repo, rows), filters) };
  }
  return null;
}

export interface QuestionDetail {
  question: QuizQuestion;
  state: ReviewState | null;
  due: boolean;
  bookmarked: boolean;
  note: string | null;
}

export async function getQuestionDetail(user: AppUser, repo: Repository, id: string): Promise<QuestionDetail | null> {
  const question = await repo.getQuestion(id);
  if (!question || (question.status !== "published" && user.role !== "admin")) return null;
  const [[state], bookmarks, [note]] = await Promise.all([
    repo.getReviewStates(user.id, [id]),
    repo.listBookmarks(user.id),
    repo.getNotes(user.id, [id]),
  ]);
  return {
    question: toQuizQuestion(question),
    state: state ?? null,
    due: state ? isDue(state, new Date()) : false,
    bookmarked: bookmarks.some((b) => b.questionId === id),
    note: note?.body ?? null,
  };
}

export interface BookmarkView {
  question: QuizQuestion;
  createdAt: string;
  state: ReviewState | null;
  note: string | null;
}

export async function getBookmarks(user: AppUser, repo: Repository): Promise<BookmarkView[]> {
  const bookmarks = await repo.listBookmarks(user.id);
  const ids = bookmarks.map((b) => b.questionId);
  const [questions, states, notes] = await Promise.all([repo.getQuestions(ids), repo.getReviewStates(user.id, ids), repo.getNotes(user.id, ids)]);
  const qById = new Map(questions.map((q) => [q.id, q]));
  const sById = new Map(states.map((s) => [s.questionId, s]));
  const nById = new Map(notes.map((n) => [n.questionId, n.body]));
  return bookmarks
    .filter((b) => qById.has(b.questionId))
    .map((b) => ({
      question: toQuizQuestion(qById.get(b.questionId)!),
      createdAt: b.createdAt,
      state: sById.get(b.questionId) ?? null,
      note: nById.get(b.questionId) ?? null,
    }));
}
