"use server";

import { z } from "zod";

import { assertUser } from "@/lib/auth/session";
import { getRepository } from "@/lib/data";
import { UserFacingError } from "@/lib/services/errors";
import { buildFeedback, type AnswerFeedback } from "@/lib/services/feedback";
import { runAction, uuid, type ActionResult } from "./result";

export async function setBookmarkAction(questionId: string, bookmarked: boolean): Promise<ActionResult<{ bookmarked: boolean }>> {
  return runAction(async () => {
    const user = await assertUser();
    await (await getRepository()).setBookmark(user.id, uuid.parse(questionId), z.boolean().parse(bookmarked));
    return { bookmarked };
  });
}

export async function saveNoteAction(questionId: string, body: string): Promise<ActionResult<{ body: string | null }>> {
  return runAction(async () => {
    const user = await assertUser();
    const text = z.string().max(4000, "Notes are limited to 4,000 characters.").parse(body).trim();
    const note = await (await getRepository()).saveNote(user.id, uuid.parse(questionId), text);
    return { body: note?.body ?? null };
  });
}

export async function reportQuestionAction(input: { questionId: string; reason: string; details: string }): Promise<ActionResult> {
  return runAction(async () => {
    const user = await assertUser();
    const req = z
      .object({
        questionId: uuid,
        reason: z.enum(["incorrect_answer", "unclear", "typo", "outdated", "other"]),
        details: z.string().trim().max(2000, "Please keep details under 2,000 characters."),
      })
      .parse(input);
    await (await getRepository()).createReport(user.id, req);
  });
}

/** Reveal the answer on the question detail page (outside of a scored session). */
export async function revealAnswerAction(questionId: string): Promise<ActionResult<AnswerFeedback>> {
  return runAction(async () => {
    const user = await assertUser();
    const repo = await getRepository();
    const question = await repo.getQuestion(uuid.parse(questionId));
    if (!question || (question.status !== "published" && user.role !== "admin")) throw new UserFacingError("Question not found.");
    const [state] = await repo.getReviewStates(user.id, [question.id]);
    const correct = question.choices.filter((c) => c.isCorrect).map((c) => c.id);
    return buildFeedback(
      question,
      {
        id: "",
        userId: user.id,
        questionId: question.id,
        quizSessionId: null,
        examSessionId: null,
        selectedChoiceIds: correct,
        isCorrect: true,
        confidence: null,
        timeSpentMs: 0,
        answeredAt: new Date().toISOString(),
        stateBefore: state ?? null,
      },
      state?.mastery ?? 0,
      state?.dueAt ?? null,
    );
  });
}
