import "server-only";

import { toLocalDate } from "@/lib/analytics/dates";
import { EXAM_CONFIG, getExamPreset } from "@/lib/config/exam";
import type { Repository } from "@/lib/data/repository";
import { buildExam } from "@/lib/engine/exam-builder";
import { gradeAnswer, validateSelection } from "@/lib/engine/grading";
import { createRng } from "@/lib/engine/random";
import { scoreExam } from "@/lib/engine/scoring";
import { scheduleReview } from "@/lib/engine/spaced-repetition";
import { correctChoiceIds, toQuizQuestion } from "@/lib/questions/transform";
import type { AppUser, AttemptWrite, ExamResponse, ExamSession, Question, QuizQuestion, ReviewState } from "@/lib/types";
import { UserFacingError } from "./errors";

export async function startExam(user: AppUser, repo: Repository, presetId: string): Promise<ExamSession> {
  const preset = getExamPreset(presetId);
  const catalog = await repo.getCatalog();
  const ids = buildExam(catalog, preset.questionCount, createRng(Math.floor(Math.random() * 2 ** 31)), {
    useDomainWeights: EXAM_CONFIG.useDomainWeights,
  });
  if (ids.length === 0) throw new UserFacingError("The question bank is empty. Add questions before taking an exam.");
  // Keep the configured pace (seconds per question) if the bank has fewer questions than the preset.
  const secondsPerQuestion = (preset.timeLimitMinutes * 60) / preset.questionCount;
  return repo.createExamSession(user.id, {
    presetId: preset.id,
    title: preset.name,
    questionIds: ids,
    timeLimitSeconds: Math.round(secondsPerQuestion * ids.length),
  });
}

function isPastDeadline(exam: ExamSession, now: Date, graceSeconds = EXAM_CONFIG.gracePeriodSeconds): boolean {
  return now.getTime() > new Date(exam.expiresAt).getTime() + graceSeconds * 1000;
}

export interface LoadedExam {
  exam: ExamSession;
  questions: QuizQuestion[];
  serverNow: string;
}

export async function loadExam(user: AppUser, repo: Repository, examId: string): Promise<LoadedExam | null> {
  let exam = await repo.getExamSession(user.id, examId);
  if (!exam) return null;
  if (exam.status === "in_progress" && isPastDeadline(exam, new Date())) {
    // The learner left and time ran out: grade what was saved.
    exam = await submitExam(user, repo, examId);
  }
  const questions = await repo.getQuestions(exam.questionIds);
  const byId = new Map(questions.map((q) => [q.id, q]));
  return {
    exam,
    questions: exam.questionIds.map((id) => byId.get(id)).filter((q): q is Question => !!q).map(toQuizQuestion),
    serverNow: new Date().toISOString(),
  };
}

export async function saveExamResponse(
  user: AppUser,
  repo: Repository,
  examId: string,
  questionId: string,
  response: ExamResponse,
): Promise<void> {
  const exam = await repo.getExamSession(user.id, examId);
  if (!exam) throw new UserFacingError("Exam not found.");
  if (exam.status !== "in_progress") throw new UserFacingError("This exam has already been submitted.");
  if (isPastDeadline(exam, new Date())) throw new UserFacingError("Time is up for this exam.");
  if (!exam.questionIds.includes(questionId)) throw new UserFacingError("That question is not part of this exam.");

  if (response.selectedChoiceIds.length > 0) {
    const question = await repo.getQuestion(questionId);
    if (!question) throw new UserFacingError("This question is no longer available.");
    const problem = validateSelection(
      question.choices.map((c) => c.id),
      question.correctCount,
      response.selectedChoiceIds,
      { requireExactCount: false },
    );
    if (problem) throw new UserFacingError("Invalid answer selection.");
  }
  await repo.saveExamResponse(user.id, examId, questionId, {
    selectedChoiceIds: [...new Set(response.selectedChoiceIds)],
    flagged: Boolean(response.flagged),
  });
}

export async function submitExam(user: AppUser, repo: Repository, examId: string): Promise<ExamSession> {
  const exam = await repo.getExamSession(user.id, examId);
  if (!exam) throw new UserFacingError("Exam not found.");
  if (exam.status !== "in_progress") return exam;

  const now = new Date();
  const [questions, states, settings] = await Promise.all([
    repo.getQuestions(exam.questionIds),
    repo.getReviewStates(user.id, exam.questionIds),
    repo.getSettings(user.id),
  ]);
  const byId = new Map(questions.map((q) => [q.id, q]));
  const ordered = exam.questionIds.map((id) => byId.get(id)).filter((q): q is Question => !!q);
  const stateById = new Map<string, ReviewState>(states.map((s) => [s.questionId, s]));

  const end = Math.min(now.getTime(), new Date(exam.expiresAt).getTime());
  const timeUsedSeconds = (end - new Date(exam.startedAt).getTime()) / 1000;
  const result = scoreExam(ordered, exam.responses, timeUsedSeconds);
  const perQuestionMs = ordered.length ? Math.round((timeUsedSeconds * 1000) / ordered.length) : 0;

  const writes: AttemptWrite[] = [];
  for (const q of ordered) {
    const selected = exam.responses[q.id]?.selectedChoiceIds ?? [];
    if (selected.length === 0) continue; // unanswered questions do not affect mastery
    const isCorrect = gradeAnswer(correctChoiceIds(q), selected).isCorrect;
    const previous = stateById.get(q.id) ?? null;
    writes.push({
      questionId: q.id,
      quizSessionId: null,
      examSessionId: exam.id,
      selectedChoiceIds: selected,
      isCorrect,
      confidence: null,
      timeSpentMs: perQuestionMs,
      answeredAt: now.toISOString(),
      activityDate: toLocalDate(now, settings.timezone),
      stateBefore: previous,
      stateAfter: scheduleReview(previous, q.id, { correct: isCorrect, confidence: null }, now),
    });
  }
  return repo.finalizeExam(user.id, exam.id, result, writes);
}

export interface ExamReport {
  exam: ExamSession;
  questions: Question[];
}

export async function getExamReport(user: AppUser, repo: Repository, examId: string): Promise<ExamReport | null> {
  const loaded = await repo.getExamSession(user.id, examId);
  if (!loaded) return null;
  const exam = loaded.status === "in_progress" && isPastDeadline(loaded, new Date()) ? await submitExam(user, repo, examId) : loaded;
  const questions = await repo.getQuestions(exam.questionIds);
  return { exam, questions };
}

export async function getExamOverview(user: AppUser, repo: Repository) {
  const [bank, exams] = await Promise.all([repo.getBankStats(), repo.listExamSessions(user.id, 10)]);
  const now = new Date();
  const inProgress = exams.find((e) => e.status === "in_progress" && !isPastDeadline(e, now)) ?? null;
  return { bankSize: bank.total, exams, inProgress };
}
