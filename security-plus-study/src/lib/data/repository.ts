import type {
  AttemptRecord,
  AttemptWrite,
  BankStats,
  Bookmark,
  CatalogEntry,
  Confidence,
  DailyActivity,
  Difficulty,
  DomainId,
  ExamResponse,
  ExamResult,
  ExamSession,
  Paged,
  Question,
  QuestionInput,
  QuestionNote,
  QuestionReport,
  QuestionStatus,
  QuestionSummary,
  QuizConfig,
  QuizSession,
  ReportReason,
  ReportStatus,
  ReviewState,
  StudyMode,
  Topic,
  TopicStat,
  UserSettings,
} from "@/lib/types";

export interface CatalogFilter {
  domainIds?: DomainId[];
  topicIds?: string[];
  difficulties?: Difficulty[];
  ids?: string[];
}

export interface QuestionListParams {
  query?: string;
  domainId?: DomainId;
  topicId?: string;
  difficulty?: Difficulty;
  /** Defaults to "published". "all" is only honored for admins by the database. */
  status?: QuestionStatus | "all";
  page: number;
  pageSize: number;
}

export interface ReviewListFilter {
  result?: "correct" | "incorrect";
  confidence?: Confidence;
  bookmarkedOnly?: boolean;
  domainId?: DomainId;
  topicId?: string;
  difficulty?: Difficulty;
}

export interface NewQuizSession {
  mode: StudyMode;
  title: string;
  config: QuizConfig;
  questionIds: string[];
}

export interface NewExamSession {
  presetId: string;
  title: string;
  questionIds: string[];
  timeLimitSeconds: number;
}

export type ReportWithQuestion = QuestionReport & { questionStem: string };

/**
 * Storage contract. Every user-scoped method receives the *verified* user id
 * from the auth layer (never from the browser). The Supabase adapter also
 * relies on RLS, so a wrong id can never read another user's rows.
 */
export interface Repository {
  readonly kind: "demo" | "supabase";

  // Question bank ------------------------------------------------------------
  listTopics(): Promise<Topic[]>;
  getCatalog(filter?: CatalogFilter): Promise<CatalogEntry[]>;
  getBankStats(): Promise<BankStats>;
  getQuestions(ids: string[]): Promise<Question[]>;
  getQuestion(id: string): Promise<Question | null>;
  listQuestions(params: QuestionListParams): Promise<Paged<QuestionSummary>>;
  /** Returns the stems (from the given list) that already exist in the bank. */
  findExistingStems(stems: string[]): Promise<string[]>;
  saveQuestions(inputs: QuestionInput[], actorId: string): Promise<string[]>;
  deleteQuestion(id: string): Promise<void>;

  // Reports ------------------------------------------------------------------
  createReport(userId: string, input: { questionId: string; reason: ReportReason; details: string }): Promise<void>;
  listReports(status?: ReportStatus): Promise<ReportWithQuestion[]>;
  updateReportStatus(id: string, status: ReportStatus): Promise<void>;

  // Profile & settings -------------------------------------------------------
  getSettings(userId: string): Promise<UserSettings>;
  saveSettings(userId: string, settings: UserSettings): Promise<void>;
  updateDisplayName(userId: string, displayName: string): Promise<void>;

  // Learning state -----------------------------------------------------------
  getReviewStates(userId: string, questionIds?: string[]): Promise<ReviewState[]>;
  getTopicStats(userId: string): Promise<TopicStat[]>;
  getActivity(userId: string, sinceDate?: string): Promise<DailyActivity[]>;
  /** Atomically persists graded answers plus schedule, topic, activity and session counters. */
  recordAttempts(userId: string, writes: AttemptWrite[]): Promise<AttemptRecord[]>;
  getAttempt(userId: string, attemptId: string): Promise<AttemptRecord | null>;
  getAttemptsByIds(userId: string, attemptIds: string[]): Promise<AttemptRecord[]>;
  getSessionAttempts(userId: string, ref: { quizSessionId?: string; examSessionId?: string }): Promise<AttemptRecord[]>;
  /** Stores a post-grading confidence rating; replaces the schedule only if the attempt is still the latest. */
  applyConfidence(
    userId: string,
    attemptId: string,
    confidence: Confidence,
    state: Omit<ReviewState, "lastAttemptId"> | null,
  ): Promise<void>;
  listReviewStates(userId: string, filter: ReviewListFilter, page: number, pageSize: number): Promise<Paged<ReviewState>>;
  resetProgress(userId: string): Promise<void>;

  // Bookmarks & notes --------------------------------------------------------
  listBookmarks(userId: string): Promise<Bookmark[]>;
  setBookmark(userId: string, questionId: string, bookmarked: boolean): Promise<void>;
  getNotes(userId: string, questionIds: string[]): Promise<QuestionNote[]>;
  /** Empty body deletes the note. */
  saveNote(userId: string, questionId: string, body: string): Promise<QuestionNote | null>;

  // Study sessions -----------------------------------------------------------
  createQuizSession(userId: string, session: NewQuizSession): Promise<QuizSession>;
  getQuizSession(userId: string, id: string): Promise<QuizSession | null>;
  completeQuizSession(userId: string, id: string, status: "completed" | "abandoned"): Promise<void>;
  listQuizSessions(userId: string, limit: number): Promise<QuizSession[]>;

  // Exams --------------------------------------------------------------------
  createExamSession(userId: string, exam: NewExamSession): Promise<ExamSession>;
  getExamSession(userId: string, id: string): Promise<ExamSession | null>;
  saveExamResponse(userId: string, examId: string, questionId: string, response: ExamResponse): Promise<void>;
  finalizeExam(userId: string, examId: string, result: ExamResult, writes: AttemptWrite[]): Promise<ExamSession>;
  listExamSessions(userId: string, limit: number): Promise<ExamSession[]>;
}

export class RepositoryError extends Error {
  constructor(
    message: string,
    readonly code: "not_found" | "conflict" | "forbidden" | "invalid" | "unknown" = "unknown",
  ) {
    super(message);
    this.name = "RepositoryError";
  }
}
