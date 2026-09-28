import type { AttemptRecord, Confidence, MasteryLevel, Question } from "@/lib/types";
import { correctChoiceIds } from "@/lib/questions/transform";

/** Everything revealed to the learner after a question is graded. */
export interface AnswerFeedback {
  questionId: string;
  attemptId: string;
  isCorrect: boolean;
  selectedChoiceIds: string[];
  correctChoiceIds: string[];
  explanation: string;
  choiceExplanations: Record<string, string | null>;
  examClue: string;
  memoryTip: string;
  masteryBefore: MasteryLevel;
  masteryAfter: MasteryLevel;
  nextReviewAt: string | null;
  confidence: Confidence | null;
}

export function buildFeedback(
  question: Question,
  attempt: AttemptRecord,
  masteryAfter: MasteryLevel,
  nextReviewAt: string | null,
): AnswerFeedback {
  return {
    questionId: question.id,
    attemptId: attempt.id,
    isCorrect: attempt.isCorrect,
    selectedChoiceIds: attempt.selectedChoiceIds,
    correctChoiceIds: correctChoiceIds(question),
    explanation: question.explanation,
    choiceExplanations: Object.fromEntries(question.choices.map((c) => [c.id, c.explanation])),
    examClue: question.examClue,
    memoryTip: question.memoryTip,
    masteryBefore: attempt.stateBefore?.mastery ?? 0,
    masteryAfter,
    nextReviewAt,
    confidence: attempt.confidence,
  };
}
