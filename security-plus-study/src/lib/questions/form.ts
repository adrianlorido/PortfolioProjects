import type { ImportIssue } from "./import-schema";
import { validateQuestion } from "./import-schema";
import type { QuestionInput, QuestionStatus } from "@/lib/types";

/** Shape submitted by the admin question editor. */
export interface QuestionFormInput {
  id?: string;
  stem: string;
  choices: { id?: string; text: string; isCorrect: boolean; explanation: string }[];
  domainId: number;
  topics: string[];
  difficulty: string;
  explanation: string;
  examClue: string;
  memoryTip: string;
  isScenario: boolean;
  status: QuestionStatus;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Validate editor input with the same rules as JSON imports, keeping existing choice ids. */
export function validateQuestionForm(form: QuestionFormInput): { input: QuestionInput | null; issues: ImportIssue[] } {
  const { input, issues } = validateQuestion(
    {
      id: form.id || undefined,
      question: form.stem,
      choices: form.choices.map((c) => ({ text: c.text, explanation: c.explanation || null, correct: c.isCorrect })),
      domain: form.domainId,
      topics: form.topics,
      difficulty: form.difficulty,
      explanation: form.explanation,
      examClue: form.examClue,
      memoryTip: form.memoryTip,
      scenario: form.isScenario,
      status: form.status,
    },
    0,
  );
  if (!input) return { input, issues };
  return {
    input: {
      ...input,
      choices: input.choices.map((c, i) => ({ ...c, id: form.choices[i]?.id && UUID_RE.test(form.choices[i].id!) ? form.choices[i].id : undefined })),
    },
    issues,
  };
}
