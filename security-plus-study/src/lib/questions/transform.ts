import type { CatalogEntry, Question, QuestionSummary, QuizQuestion } from "@/lib/types";

/** Strip answers and explanations so a question can be sent to the browser. */
export function toQuizQuestion(q: Question): QuizQuestion {
  return {
    id: q.id,
    stem: q.stem,
    choices: q.choices.map((c) => ({ id: c.id, text: c.text })),
    domainId: q.domainId,
    topics: q.topics,
    difficulty: q.difficulty,
    questionType: q.questionType,
    selectCount: q.correctCount,
    isScenario: q.isScenario,
  };
}

export function toCatalogEntry(q: Question): CatalogEntry {
  return {
    id: q.id,
    domainId: q.domainId,
    topics: q.topics,
    difficulty: q.difficulty,
    questionType: q.questionType,
    isScenario: q.isScenario,
  };
}

export function toSummary(q: Question): QuestionSummary {
  return {
    id: q.id,
    stem: q.stem,
    domainId: q.domainId,
    topics: q.topics,
    difficulty: q.difficulty,
    questionType: q.questionType,
    status: q.status,
    updatedAt: q.updatedAt,
  };
}

export function correctChoiceIds(q: Question): string[] {
  return q.choices.filter((c) => c.isCorrect).map((c) => c.id);
}

export const CHOICE_LETTERS = "ABCDEFGH";

export function choiceLetter(index: number): string {
  return CHOICE_LETTERS[index] ?? String(index + 1);
}

const NUMBER_WORDS = ["zero", "ONE", "TWO", "THREE", "FOUR", "FIVE", "SIX", "SEVEN", "EIGHT"];

export function selectPrompt(count: number): string {
  return count > 1 ? `Select ${NUMBER_WORDS[count] ?? count}` : "Select ONE";
}
