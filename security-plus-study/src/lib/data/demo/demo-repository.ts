import "server-only";

import { randomUUID } from "node:crypto";

import { bankStatsFromCatalog } from "@/lib/analytics/stats";
import { DEFAULT_SETTINGS } from "@/lib/config/defaults";
import { getTopicKeywords } from "@/lib/config/topics";
import { toCatalogEntry, toSummary } from "@/lib/questions/transform";
import type {
  AttemptWrite,
  CatalogEntry,
  Confidence,
  ExamResponse,
  ExamResult,
  Paged,
  Question,
  QuestionInput,
  QuestionSummary,
  ReportReason,
  ReportStatus,
  ReviewState,
  UserSettings,
} from "@/lib/types";
import {
  RepositoryError,
  type CatalogFilter,
  type NewExamSession,
  type NewQuizSession,
  type QuestionListParams,
  type Repository,
  type ReviewListFilter,
} from "../repository";
import { applyAttemptWrite, insertExamSession, insertQuizSession } from "./operations";
import { getDemoStore, type DemoData } from "./store";

const clone = <T>(value: T): T => structuredClone(value);

function stemKey(stem: string): string {
  return stem.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function matchesCatalogFilter(q: CatalogEntry, filter?: CatalogFilter): boolean {
  if (!filter) return true;
  if (filter.ids && !filter.ids.includes(q.id)) return false;
  if (filter.domainIds?.length && !filter.domainIds.includes(q.domainId)) return false;
  if (filter.difficulties?.length && !filter.difficulties.includes(q.difficulty)) return false;
  if (filter.topicIds?.length && !q.topics.some((t) => filter.topicIds!.includes(t))) return false;
  return true;
}

/** Relevance score for simple local search; 0 means no match. */
function searchScore(q: Question, data: DemoData, query: string): number {
  const needle = query.trim().toLowerCase();
  if (!needle) return 1;
  let score = 0;
  for (const topicId of q.topics) {
    const name = data.topics[topicId]?.name.toLowerCase() ?? topicId;
    if (name === needle || topicId === needle) score += 5;
    else if (name.includes(needle)) score += 3;
    if (getTopicKeywords(topicId).some((k) => k === needle)) score += 3;
  }
  const words = needle.split(/\s+/).filter(Boolean);
  const haystacks: [string, number][] = [
    [q.stem, 2],
    [q.examClue + " " + q.memoryTip, 1.5],
    [q.explanation, 1],
    [q.choices.map((c) => `${c.text} ${c.explanation ?? ""}`).join(" "), 1],
  ];
  for (const [text, weight] of haystacks) {
    const lower = text.toLowerCase();
    if (lower.includes(needle)) score += weight * 2;
    else if (words.length > 1 && words.every((w) => lower.includes(w))) score += weight;
  }
  return score;
}

export class DemoRepository implements Repository {
  readonly kind = "demo" as const;
  private store = getDemoStore();

  // Question bank ------------------------------------------------------------

  async listTopics() {
    return this.store.read((d) => Object.values(d.topics).sort((a, b) => a.name.localeCompare(b.name)).map(clone));
  }

  async getCatalog(filter?: CatalogFilter) {
    return this.store.read((d) =>
      Object.values(d.questions)
        .filter((q) => q.status === "published")
        .map(toCatalogEntry)
        .filter((q) => matchesCatalogFilter(q, filter)),
    );
  }

  async getBankStats() {
    return bankStatsFromCatalog(await this.getCatalog());
  }

  async getQuestions(ids: string[]) {
    return this.store.read((d) => ids.map((id) => d.questions[id]).filter(Boolean).map(clone));
  }

  async getQuestion(id: string) {
    return this.store.read((d) => (d.questions[id] ? clone(d.questions[id]) : null));
  }

  async listQuestions(params: QuestionListParams): Promise<Paged<QuestionSummary>> {
    return this.store.read((d) => {
      const status = params.status ?? "published";
      const scored = Object.values(d.questions)
        .filter((q) => status === "all" || q.status === status)
        .filter((q) => !params.domainId || q.domainId === params.domainId)
        .filter((q) => !params.difficulty || q.difficulty === params.difficulty)
        .filter((q) => !params.topicId || q.topics.includes(params.topicId))
        .map((q) => ({ q, score: searchScore(q, d, params.query ?? "") }))
        .filter((x) => x.score > 0)
        .sort((a, b) => b.score - a.score || b.q.updatedAt.localeCompare(a.q.updatedAt) || a.q.id.localeCompare(b.q.id));
      const start = (params.page - 1) * params.pageSize;
      return {
        items: scored.slice(start, start + params.pageSize).map((x) => toSummary(x.q)),
        total: scored.length,
        page: params.page,
        pageSize: params.pageSize,
      };
    });
  }

  async findExistingStems(stems: string[]) {
    return this.store.read((d) => {
      const existing = new Set(Object.values(d.questions).map((q) => stemKey(q.stem)));
      return stems.filter((s) => existing.has(stemKey(s)));
    });
  }

  async saveQuestions(inputs: QuestionInput[], actorId: string) {
    void actorId;
    return this.store.mutate((d) =>
      inputs.map((input) => {
        const id = input.id ?? randomUUID();
        const existing = d.questions[id];
        const now = new Date().toISOString();
        for (const t of input.topics) d.topics[t.id] ??= t;
        const correctCount = input.choices.filter((c) => c.isCorrect).length;
        if (correctCount < 1) throw new RepositoryError("A question needs at least one correct choice", "invalid");
        const existingChoiceIds = new Set(existing?.choices.map((c) => c.id) ?? []);
        d.questions[id] = {
          id,
          stem: input.stem,
          choices: input.choices.map((c) => ({
            id: c.id && (existingChoiceIds.has(c.id) || !existing) ? c.id : randomUUID(),
            text: c.text,
            isCorrect: c.isCorrect,
            explanation: c.explanation,
          })),
          domainId: input.domainId,
          topics: input.topics.map((t) => t.id),
          difficulty: input.difficulty,
          questionType: correctCount > 1 ? "multiple" : "single",
          correctCount,
          explanation: input.explanation,
          examClue: input.examClue,
          memoryTip: input.memoryTip,
          isScenario: input.isScenario,
          status: input.status,
          createdAt: existing?.createdAt ?? now,
          updatedAt: now,
        };
        return id;
      }),
    );
  }

  async deleteQuestion(id: string) {
    this.store.mutate((d) => {
      delete d.questions[id];
      for (const [attemptId, a] of Object.entries(d.attempts)) if (a.questionId === id) delete d.attempts[attemptId];
      for (const states of Object.values(d.reviewStates)) delete states[id];
      for (const marks of Object.values(d.bookmarks)) delete marks[id];
      for (const notes of Object.values(d.notes)) delete notes[id];
      for (const [reportId, r] of Object.entries(d.reports)) if (r.questionId === id) delete d.reports[reportId];
    });
  }

  // Reports ------------------------------------------------------------------

  async createReport(userId: string, input: { questionId: string; reason: ReportReason; details: string }) {
    this.store.mutate((d) => {
      if (!d.questions[input.questionId]) throw new RepositoryError("Question not found", "not_found");
      const id = randomUUID();
      d.reports[id] = { id, userId, ...input, status: "open", createdAt: new Date().toISOString() };
    });
  }

  async listReports(status?: ReportStatus) {
    return this.store.read((d) =>
      Object.values(d.reports)
        .filter((r) => !status || r.status === status)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .map((r) => ({ ...r, questionStem: d.questions[r.questionId]?.stem ?? "(deleted question)" })),
    );
  }

  async updateReportStatus(id: string, status: ReportStatus) {
    this.store.mutate((d) => {
      if (!d.reports[id]) throw new RepositoryError("Report not found", "not_found");
      d.reports[id].status = status;
    });
  }

  // Profile & settings -------------------------------------------------------

  async getSettings(userId: string): Promise<UserSettings> {
    return this.store.read((d) => ({ ...DEFAULT_SETTINGS, ...d.settings[userId] }));
  }

  async saveSettings(userId: string, settings: UserSettings) {
    this.store.mutate((d) => {
      d.settings[userId] = { ...settings };
    });
  }

  async updateDisplayName(userId: string, displayName: string) {
    this.store.mutate((d) => {
      const user = d.users.find((u) => u.id === userId);
      if (user) user.displayName = displayName;
    });
  }

  // Learning state -----------------------------------------------------------

  async getReviewStates(userId: string, questionIds?: string[]) {
    return this.store.read((d) => {
      const states = d.reviewStates[userId] ?? {};
      const list = questionIds ? questionIds.map((id) => states[id]).filter(Boolean) : Object.values(states);
      return list.filter((s) => d.questions[s.questionId]).map(clone);
    });
  }

  async getTopicStats(userId: string) {
    return this.store.read((d) => Object.values(d.topicStats[userId] ?? {}).map(clone));
  }

  async getActivity(userId: string, sinceDate?: string) {
    return this.store.read((d) =>
      Object.values(d.activity[userId] ?? {})
        .filter((a) => !sinceDate || a.date >= sinceDate)
        .sort((a, b) => a.date.localeCompare(b.date))
        .map(clone),
    );
  }

  async recordAttempts(userId: string, writes: AttemptWrite[]) {
    return this.store.mutate((d) => {
      for (const w of writes) {
        if (!d.questions[w.questionId]) throw new RepositoryError("Question not found", "not_found");
        if (w.quizSessionId) {
          const session = d.quizSessions[w.quizSessionId];
          if (!session || session.userId !== userId) throw new RepositoryError("Session not found", "forbidden");
          const duplicate = Object.values(d.attempts).some((a) => a.quizSessionId === w.quizSessionId && a.questionId === w.questionId);
          if (duplicate) throw new RepositoryError("Question already answered in this session", "conflict");
        }
      }
      return writes.map((w) => clone(applyAttemptWrite(d, userId, w)));
    });
  }

  async getAttempt(userId: string, attemptId: string) {
    return this.store.read((d) => {
      const attempt = d.attempts[attemptId];
      return attempt && attempt.userId === userId ? clone(attempt) : null;
    });
  }

  async getAttemptsByIds(userId: string, attemptIds: string[]) {
    return this.store.read((d) =>
      attemptIds.map((id) => d.attempts[id]).filter((a) => a && a.userId === userId).map(clone),
    );
  }

  async getSessionAttempts(userId: string, ref: { quizSessionId?: string; examSessionId?: string }) {
    return this.store.read((d) =>
      Object.values(d.attempts)
        .filter(
          (a) =>
            a.userId === userId &&
            ((ref.quizSessionId && a.quizSessionId === ref.quizSessionId) || (ref.examSessionId && a.examSessionId === ref.examSessionId)),
        )
        .sort((a, b) => a.answeredAt.localeCompare(b.answeredAt))
        .map(clone),
    );
  }

  async applyConfidence(
    userId: string,
    attemptId: string,
    confidence: Confidence,
    state: Omit<ReviewState, "lastAttemptId"> | null,
  ) {
    this.store.mutate((d) => {
      const attempt = d.attempts[attemptId];
      if (!attempt || attempt.userId !== userId) throw new RepositoryError("Attempt not found", "not_found");
      attempt.confidence = confidence;
      const current = d.reviewStates[userId]?.[attempt.questionId];
      if (state && current?.lastAttemptId === attemptId) {
        d.reviewStates[userId][attempt.questionId] = {
          ...current,
          mastery: state.mastery,
          correctStreak: state.correctStreak,
          intervalDays: state.intervalDays,
          dueAt: state.dueAt,
          lastConfidence: state.lastConfidence,
        };
      }
    });
  }

  async listReviewStates(userId: string, filter: ReviewListFilter, page: number, pageSize: number): Promise<Paged<ReviewState>> {
    return this.store.read((d) => {
      const marks = d.bookmarks[userId] ?? {};
      const matches = Object.values(d.reviewStates[userId] ?? {})
        .filter((s) => {
          const q = d.questions[s.questionId];
          if (!q) return false;
          if (filter.result && s.lastResult !== (filter.result === "correct")) return false;
          if (filter.confidence && s.lastConfidence !== filter.confidence) return false;
          if (filter.bookmarkedOnly && !marks[s.questionId]) return false;
          if (filter.domainId && q.domainId !== filter.domainId) return false;
          if (filter.difficulty && q.difficulty !== filter.difficulty) return false;
          if (filter.topicId && !q.topics.includes(filter.topicId)) return false;
          return true;
        })
        .sort((a, b) => b.lastAnsweredAt.localeCompare(a.lastAnsweredAt) || a.questionId.localeCompare(b.questionId));
      const start = (page - 1) * pageSize;
      return { items: matches.slice(start, start + pageSize).map(clone), total: matches.length, page, pageSize };
    });
  }

  async resetProgress(userId: string) {
    this.store.mutate((d) => {
      for (const [id, a] of Object.entries(d.attempts)) if (a.userId === userId) delete d.attempts[id];
      delete d.reviewStates[userId];
      delete d.topicStats[userId];
      delete d.activity[userId];
      for (const [id, s] of Object.entries(d.quizSessions)) if (s.userId === userId) delete d.quizSessions[id];
      for (const [id, e] of Object.entries(d.examSessions)) if (e.userId === userId) delete d.examSessions[id];
    });
  }

  // Bookmarks & notes --------------------------------------------------------

  async listBookmarks(userId: string) {
    return this.store.read((d) =>
      Object.entries(d.bookmarks[userId] ?? {})
        .filter(([questionId]) => d.questions[questionId])
        .map(([questionId, createdAt]) => ({ questionId, createdAt }))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    );
  }

  async setBookmark(userId: string, questionId: string, bookmarked: boolean) {
    this.store.mutate((d) => {
      if (!d.questions[questionId]) throw new RepositoryError("Question not found", "not_found");
      const marks = (d.bookmarks[userId] ??= {});
      if (bookmarked) marks[questionId] ??= new Date().toISOString();
      else delete marks[questionId];
    });
  }

  async getNotes(userId: string, questionIds: string[]) {
    return this.store.read((d) => questionIds.map((id) => d.notes[userId]?.[id]).filter(Boolean).map(clone));
  }

  async saveNote(userId: string, questionId: string, body: string) {
    return this.store.mutate((d) => {
      if (!d.questions[questionId]) throw new RepositoryError("Question not found", "not_found");
      const notes = (d.notes[userId] ??= {});
      if (!body.trim()) {
        delete notes[questionId];
        return null;
      }
      notes[questionId] = { questionId, body, updatedAt: new Date().toISOString() };
      return clone(notes[questionId]);
    });
  }

  // Study sessions -----------------------------------------------------------

  async createQuizSession(userId: string, session: NewQuizSession) {
    return this.store.mutate((d) =>
      clone(
        insertQuizSession(d, {
          userId,
          ...session,
          status: "active",
          startedAt: new Date().toISOString(),
          completedAt: null,
          answeredCount: 0,
          correctCount: 0,
          timeSpentMs: 0,
        }),
      ),
    );
  }

  async getQuizSession(userId: string, id: string) {
    return this.store.read((d) => {
      const s = d.quizSessions[id];
      return s && s.userId === userId ? clone(s) : null;
    });
  }

  async completeQuizSession(userId: string, id: string, status: "completed" | "abandoned") {
    this.store.mutate((d) => {
      const s = d.quizSessions[id];
      if (!s || s.userId !== userId) throw new RepositoryError("Session not found", "not_found");
      if (s.status === "active") {
        s.status = status;
        s.completedAt = new Date().toISOString();
      }
    });
  }

  async listQuizSessions(userId: string, limit: number) {
    return this.store.read((d) =>
      Object.values(d.quizSessions)
        .filter((s) => s.userId === userId)
        .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
        .slice(0, limit)
        .map(clone),
    );
  }

  // Exams --------------------------------------------------------------------

  async createExamSession(userId: string, exam: NewExamSession) {
    return this.store.mutate((d) => {
      const startedAt = new Date();
      return clone(
        insertExamSession(d, {
          userId,
          ...exam,
          startedAt: startedAt.toISOString(),
          expiresAt: new Date(startedAt.getTime() + exam.timeLimitSeconds * 1000).toISOString(),
          submittedAt: null,
          status: "in_progress",
          responses: {},
          result: null,
        }),
      );
    });
  }

  async getExamSession(userId: string, id: string) {
    return this.store.read((d) => {
      const e = d.examSessions[id];
      return e && e.userId === userId ? clone(e) : null;
    });
  }

  async saveExamResponse(userId: string, examId: string, questionId: string, response: ExamResponse) {
    this.store.mutate((d) => {
      const exam = d.examSessions[examId];
      if (!exam || exam.userId !== userId) throw new RepositoryError("Exam not found", "not_found");
      if (exam.status !== "in_progress") throw new RepositoryError("Exam already submitted", "conflict");
      exam.responses[questionId] = { selectedChoiceIds: [...response.selectedChoiceIds], flagged: response.flagged };
    });
  }

  async finalizeExam(userId: string, examId: string, result: ExamResult, writes: AttemptWrite[]) {
    return this.store.mutate((d) => {
      const exam = d.examSessions[examId];
      if (!exam || exam.userId !== userId) throw new RepositoryError("Exam not found", "not_found");
      if (exam.status !== "in_progress") return clone(exam);
      for (const w of writes) applyAttemptWrite(d, userId, { ...w, examSessionId: examId });
      exam.status = "submitted";
      exam.submittedAt = new Date().toISOString();
      exam.result = result;
      return clone(exam);
    });
  }

  async listExamSessions(userId: string, limit: number) {
    return this.store.read((d) =>
      Object.values(d.examSessions)
        .filter((e) => e.userId === userId)
        .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
        .slice(0, limit)
        .map((e) => ({ ...clone(e), responses: {} })),
    );
  }
}
