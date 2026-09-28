/**
 * Core domain model shared by the engines, data adapters and UI.
 *
 * Naming note: `stem` is the question text (the spec's `question` field), and
 * each choice carries its own `isCorrect` flag + explanation (the normalized
 * form of `correctAnswer` / `incorrectAnswerExplanations`).
 */

export type DomainId = 1 | 2 | 3 | 4 | 5;
export type Difficulty = "easy" | "medium" | "hard";
export type QuestionType = "single" | "multiple";
export type QuestionStatus = "published" | "draft";
export type Confidence = "guessed" | "unsure" | "confident";
export type MasteryLevel = 0 | 1 | 2 | 3 | 4;
export type UserRole = "student" | "admin";
export type ThemePreference = "light" | "dark" | "system";

export interface Domain {
  id: DomainId;
  code: string;
  name: string;
  shortName: string;
  slug: string;
  /** Approximate share of the real exam, in percent. Used for exam blueprints. */
  weight: number;
  description: string;
}

export interface Topic {
  /** URL-safe slug; also the primary key. */
  id: string;
  name: string;
}

export interface QuestionChoice {
  id: string;
  text: string;
  isCorrect: boolean;
  /** Why this option is right/wrong. Optional for correct options. */
  explanation: string | null;
}

export interface Question {
  id: string;
  stem: string;
  choices: QuestionChoice[];
  domainId: DomainId;
  topics: string[];
  difficulty: Difficulty;
  questionType: QuestionType;
  /** Number of choices the learner must select. */
  correctCount: number;
  explanation: string;
  examClue: string;
  memoryTip: string;
  /** Scenario-style questions are weighted up in Hard Mode. */
  isScenario: boolean;
  status: QuestionStatus;
  createdAt: string;
  updatedAt: string;
}

/** Lightweight metadata used for quiz generation and analytics joins. */
export interface CatalogEntry {
  id: string;
  domainId: DomainId;
  topics: string[];
  difficulty: Difficulty;
  questionType: QuestionType;
  isScenario: boolean;
}

/** Question shape that is safe to send to the browser before it is answered. */
export interface QuizQuestion {
  id: string;
  stem: string;
  choices: { id: string; text: string }[];
  domainId: DomainId;
  topics: string[];
  difficulty: Difficulty;
  questionType: QuestionType;
  selectCount: number;
  isScenario: boolean;
}

export interface QuestionSummary {
  id: string;
  stem: string;
  domainId: DomainId;
  topics: string[];
  difficulty: Difficulty;
  questionType: QuestionType;
  status: QuestionStatus;
  updatedAt: string;
}

/** Per-user, per-question learning state (mastery + review schedule). */
export interface ReviewState {
  questionId: string;
  mastery: MasteryLevel;
  timesSeen: number;
  timesCorrect: number;
  timesIncorrect: number;
  correctStreak: number;
  intervalDays: number;
  dueAt: string;
  lastAnsweredAt: string;
  lastResult: boolean;
  lastConfidence: Confidence | null;
  lastMissedAt: string | null;
  lastAttemptId: string | null;
}

export interface AttemptRecord {
  id: string;
  userId: string;
  questionId: string;
  quizSessionId: string | null;
  examSessionId: string | null;
  selectedChoiceIds: string[];
  isCorrect: boolean;
  confidence: Confidence | null;
  timeSpentMs: number;
  answeredAt: string;
  /** Snapshot of the review state before this attempt; lets confidence be applied after grading. */
  stateBefore: ReviewState | null;
}

/** What the service hands to a repository to persist one graded answer atomically. */
export interface AttemptWrite {
  questionId: string;
  quizSessionId: string | null;
  examSessionId: string | null;
  selectedChoiceIds: string[];
  isCorrect: boolean;
  confidence: Confidence | null;
  timeSpentMs: number;
  answeredAt: string;
  /** Local calendar date (YYYY-MM-DD) in the learner's timezone, for streaks. */
  activityDate: string;
  stateBefore: ReviewState | null;
  stateAfter: Omit<ReviewState, "lastAttemptId">;
}

export interface TopicStat {
  topicId: string;
  attempts: number;
  correct: number;
  /** Exponentially weighted accuracy, 0..1. Recent answers count more. */
  recentAccuracy: number;
  lastAttemptAt: string;
}

export interface DailyActivity {
  date: string;
  answered: number;
  correct: number;
  timeSpentMs: number;
}

export type StudyMode =
  | "quick"
  | "domain"
  | "topic"
  | "weak"
  | "missed"
  | "bookmarked"
  | "review"
  | "daily"
  | "retry"
  | "custom";

export type QuestionPool = "all" | "unanswered" | "missed" | "bookmarked" | "weak" | "due";
export type MissedOrder = "random" | "oldest" | "most";

export interface QuizConfig {
  count: number;
  domainIds?: DomainId[];
  topicIds?: string[];
  difficulties?: Difficulty[];
  pool?: QuestionPool;
  hardMode?: boolean;
  missedOrder?: MissedOrder;
  /** Explicit question list (retry missed, search results, single question). */
  questionIds?: string[];
}

export type SessionStatus = "active" | "completed" | "abandoned";

export interface QuizSession {
  id: string;
  userId: string;
  mode: StudyMode;
  title: string;
  config: QuizConfig;
  questionIds: string[];
  status: SessionStatus;
  startedAt: string;
  completedAt: string | null;
  answeredCount: number;
  correctCount: number;
  timeSpentMs: number;
}

export interface ExamResponse {
  selectedChoiceIds: string[];
  flagged: boolean;
}

export type ExamStatus = "in_progress" | "submitted";

export interface DomainScore {
  domainId: DomainId;
  total: number;
  correct: number;
  percent: number;
}

export interface TopicScore {
  topicId: string;
  total: number;
  correct: number;
  percent: number;
}

export interface ExamQuestionResult {
  questionId: string;
  answered: boolean;
  isCorrect: boolean;
  flagged: boolean;
}

export interface ExamResult {
  total: number;
  correct: number;
  incorrect: number;
  unanswered: number;
  percent: number;
  scaledScore: number;
  passingScore: number;
  passed: boolean;
  timeUsedSeconds: number;
  avgSecondsPerQuestion: number;
  domainBreakdown: DomainScore[];
  weakestTopics: TopicScore[];
  questions: ExamQuestionResult[];
}

export interface ExamSession {
  id: string;
  userId: string;
  presetId: string;
  title: string;
  questionIds: string[];
  timeLimitSeconds: number;
  startedAt: string;
  expiresAt: string;
  submittedAt: string | null;
  status: ExamStatus;
  responses: Record<string, ExamResponse>;
  result: ExamResult | null;
}

export interface UserSettings {
  theme: ThemePreference;
  dailyGoal: number;
  defaultQuizSize: number;
  defaultDifficulty: Difficulty | "any";
  showExplanationsImmediately: boolean;
  confidenceEnabled: boolean;
  timerEnabled: boolean;
  timezone: string;
}

export interface AppUser {
  id: string;
  email: string;
  displayName: string;
  role: UserRole;
}

export interface Bookmark {
  questionId: string;
  createdAt: string;
}

export interface QuestionNote {
  questionId: string;
  body: string;
  updatedAt: string;
}

export type ReportReason = "incorrect_answer" | "unclear" | "typo" | "outdated" | "other";
export type ReportStatus = "open" | "resolved" | "dismissed";

export interface QuestionReport {
  id: string;
  userId: string;
  questionId: string;
  reason: ReportReason;
  details: string;
  status: ReportStatus;
  createdAt: string;
}

export interface Paged<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

/** Normalized, validated input used to create/update/import a question. */
export interface QuestionInput {
  id?: string;
  stem: string;
  choices: { id?: string; text: string; isCorrect: boolean; explanation: string | null }[];
  domainId: DomainId;
  topics: Topic[];
  difficulty: Difficulty;
  explanation: string;
  examClue: string;
  memoryTip: string;
  isScenario: boolean;
  status: QuestionStatus;
}

export interface BankStats {
  total: number;
  byDomain: Record<DomainId, number>;
  byTopic: Record<string, number>;
  byDifficulty: Record<Difficulty, number>;
}
