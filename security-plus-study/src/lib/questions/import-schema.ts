import { z } from "zod";

import { resolveDomain } from "@/lib/config/domains";
import { resolveTopic } from "@/lib/config/topics";
import type { Difficulty, QuestionInput } from "@/lib/types";

/**
 * Question import format (JSON). A file may be a bare array of questions or
 * `{ "indexBase": 0 | 1, "questions": [...] }`.
 *
 * `correctAnswers` holds 0-based choice indexes by default (or 1-based when the
 * wrapper sets `indexBase: 1`). Letters ("A", "B", ...) are also accepted.
 */
export const LIMITS = {
  stem: 2000,
  choice: 600,
  explanation: 5000,
  clue: 600,
  minChoices: 2,
  maxChoices: 8,
  maxTopics: 10,
  maxQuestionsPerImport: 2000,
} as const;

const choiceSchema = z.union([
  z.string(),
  z.object({
    text: z.string(),
    explanation: z.string().nullish(),
    correct: z.boolean().optional(),
  }),
]);

const answerRef = z.union([z.number().int(), z.string()]);

export const rawQuestionSchema = z.object({
  id: z.string().optional(),
  // Presence of required fields is checked after parsing so every problem is reported at once.
  question: z.string({ error: "Question text must be a string" }).optional(),
  choices: z.array(choiceSchema, { error: "Choices must be an array" }).optional(),
  correctAnswers: z.union([z.array(answerRef), answerRef]).optional(),
  correctAnswer: z.union([z.array(answerRef), answerRef]).optional(),
  domain: z.union([z.string(), z.number()], { error: "Domain must be a string or number" }).optional(),
  topics: z.array(z.string(), { error: "Topics must be an array of strings" }).default([]),
  difficulty: z.string().default("medium"),
  explanation: z.string({ error: "Explanation must be a string" }).optional(),
  incorrectAnswerExplanations: z
    .union([z.array(z.string().nullable()), z.record(z.string(), z.string())])
    .optional(),
  examClue: z.string().optional(),
  memoryTip: z.string().optional(),
  questionType: z.enum(["single", "multiple"]).optional(),
  numberOfCorrectAnswers: z.number().int().optional(),
  scenario: z.boolean().optional(),
  status: z.enum(["published", "draft"]).optional(),
});

export type RawQuestion = z.input<typeof rawQuestionSchema>;

export interface ImportIssue {
  /** 0-based position in the submitted array. */
  index: number;
  path: string;
  message: string;
  severity: "error" | "warning";
}

export interface ValidatedQuestion {
  index: number;
  input: QuestionInput;
  warnings: ImportIssue[];
}

export interface ImportValidationResult {
  total: number;
  valid: ValidatedQuestion[];
  issues: ImportIssue[];
  /** Fatal problems with the file as a whole (bad JSON, wrong top-level shape). */
  fileError: string | null;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LETTERS = "ABCDEFGH";
const DIFFICULTIES: Difficulty[] = ["easy", "medium", "hard"];

const SCENARIO_RE =
  /\b(a|an|the|your)\s+(company|organization|organisation|security|analyst|administrator|engineer|user|employee|technician|manager|team|hospital|bank|retailer|startup|developer|auditor|attacker|ciso|firm|university|agency|school|contractor|help desk|sysadmin|penetration tester)\b/i;

export function looksLikeScenario(stem: string): boolean {
  return stem.length >= 140 && SCENARIO_RE.test(stem);
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\r\n/g, "\n").trim();
}

function resolveAnswerIndex(ref: number | string, choiceCount: number, indexBase: 0 | 1): number | null {
  if (typeof ref === "number") {
    const idx = ref - indexBase;
    return idx >= 0 && idx < choiceCount ? idx : null;
  }
  const trimmed = ref.trim().toUpperCase();
  if (/^[A-H]$/.test(trimmed)) {
    const idx = LETTERS.indexOf(trimmed);
    return idx < choiceCount ? idx : null;
  }
  if (/^\d+$/.test(trimmed)) return resolveAnswerIndex(Number(trimmed), choiceCount, indexBase);
  return null;
}

function explanationKeyToIndex(key: string, choiceCount: number, indexBase: 0 | 1): number | null {
  return resolveAnswerIndex(/^\d+$/.test(key) ? Number(key) : key, choiceCount, indexBase);
}

/** Validate and normalize one raw question. Returns issues with severity. */
export function validateQuestion(
  raw: unknown,
  index: number,
  indexBase: 0 | 1 = 0,
): { input: QuestionInput | null; issues: ImportIssue[] } {
  const issues: ImportIssue[] = [];
  const err = (path: string, message: string) => issues.push({ index, path, message, severity: "error" });
  const warn = (path: string, message: string) => issues.push({ index, path, message, severity: "warning" });

  const parsed = rawQuestionSchema.safeParse(raw);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      err(issue.path.map(String).join(".") || "(root)", issue.message);
    }
    return { input: null, issues };
  }
  const q = parsed.data;

  if (q.question === undefined) err("question", "Question text is required");
  if (q.domain === undefined) err("domain", "Domain is required");
  if (q.explanation === undefined) err("explanation", "Explanation is required");
  if (q.choices === undefined) err("choices", "Choices are required");

  const stem = normalizeWhitespace(q.question ?? "");
  if (q.question !== undefined && !stem) err("question", "Question text is empty");
  else if (stem.length > LIMITS.stem) err("question", `Question text exceeds ${LIMITS.stem} characters`);

  if (q.id !== undefined && !UUID_RE.test(q.id)) err("id", "id must be a UUID when provided");

  // Choices
  const choices = (q.choices ?? []).map((c) =>
    typeof c === "string"
      ? { text: normalizeWhitespace(c), explanation: null as string | null, correct: undefined as boolean | undefined }
      : { text: normalizeWhitespace(c.text), explanation: c.explanation ? normalizeWhitespace(c.explanation) : null, correct: c.correct },
  );
  if (q.choices !== undefined && choices.length < LIMITS.minChoices) err("choices", `At least ${LIMITS.minChoices} choices are required`);
  if (choices.length > LIMITS.maxChoices) err("choices", `No more than ${LIMITS.maxChoices} choices are allowed`);
  const seenChoices = new Set<string>();
  choices.forEach((c, i) => {
    if (!c.text) err(`choices.${i}`, `Choice ${LETTERS[i] ?? i + 1} is empty`);
    if (c.text.length > LIMITS.choice) err(`choices.${i}`, `Choice ${LETTERS[i] ?? i + 1} exceeds ${LIMITS.choice} characters`);
    const key = c.text.toLowerCase();
    if (c.text && seenChoices.has(key)) err(`choices.${i}`, `Choice ${LETTERS[i] ?? i + 1} duplicates another choice`);
    seenChoices.add(key);
  });

  // Correct answers: explicit list, or `correct: true` flags on object choices.
  const answerField = q.correctAnswers ?? q.correctAnswer;
  let correctIdx: number[] = [];
  if (answerField !== undefined) {
    const refs = Array.isArray(answerField) ? answerField : [answerField];
    for (const ref of refs) {
      const idx = resolveAnswerIndex(ref, choices.length, indexBase);
      if (idx === null) err("correctAnswers", `Answer reference "${ref}" does not match any choice (indexBase ${indexBase})`);
      else if (correctIdx.includes(idx)) err("correctAnswers", `Answer "${ref}" is listed more than once`);
      else correctIdx.push(idx);
    }
  } else {
    correctIdx = choices.flatMap((c, i) => (c.correct ? [i] : []));
  }
  if (correctIdx.length === 0 && choices.length > 0) err("correctAnswers", "At least one correct answer is required");
  if (choices.length > 0 && correctIdx.length >= choices.length) err("correctAnswers", "At least one choice must be incorrect");

  const questionType = correctIdx.length > 1 ? "multiple" : "single";
  if (q.questionType && q.questionType !== questionType) {
    err("questionType", `questionType is "${q.questionType}" but ${correctIdx.length} correct answer(s) were given`);
  }
  if (q.numberOfCorrectAnswers !== undefined && q.numberOfCorrectAnswers !== correctIdx.length) {
    err("numberOfCorrectAnswers", `numberOfCorrectAnswers is ${q.numberOfCorrectAnswers} but ${correctIdx.length} correct answer(s) were given`);
  }

  // Domain, topics, difficulty
  const domainId = q.domain === undefined ? null : resolveDomain(q.domain);
  if (q.domain !== undefined && !domainId) err("domain", `Unknown domain "${q.domain}". Use 1-5, a code like "4.0", or the domain name`);

  const topicLabels = q.topics.map((t) => t.trim()).filter(Boolean);
  if (topicLabels.length === 0) err("topics", "At least one topic is required");
  if (topicLabels.length > LIMITS.maxTopics) err("topics", `No more than ${LIMITS.maxTopics} topics are allowed`);
  const topics = [...new Map(topicLabels.map((label) => resolveTopic(label)).filter((t) => t.id).map((t) => [t.id, t])).values()];

  const difficulty = q.difficulty.trim().toLowerCase() as Difficulty;
  if (!DIFFICULTIES.includes(difficulty)) err("difficulty", `Difficulty must be one of ${DIFFICULTIES.join(", ")}`);

  // Explanations
  const explanation = normalizeWhitespace(q.explanation ?? "");
  if (q.explanation !== undefined && !explanation) err("explanation", "Explanation is required");
  else if (explanation.length > LIMITS.explanation) err("explanation", `Explanation exceeds ${LIMITS.explanation} characters`);
  else if (explanation.length < 25) warn("explanation", "Explanation is very short");

  const perChoice = choices.map((c) => c.explanation);
  if (q.incorrectAnswerExplanations) {
    const entries = Array.isArray(q.incorrectAnswerExplanations)
      ? q.incorrectAnswerExplanations.map((text, i) => [i, text] as const)
      : Object.entries(q.incorrectAnswerExplanations).map(
          ([key, text]) => [explanationKeyToIndex(key, choices.length, indexBase), text] as const,
        );
    for (const [idx, text] of entries) {
      if (idx === null || idx >= choices.length) {
        err("incorrectAnswerExplanations", "An explanation refers to a choice that does not exist");
        continue;
      }
      if (text && text.trim()) perChoice[idx] = normalizeWhitespace(text);
    }
  }
  const missingWrongExplanations = choices.filter((_, i) => !correctIdx.includes(i) && !perChoice[i]).length;
  if (missingWrongExplanations > 0) {
    warn("incorrectAnswerExplanations", `${missingWrongExplanations} incorrect choice(s) have no explanation`);
  }

  const examClue = normalizeWhitespace(q.examClue ?? "");
  const memoryTip = normalizeWhitespace(q.memoryTip ?? "");
  if (!examClue) warn("examClue", "No exam clue provided");
  if (!memoryTip) warn("memoryTip", "No memory tip provided");
  if (examClue.length > LIMITS.clue) err("examClue", `Exam clue exceeds ${LIMITS.clue} characters`);
  if (memoryTip.length > LIMITS.clue) err("memoryTip", `Memory tip exceeds ${LIMITS.clue} characters`);

  if (issues.some((i) => i.severity === "error") || !domainId) return { input: null, issues };

  return {
    input: {
      id: q.id?.toLowerCase(),
      stem,
      choices: choices.map((c, i) => ({ text: c.text, isCorrect: correctIdx.includes(i), explanation: perChoice[i] })),
      domainId,
      topics,
      difficulty,
      explanation,
      examClue,
      memoryTip,
      isScenario: q.scenario ?? looksLikeScenario(stem),
      status: q.status ?? "published",
    },
    issues,
  };
}

function stemKey(stem: string): string {
  return stem.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/**
 * Validate a whole import payload (already-parsed JSON or a JSON string).
 * `existingStems` lets callers flag questions that already exist in the bank.
 */
export function validateImport(payload: unknown, existingStems: Iterable<string> = []): ImportValidationResult {
  let data = payload;
  if (typeof payload === "string") {
    try {
      data = JSON.parse(payload);
    } catch (e) {
      return { total: 0, valid: [], issues: [], fileError: `Invalid JSON: ${(e as Error).message}` };
    }
  }

  let indexBase: 0 | 1 = 0;
  let items: unknown[];
  if (Array.isArray(data)) {
    items = data;
  } else if (data && typeof data === "object" && Array.isArray((data as { questions?: unknown }).questions)) {
    const wrapper = data as { questions: unknown[]; indexBase?: unknown };
    if (wrapper.indexBase !== undefined && wrapper.indexBase !== 0 && wrapper.indexBase !== 1) {
      return { total: 0, valid: [], issues: [], fileError: "indexBase must be 0 or 1" };
    }
    indexBase = (wrapper.indexBase as 0 | 1 | undefined) ?? 0;
    items = wrapper.questions;
  } else if (data && typeof data === "object") {
    items = [data];
  } else {
    return { total: 0, valid: [], issues: [], fileError: "Expected an array of questions or { \"questions\": [...] }" };
  }

  if (items.length === 0) return { total: 0, valid: [], issues: [], fileError: "No questions found in the file" };
  if (items.length > LIMITS.maxQuestionsPerImport) {
    return { total: items.length, valid: [], issues: [], fileError: `Imports are limited to ${LIMITS.maxQuestionsPerImport} questions per file` };
  }

  const existing = new Set([...existingStems].map(stemKey));
  const seenInFile = new Map<string, number>();
  const seenIds = new Set<string>();
  const valid: ValidatedQuestion[] = [];
  const issues: ImportIssue[] = [];

  items.forEach((raw, index) => {
    const result = validateQuestion(raw, index, indexBase);
    const localIssues = [...result.issues];
    if (result.input) {
      const key = stemKey(result.input.stem);
      const firstIndex = seenInFile.get(key);
      if (firstIndex !== undefined) {
        localIssues.push({ index, path: "question", message: `Duplicate of question #${firstIndex + 1} in this file`, severity: "error" });
      } else {
        seenInFile.set(key, index);
      }
      if (result.input.id) {
        if (seenIds.has(result.input.id)) {
          localIssues.push({ index, path: "id", message: "Duplicate id in this file", severity: "error" });
        }
        seenIds.add(result.input.id);
      } else if (existing.has(key)) {
        localIssues.push({ index, path: "question", message: "A question with the same text already exists in the bank", severity: "warning" });
      }
    }
    issues.push(...localIssues);
    if (result.input && !localIssues.some((i) => i.severity === "error")) {
      valid.push({ index, input: result.input, warnings: localIssues.filter((i) => i.severity === "warning") });
    }
  });

  return { total: items.length, valid, issues, fileError: null };
}
