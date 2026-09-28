import "server-only";

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

import { loadSeedBank } from "@/lib/questions/seed-bank";
import type {
  AttemptRecord,
  DailyActivity,
  ExamSession,
  Question,
  QuestionNote,
  QuestionReport,
  QuizSession,
  ReviewState,
  Topic,
  TopicStat,
  UserRole,
  UserSettings,
} from "@/lib/types";
import { generateSecret } from "./demo-auth";
import { seedDemoAccount } from "./seed-history";

export interface DemoUserRecord {
  id: string;
  email: string;
  displayName: string;
  role: UserRole;
  passwordHash: string;
  createdAt: string;
}

export interface DemoData {
  version: number;
  seedSignature: string;
  authSecret: string;
  users: DemoUserRecord[];
  questions: Record<string, Question>;
  topics: Record<string, Topic>;
  settings: Record<string, UserSettings>;
  attempts: Record<string, AttemptRecord>;
  reviewStates: Record<string, Record<string, ReviewState>>;
  topicStats: Record<string, Record<string, TopicStat>>;
  activity: Record<string, Record<string, DailyActivity>>;
  bookmarks: Record<string, Record<string, string>>;
  notes: Record<string, Record<string, QuestionNote>>;
  quizSessions: Record<string, QuizSession>;
  examSessions: Record<string, ExamSession>;
  reports: Record<string, QuestionReport>;
}

const STORE_VERSION = 1;

export { DEMO_ACCOUNT } from "./operations";

function seedSignature(questions: Question[]): string {
  return createHash("sha1").update(JSON.stringify(questions)).digest("hex");
}

function emptyData(): DemoData {
  const { questions, topics } = loadSeedBank();
  return {
    version: STORE_VERSION,
    seedSignature: seedSignature(questions),
    authSecret: process.env.DEMO_AUTH_SECRET || generateSecret(),
    users: [],
    questions: Object.fromEntries(questions.map((q) => [q.id, q])),
    topics: Object.fromEntries(topics.map((t) => [t.id, t])),
    settings: {},
    attempts: {},
    reviewStates: {},
    topicStats: {},
    activity: {},
    bookmarks: {},
    notes: {},
    quizSessions: {},
    examSessions: {},
    reports: {},
  };
}

/**
 * File-backed JSON store for demo mode. Everything lives in memory and is
 * written through to disk (when writable) so data survives dev-server restarts.
 */
class DemoStore {
  private data: DemoData;
  private readonly file: string | null;
  private loadedMtime = 0;
  private persistWarningShown = false;

  constructor() {
    const dir = process.env.DEMO_DATA_DIR || path.join(process.cwd(), ".demo-data");
    this.file = path.join(dir, "store.json");
    this.data = this.loadOrCreate(dir);
  }

  private loadOrCreate(dir: string): DemoData {
    try {
      if (this.file && existsSync(this.file)) {
        const parsed = JSON.parse(readFileSync(this.file, "utf8")) as DemoData;
        this.loadedMtime = statSync(this.file).mtimeMs;
        if (parsed.version === STORE_VERSION) return this.refreshSeed(parsed);
      }
    } catch (error) {
      console.warn("[demo-store] Could not read demo data, starting fresh:", (error as Error).message);
    }
    const fresh = emptyData();
    seedDemoAccount(fresh);
    try {
      mkdirSync(dir, { recursive: true });
    } catch {
      // Read-only filesystem: fall back to memory.
    }
    this.data = fresh;
    this.persist();
    return fresh;
  }

  /** Pick up edits to the bundled question bank without wiping learner data. */
  private refreshSeed(data: DemoData): DemoData {
    const { questions, topics } = loadSeedBank();
    const signature = seedSignature(questions);
    if (data.seedSignature === signature) return data;
    for (const q of questions) data.questions[q.id] = q;
    for (const t of topics) data.topics[t.id] ??= t;
    data.seedSignature = signature;
    this.data = data;
    this.persist();
    return data;
  }

  private reloadIfChanged() {
    if (!this.file) return;
    try {
      const mtime = statSync(this.file).mtimeMs;
      if (mtime > this.loadedMtime) {
        this.data = JSON.parse(readFileSync(this.file, "utf8")) as DemoData;
        this.loadedMtime = mtime;
      }
    } catch {
      // File missing or unreadable: keep the in-memory copy.
    }
  }

  private persist() {
    if (!this.file) return;
    try {
      const tmp = `${this.file}.${process.pid}.tmp`;
      writeFileSync(tmp, JSON.stringify(this.data));
      renameSync(tmp, this.file);
      this.loadedMtime = statSync(this.file).mtimeMs;
    } catch (error) {
      if (!this.persistWarningShown) {
        console.warn("[demo-store] Demo data is in memory only (filesystem not writable):", (error as Error).message);
        this.persistWarningShown = true;
      }
    }
  }

  read<T>(fn: (data: DemoData) => T): T {
    this.reloadIfChanged();
    return fn(this.data);
  }

  mutate<T>(fn: (data: DemoData) => T): T {
    this.reloadIfChanged();
    const result = fn(this.data);
    this.persist();
    return result;
  }
}

const globalForStore = globalThis as unknown as { __bastionDemoStore?: DemoStore };

export function getDemoStore(): DemoStore {
  globalForStore.__bastionDemoStore ??= new DemoStore();
  return globalForStore.__bastionDemoStore;
}
