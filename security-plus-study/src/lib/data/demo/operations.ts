import { randomUUID } from "node:crypto";

import { DEFAULT_SETTINGS } from "@/lib/config/defaults";
import { TOPIC_RECENCY_ALPHA } from "@/lib/config/study";
import { updateRecentAccuracy } from "@/lib/analytics/weak-topics";
import type { AttemptRecord, AttemptWrite, ExamSession, QuizSession, UserRole } from "@/lib/types";
import { hashPassword } from "./demo-auth";
import type { DemoData, DemoUserRecord } from "./store";

/** Pure state transitions on the demo store; mirrors the SQL functions in the Supabase migration. */

export const DEMO_ACCOUNT = {
  email: "demo@bastion.dev",
  password: "bastion-demo",
  displayName: "Alex Rivera",
} as const;

export function createDemoUser(
  data: DemoData,
  input: { email: string; password: string; displayName: string; role?: UserRole },
): DemoUserRecord {
  const user: DemoUserRecord = {
    id: randomUUID(),
    email: input.email.trim().toLowerCase(),
    displayName: input.displayName.trim(),
    role: input.role ?? "student",
    passwordHash: hashPassword(input.password),
    createdAt: new Date().toISOString(),
  };
  data.users.push(user);
  data.settings[user.id] = { ...DEFAULT_SETTINGS };
  return user;
}

export function applyAttemptWrite(data: DemoData, userId: string, write: AttemptWrite, alpha = TOPIC_RECENCY_ALPHA): AttemptRecord {
  const attempt: AttemptRecord = {
    id: randomUUID(),
    userId,
    questionId: write.questionId,
    quizSessionId: write.quizSessionId,
    examSessionId: write.examSessionId,
    selectedChoiceIds: write.selectedChoiceIds,
    isCorrect: write.isCorrect,
    confidence: write.confidence,
    timeSpentMs: Math.max(0, Math.min(write.timeSpentMs, 3_600_000)),
    answeredAt: write.answeredAt,
    stateBefore: write.stateBefore,
  };
  data.attempts[attempt.id] = attempt;

  const states = (data.reviewStates[userId] ??= {});
  states[write.questionId] = { ...write.stateAfter, lastAttemptId: attempt.id };

  const topicStats = (data.topicStats[userId] ??= {});
  for (const topicId of data.questions[write.questionId]?.topics ?? []) {
    const prev = topicStats[topicId];
    topicStats[topicId] = {
      topicId,
      attempts: (prev?.attempts ?? 0) + 1,
      correct: (prev?.correct ?? 0) + (write.isCorrect ? 1 : 0),
      recentAccuracy: updateRecentAccuracy(prev ? prev.recentAccuracy : null, write.isCorrect, alpha),
      lastAttemptAt: prev && prev.lastAttemptAt > write.answeredAt ? prev.lastAttemptAt : write.answeredAt,
    };
  }

  const activity = (data.activity[userId] ??= {});
  const day = activity[write.activityDate] ?? { date: write.activityDate, answered: 0, correct: 0, timeSpentMs: 0 };
  activity[write.activityDate] = {
    ...day,
    answered: day.answered + 1,
    correct: day.correct + (write.isCorrect ? 1 : 0),
    timeSpentMs: day.timeSpentMs + attempt.timeSpentMs,
  };

  if (write.quizSessionId) {
    const session = data.quizSessions[write.quizSessionId];
    if (session && session.userId === userId) {
      session.answeredCount += 1;
      session.correctCount += write.isCorrect ? 1 : 0;
      session.timeSpentMs += attempt.timeSpentMs;
    }
  }
  return attempt;
}

export function insertQuizSession(data: DemoData, session: Omit<QuizSession, "id">): QuizSession {
  const record: QuizSession = { ...session, id: randomUUID() };
  data.quizSessions[record.id] = record;
  return record;
}

export function insertExamSession(data: DemoData, exam: Omit<ExamSession, "id">): ExamSession {
  const record: ExamSession = { ...exam, id: randomUUID() };
  data.examSessions[record.id] = record;
  return record;
}
