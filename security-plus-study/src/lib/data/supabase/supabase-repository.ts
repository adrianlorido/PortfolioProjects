import "server-only";

import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";

import { TOPIC_RECENCY_ALPHA } from "@/lib/config/study";
import { DEFAULT_SETTINGS } from "@/lib/config/defaults";
import { toUpsertPayload } from "@/lib/questions/upsert-payload";
import type {
  AttemptRecord,
  AttemptWrite,
  BankStats,
  CatalogEntry,
  Confidence,
  DailyActivity,
  Difficulty,
  DomainId,
  ExamResponse,
  ExamResult,
  ExamSession,
  Paged,
  QuestionInput,
  QuestionSummary,
  QuizSession,
  ReportReason,
  ReportStatus,
  ReviewState,
  TopicStat,
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
import {
  mapAttempt,
  mapExam,
  mapQuestion,
  mapQuizSession,
  mapReviewState,
  mapSettings,
  QUESTION_SELECT,
  reviewStateToRow,
  type AttemptRow,
  type ExamRow,
  type QuestionRow,
  type QuizSessionRow,
  type ReviewStateRow,
} from "./mappers";

const PAGE = 1000;
const ID_CHUNK = 100;

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function fail(error: PostgrestError | null, context: string): void {
  if (!error) return;
  const code =
    error.code === "23505" ? "conflict" : error.code === "42501" ? "forbidden" : error.code === "P0002" ? "not_found" : error.code === "22023" ? "invalid" : "unknown";
  throw new RepositoryError(`${context}: ${error.message}`, code);
}

export class SupabaseRepository implements Repository {
  readonly kind = "supabase" as const;

  constructor(private readonly db: SupabaseClient) {}

  /** Fetch every row of a query in pages (PostgREST caps responses at 1000 rows). */
  private async fetchAll<T>(
    build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: PostgrestError | null }>,
    context: string,
  ): Promise<T[]> {
    const rows: T[] = [];
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await build(from, from + PAGE - 1);
      fail(error, context);
      rows.push(...(data ?? []));
      if (!data || data.length < PAGE) break;
    }
    return rows;
  }

  // Question bank ------------------------------------------------------------

  async listTopics() {
    const { data, error } = await this.db.from("topics").select("id, name").order("name");
    fail(error, "listTopics");
    return (data ?? []) as { id: string; name: string }[];
  }

  async getCatalog(filter?: CatalogFilter): Promise<CatalogEntry[]> {
    type CatalogRow = { id: string; domain_id: number; difficulty: Difficulty; question_type: "single" | "multiple"; is_scenario: boolean; topic_ids: string[] };
    const run = (ids?: string[]) =>
      this.fetchAll<CatalogRow>((from, to) => {
        let q = this.db
          .from("question_catalog")
          .select("id, domain_id, difficulty, question_type, is_scenario, topic_ids")
          .eq("status", "published")
          .order("id")
          .range(from, to);
        if (filter?.domainIds?.length) q = q.in("domain_id", filter.domainIds);
        if (filter?.difficulties?.length) q = q.in("difficulty", filter.difficulties);
        if (filter?.topicIds?.length) q = q.overlaps("topic_ids", filter.topicIds);
        if (ids) q = q.in("id", ids);
        return q;
      }, "getCatalog");
    const rows = filter?.ids ? (await Promise.all(chunk(filter.ids, ID_CHUNK).map((ids) => run(ids)))).flat() : await run();
    return rows.map((r) => ({
      id: r.id,
      domainId: r.domain_id as DomainId,
      topics: r.topic_ids ?? [],
      difficulty: r.difficulty,
      questionType: r.question_type,
      isScenario: r.is_scenario,
    }));
  }

  async getBankStats(): Promise<BankStats> {
    const { data, error } = await this.db.rpc("bank_stats");
    fail(error, "getBankStats");
    const raw = (data ?? {}) as { total?: number; by_domain?: Record<string, number>; by_topic?: Record<string, number>; by_difficulty?: Record<string, number> };
    return {
      total: raw.total ?? 0,
      byDomain: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, ...Object.fromEntries(Object.entries(raw.by_domain ?? {}).map(([k, v]) => [Number(k), v])) },
      byTopic: raw.by_topic ?? {},
      byDifficulty: { easy: 0, medium: 0, hard: 0, ...(raw.by_difficulty ?? {}) },
    };
  }

  async getQuestions(ids: string[]) {
    if (ids.length === 0) return [];
    const results = await Promise.all(
      chunk([...new Set(ids)], ID_CHUNK).map(async (part) => {
        const { data, error } = await this.db.from("questions").select(QUESTION_SELECT).in("id", part);
        fail(error, "getQuestions");
        return (data ?? []) as unknown as QuestionRow[];
      }),
    );
    return results.flat().map(mapQuestion);
  }

  async getQuestion(id: string) {
    const { data, error } = await this.db.from("questions").select(QUESTION_SELECT).eq("id", id).maybeSingle();
    fail(error, "getQuestion");
    return data ? mapQuestion(data as unknown as QuestionRow) : null;
  }

  async listQuestions(params: QuestionListParams): Promise<Paged<QuestionSummary>> {
    const { data, error } = await this.db.rpc("search_questions", {
      p_query: params.query ?? "",
      p_domain: params.domainId ?? null,
      p_topic: params.topicId ?? null,
      p_difficulty: params.difficulty ?? null,
      p_status: params.status === "all" ? null : (params.status ?? "published"),
      p_limit: params.pageSize,
      p_offset: (params.page - 1) * params.pageSize,
    });
    fail(error, "listQuestions");
    const hits = (data ?? []) as { id: string; total_count: number }[];
    const total = hits[0] ? Number(hits[0].total_count) : 0;
    if (hits.length === 0) return { items: [], total, page: params.page, pageSize: params.pageSize };
    const { data: rows, error: rowError } = await this.db
      .from("questions")
      .select("id, stem, domain_id, difficulty, question_type, status, updated_at, question_topics(topic_id)")
      .in(
        "id",
        hits.map((h) => h.id),
      );
    fail(rowError, "listQuestions");
    type Row = { id: string; stem: string; domain_id: number; difficulty: Difficulty; question_type: "single" | "multiple"; status: "published" | "draft"; updated_at: string; question_topics: { topic_id: string }[] };
    const byId = new Map(((rows ?? []) as Row[]).map((r) => [r.id, r]));
    const items = hits
      .map((h) => byId.get(h.id))
      .filter((r): r is Row => !!r)
      .map((r) => ({
        id: r.id,
        stem: r.stem,
        domainId: r.domain_id as DomainId,
        topics: r.question_topics.map((t) => t.topic_id),
        difficulty: r.difficulty,
        questionType: r.question_type,
        status: r.status,
        updatedAt: r.updated_at,
      }));
    return { items, total, page: params.page, pageSize: params.pageSize };
  }

  async findExistingStems(stems: string[]) {
    if (stems.length === 0) return [];
    const { data, error } = await this.db.rpc("find_existing_stems", { p_stems: stems });
    fail(error, "findExistingStems");
    const keys = new Set((data ?? []) as string[]);
    const key = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    return stems.filter((s) => keys.has(key(s)));
  }

  async saveQuestions(inputs: QuestionInput[], actorId: string) {
    void actorId; // created_by is set from auth.uid() inside the database.
    const ids: string[] = [];
    for (const part of chunk(inputs, 50)) {
      const { data, error } = await this.db.rpc("upsert_questions", { p_questions: part.map(toUpsertPayload) });
      fail(error, "saveQuestions");
      ids.push(...((data ?? []) as string[]));
    }
    return ids;
  }

  async deleteQuestion(id: string) {
    const { error } = await this.db.from("questions").delete().eq("id", id);
    fail(error, "deleteQuestion");
  }

  // Reports ------------------------------------------------------------------

  async createReport(userId: string, input: { questionId: string; reason: ReportReason; details: string }) {
    const { error } = await this.db
      .from("question_reports")
      .insert({ user_id: userId, question_id: input.questionId, reason: input.reason, details: input.details });
    fail(error, "createReport");
  }

  async listReports(status?: ReportStatus) {
    let q = this.db
      .from("question_reports")
      .select("id, user_id, question_id, reason, details, status, created_at, questions(stem)")
      .order("created_at", { ascending: false })
      .limit(200);
    if (status) q = q.eq("status", status);
    const { data, error } = await q;
    fail(error, "listReports");
    type Row = { id: string; user_id: string; question_id: string; reason: ReportReason; details: string; status: ReportStatus; created_at: string; questions: { stem: string } | null };
    return ((data ?? []) as unknown as Row[]).map((r) => ({
      id: r.id,
      userId: r.user_id,
      questionId: r.question_id,
      reason: r.reason,
      details: r.details,
      status: r.status,
      createdAt: r.created_at,
      questionStem: r.questions?.stem ?? "(deleted question)",
    }));
  }

  async updateReportStatus(id: string, status: ReportStatus) {
    const { error } = await this.db.from("question_reports").update({ status }).eq("id", id);
    fail(error, "updateReportStatus");
  }

  // Profile & settings -------------------------------------------------------

  async getSettings(userId: string): Promise<UserSettings> {
    const { data, error } = await this.db.from("user_settings").select("*").eq("user_id", userId).maybeSingle();
    fail(error, "getSettings");
    return data ? mapSettings(data) : { ...DEFAULT_SETTINGS };
  }

  async saveSettings(userId: string, s: UserSettings) {
    const { error } = await this.db.from("user_settings").upsert(
      {
        user_id: userId,
        theme: s.theme,
        daily_goal: s.dailyGoal,
        default_quiz_size: s.defaultQuizSize,
        default_difficulty: s.defaultDifficulty,
        show_explanations_immediately: s.showExplanationsImmediately,
        confidence_enabled: s.confidenceEnabled,
        timer_enabled: s.timerEnabled,
        timezone: s.timezone,
      },
      { onConflict: "user_id" },
    );
    fail(error, "saveSettings");
  }

  async updateDisplayName(userId: string, displayName: string) {
    const { error } = await this.db.from("profiles").update({ display_name: displayName }).eq("id", userId);
    fail(error, "updateDisplayName");
  }

  // Learning state -----------------------------------------------------------

  async getReviewStates(userId: string, questionIds?: string[]) {
    if (questionIds) {
      if (questionIds.length === 0) return [];
      const parts = await Promise.all(
        chunk([...new Set(questionIds)], ID_CHUNK).map(async (ids) => {
          const { data, error } = await this.db.from("review_schedule").select("*").eq("user_id", userId).in("question_id", ids);
          fail(error, "getReviewStates");
          return (data ?? []) as ReviewStateRow[];
        }),
      );
      return parts.flat().map(mapReviewState);
    }
    const rows = await this.fetchAll<ReviewStateRow>(
      (from, to) => this.db.from("review_schedule").select("*").eq("user_id", userId).order("question_id").range(from, to),
      "getReviewStates",
    );
    return rows.map(mapReviewState);
  }

  async getTopicStats(userId: string): Promise<TopicStat[]> {
    type Row = { topic_id: string; attempts: number; correct: number; recent_accuracy: number | string; last_attempt_at: string };
    const rows = await this.fetchAll<Row>(
      (from, to) => this.db.from("topic_mastery").select("*").eq("user_id", userId).order("topic_id").range(from, to),
      "getTopicStats",
    );
    return rows.map((r) => ({
      topicId: r.topic_id,
      attempts: r.attempts,
      correct: r.correct,
      recentAccuracy: Number(r.recent_accuracy),
      lastAttemptAt: r.last_attempt_at,
    }));
  }

  async getActivity(userId: string, sinceDate?: string): Promise<DailyActivity[]> {
    type Row = { activity_date: string; questions_answered: number; questions_correct: number; time_spent_ms: number | string };
    const rows = await this.fetchAll<Row>((from, to) => {
      let q = this.db.from("study_activity").select("*").eq("user_id", userId).order("activity_date").range(from, to);
      if (sinceDate) q = q.gte("activity_date", sinceDate);
      return q;
    }, "getActivity");
    return rows.map((r) => ({ date: r.activity_date, answered: r.questions_answered, correct: r.questions_correct, timeSpentMs: Number(r.time_spent_ms) }));
  }

  private toAttemptItem(w: AttemptWrite) {
    return {
      question_id: w.questionId,
      quiz_session_id: w.quizSessionId,
      exam_session_id: w.examSessionId,
      selected_choice_ids: w.selectedChoiceIds,
      is_correct: w.isCorrect,
      confidence: w.confidence,
      time_spent_ms: Math.round(w.timeSpentMs),
      answered_at: w.answeredAt,
      activity_date: w.activityDate,
      state_before: w.stateBefore,
      state: reviewStateToRow(w.stateAfter),
    };
  }

  async recordAttempts(userId: string, writes: AttemptWrite[]) {
    void userId; // The database uses auth.uid().
    const { data, error } = await this.db.rpc("record_attempts", {
      p_items: writes.map((w) => this.toAttemptItem(w)),
      p_topic_alpha: TOPIC_RECENCY_ALPHA,
    });
    fail(error, "recordAttempts");
    return ((data ?? []) as AttemptRow[]).map(mapAttempt);
  }

  async getAttempt(userId: string, attemptId: string) {
    const { data, error } = await this.db.from("attempts").select("*").eq("id", attemptId).eq("user_id", userId).maybeSingle();
    fail(error, "getAttempt");
    return data ? mapAttempt(data as AttemptRow) : null;
  }

  async getAttemptsByIds(userId: string, attemptIds: string[]) {
    if (attemptIds.length === 0) return [];
    const parts = await Promise.all(
      chunk(attemptIds, ID_CHUNK).map(async (ids) => {
        const { data, error } = await this.db.from("attempts").select("*").eq("user_id", userId).in("id", ids);
        fail(error, "getAttemptsByIds");
        return (data ?? []) as AttemptRow[];
      }),
    );
    return parts.flat().map(mapAttempt);
  }

  async getSessionAttempts(userId: string, ref: { quizSessionId?: string; examSessionId?: string }): Promise<AttemptRecord[]> {
    let q = this.db.from("attempts").select("*").eq("user_id", userId).order("answered_at");
    if (ref.quizSessionId) q = q.eq("quiz_session_id", ref.quizSessionId);
    else if (ref.examSessionId) q = q.eq("exam_session_id", ref.examSessionId);
    else return [];
    const { data, error } = await q.limit(500);
    fail(error, "getSessionAttempts");
    return ((data ?? []) as AttemptRow[]).map(mapAttempt);
  }

  async applyConfidence(userId: string, attemptId: string, confidence: Confidence, state: Omit<ReviewState, "lastAttemptId"> | null) {
    void userId;
    const { error } = await this.db.rpc("update_attempt_confidence", {
      p_attempt_id: attemptId,
      p_confidence: confidence,
      p_state: state ? reviewStateToRow(state) : null,
    });
    fail(error, "applyConfidence");
  }

  async listReviewStates(userId: string, filter: ReviewListFilter, page: number, pageSize: number): Promise<Paged<ReviewState>> {
    const { data, error } = await this.db.rpc("list_review_items", {
      p_result: filter.result ?? null,
      p_confidence: filter.confidence ?? null,
      p_bookmarked: filter.bookmarkedOnly ?? false,
      p_domain: filter.domainId ?? null,
      p_topic: filter.topicId ?? null,
      p_difficulty: filter.difficulty ?? null,
      p_limit: pageSize,
      p_offset: (page - 1) * pageSize,
    });
    fail(error, "listReviewStates");
    const hits = (data ?? []) as { question_id: string; total_count: number }[];
    const states = await this.getReviewStates(
      userId,
      hits.map((h) => h.question_id),
    );
    const byId = new Map(states.map((s) => [s.questionId, s]));
    return {
      items: hits.map((h) => byId.get(h.question_id)).filter((s): s is ReviewState => !!s),
      total: hits[0] ? Number(hits[0].total_count) : 0,
      page,
      pageSize,
    };
  }

  async resetProgress(userId: string) {
    void userId;
    const { error } = await this.db.rpc("reset_my_progress");
    fail(error, "resetProgress");
  }

  // Bookmarks & notes --------------------------------------------------------

  async listBookmarks(userId: string) {
    const rows = await this.fetchAll<{ question_id: string; created_at: string }>(
      (from, to) =>
        this.db.from("bookmarks").select("question_id, created_at").eq("user_id", userId).order("created_at", { ascending: false }).range(from, to),
      "listBookmarks",
    );
    return rows.map((r) => ({ questionId: r.question_id, createdAt: r.created_at }));
  }

  async setBookmark(userId: string, questionId: string, bookmarked: boolean) {
    const { error } = bookmarked
      ? await this.db.from("bookmarks").upsert({ user_id: userId, question_id: questionId }, { onConflict: "user_id,question_id", ignoreDuplicates: true })
      : await this.db.from("bookmarks").delete().eq("user_id", userId).eq("question_id", questionId);
    fail(error, "setBookmark");
  }

  async getNotes(userId: string, questionIds: string[]) {
    if (questionIds.length === 0) return [];
    const parts = await Promise.all(
      chunk(questionIds, ID_CHUNK).map(async (ids) => {
        const { data, error } = await this.db
          .from("question_notes")
          .select("question_id, body, updated_at")
          .eq("user_id", userId)
          .in("question_id", ids);
        fail(error, "getNotes");
        return (data ?? []) as { question_id: string; body: string; updated_at: string }[];
      }),
    );
    return parts.flat().map((r) => ({ questionId: r.question_id, body: r.body, updatedAt: r.updated_at }));
  }

  async saveNote(userId: string, questionId: string, body: string) {
    if (!body.trim()) {
      const { error } = await this.db.from("question_notes").delete().eq("user_id", userId).eq("question_id", questionId);
      fail(error, "saveNote");
      return null;
    }
    const { data, error } = await this.db
      .from("question_notes")
      .upsert({ user_id: userId, question_id: questionId, body }, { onConflict: "user_id,question_id" })
      .select("question_id, body, updated_at")
      .single();
    fail(error, "saveNote");
    const row = data as { question_id: string; body: string; updated_at: string };
    return { questionId: row.question_id, body: row.body, updatedAt: row.updated_at };
  }

  // Study sessions -----------------------------------------------------------

  async createQuizSession(userId: string, session: NewQuizSession) {
    const { data, error } = await this.db
      .from("quiz_sessions")
      .insert({ user_id: userId, mode: session.mode, title: session.title, config: session.config, question_ids: session.questionIds })
      .select("*")
      .single();
    fail(error, "createQuizSession");
    return mapQuizSession(data as QuizSessionRow);
  }

  async getQuizSession(userId: string, id: string): Promise<QuizSession | null> {
    const { data, error } = await this.db.from("quiz_sessions").select("*").eq("id", id).eq("user_id", userId).maybeSingle();
    fail(error, "getQuizSession");
    return data ? mapQuizSession(data as QuizSessionRow) : null;
  }

  async completeQuizSession(userId: string, id: string, status: "completed" | "abandoned") {
    const { error } = await this.db
      .from("quiz_sessions")
      .update({ status, completed_at: new Date().toISOString() })
      .eq("id", id)
      .eq("user_id", userId)
      .eq("status", "active");
    fail(error, "completeQuizSession");
  }

  async listQuizSessions(userId: string, limit: number) {
    const { data, error } = await this.db
      .from("quiz_sessions")
      .select("*")
      .eq("user_id", userId)
      .order("started_at", { ascending: false })
      .limit(limit);
    fail(error, "listQuizSessions");
    return ((data ?? []) as QuizSessionRow[]).map(mapQuizSession);
  }

  // Exams --------------------------------------------------------------------

  async createExamSession(userId: string, exam: NewExamSession): Promise<ExamSession> {
    const startedAt = new Date();
    const { data, error } = await this.db
      .from("exam_sessions")
      .insert({
        user_id: userId,
        preset_id: exam.presetId,
        title: exam.title,
        question_ids: exam.questionIds,
        time_limit_seconds: exam.timeLimitSeconds,
        started_at: startedAt.toISOString(),
        expires_at: new Date(startedAt.getTime() + exam.timeLimitSeconds * 1000).toISOString(),
      })
      .select("*")
      .single();
    fail(error, "createExamSession");
    return mapExam(data as ExamRow, []);
  }

  async getExamSession(userId: string, id: string) {
    const { data, error } = await this.db.from("exam_sessions").select("*").eq("id", id).eq("user_id", userId).maybeSingle();
    fail(error, "getExamSession");
    if (!data) return null;
    const { data: responses, error: responseError } = await this.db
      .from("exam_responses")
      .select("question_id, selected_choice_ids, flagged")
      .eq("exam_session_id", id)
      .eq("user_id", userId);
    fail(responseError, "getExamSession");
    return mapExam(data as ExamRow, (responses ?? []) as { question_id: string; selected_choice_ids: string[]; flagged: boolean }[]);
  }

  async saveExamResponse(userId: string, examId: string, questionId: string, response: ExamResponse) {
    const { error } = await this.db.from("exam_responses").upsert(
      {
        exam_session_id: examId,
        question_id: questionId,
        user_id: userId,
        selected_choice_ids: response.selectedChoiceIds,
        flagged: response.flagged,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "exam_session_id,question_id" },
    );
    if (error?.code === "42501") throw new RepositoryError("Exam already submitted", "conflict");
    fail(error, "saveExamResponse");
  }

  async finalizeExam(userId: string, examId: string, result: ExamResult, writes: AttemptWrite[]) {
    const { error } = await this.db.rpc("finalize_exam", {
      p_exam_id: examId,
      p_result: result,
      p_items: writes.map((w) => this.toAttemptItem({ ...w, examSessionId: null })),
      p_topic_alpha: TOPIC_RECENCY_ALPHA,
    });
    fail(error, "finalizeExam");
    const exam = await this.getExamSession(userId, examId);
    if (!exam) throw new RepositoryError("Exam not found", "not_found");
    return exam;
  }

  async listExamSessions(userId: string, limit: number) {
    const { data, error } = await this.db
      .from("exam_sessions")
      .select("*")
      .eq("user_id", userId)
      .order("started_at", { ascending: false })
      .limit(limit);
    fail(error, "listExamSessions");
    return ((data ?? []) as ExamRow[]).map((r) => mapExam(r, []));
  }
}

