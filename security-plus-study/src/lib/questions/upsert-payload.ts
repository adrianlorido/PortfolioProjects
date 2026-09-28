import type { QuestionInput } from "@/lib/types";

/** Shape expected by the `upsert_questions` Postgres function. */
export function toUpsertPayload(q: QuestionInput) {
  return {
    id: q.id ?? null,
    stem: q.stem,
    domain_id: q.domainId,
    difficulty: q.difficulty,
    explanation: q.explanation,
    exam_clue: q.examClue,
    memory_tip: q.memoryTip,
    is_scenario: q.isScenario,
    status: q.status,
    choices: q.choices.map((c) => ({ id: c.id ?? null, text: c.text, is_correct: c.isCorrect, explanation: c.explanation })),
    topics: q.topics.map((t) => ({ id: t.id, name: t.name })),
  };
}
