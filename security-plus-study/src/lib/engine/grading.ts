export interface GradeResult {
  isCorrect: boolean;
  correctlySelected: string[];
  incorrectlySelected: string[];
  missed: string[];
}

/**
 * All-or-nothing grading, matching how certification exams score
 * multiple-response items: the selected set must equal the correct set.
 */
export function gradeAnswer(correctChoiceIds: readonly string[], selectedChoiceIds: readonly string[]): GradeResult {
  const correct = new Set(correctChoiceIds);
  const selected = new Set(selectedChoiceIds);
  const correctlySelected = [...selected].filter((id) => correct.has(id));
  const incorrectlySelected = [...selected].filter((id) => !correct.has(id));
  const missed = [...correct].filter((id) => !selected.has(id));
  return {
    isCorrect: correct.size > 0 && incorrectlySelected.length === 0 && missed.length === 0,
    correctlySelected,
    incorrectlySelected,
    missed,
  };
}

export type SelectionProblem = "empty" | "unknown_choice" | "wrong_count" | "duplicate";

/** Validate a submission against the question's choices before grading. */
export function validateSelection(
  choiceIds: readonly string[],
  requiredCount: number,
  selectedChoiceIds: readonly string[],
  { requireExactCount = true }: { requireExactCount?: boolean } = {},
): SelectionProblem | null {
  if (selectedChoiceIds.length === 0) return "empty";
  if (new Set(selectedChoiceIds).size !== selectedChoiceIds.length) return "duplicate";
  const valid = new Set(choiceIds);
  if (selectedChoiceIds.some((id) => !valid.has(id))) return "unknown_choice";
  if (requireExactCount ? selectedChoiceIds.length !== requiredCount : selectedChoiceIds.length > requiredCount) {
    return "wrong_count";
  }
  return null;
}
