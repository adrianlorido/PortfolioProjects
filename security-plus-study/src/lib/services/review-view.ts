import "server-only";

import type { ReviewCardData } from "@/components/review/review-card";
import { toQuizQuestion } from "@/lib/questions/transform";
import type { AttemptRecord } from "@/lib/types";
import { buildFeedback } from "./feedback";
import type { ReviewItem } from "./review-service";

/** Convert review items into serializable card props (answers are already known to the learner). */
export function toReviewCards(items: ReviewItem[]): ReviewCardData[] {
  return items.map((item) => {
    const attempt: AttemptRecord = item.attempt ?? {
      id: "",
      userId: "",
      questionId: item.question.id,
      quizSessionId: null,
      examSessionId: null,
      selectedChoiceIds: [],
      isCorrect: false,
      confidence: null,
      timeSpentMs: 0,
      answeredAt: "",
      stateBefore: null,
    };
    return {
      question: toQuizQuestion(item.question),
      feedback: buildFeedback(item.question, attempt, item.state?.mastery ?? 0, item.state?.dueAt ?? null),
      unanswered: item.unanswered,
      bookmarked: item.bookmarked,
      note: item.note,
      mastery: item.state?.mastery ?? null,
      answeredAt: item.attempt?.answeredAt ?? null,
      confidence: item.attempt?.confidence ?? null,
      timesIncorrect: item.state?.timesIncorrect ?? 0,
    };
  });
}
