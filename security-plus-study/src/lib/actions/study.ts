"use server";

import { redirect } from "next/navigation";
import { z } from "zod";

import { assertUser } from "@/lib/auth/session";
import { MAX_SESSION_QUESTIONS } from "@/lib/config/study";
import { getRepository } from "@/lib/data";
import type { AnswerFeedback } from "@/lib/services/feedback";
import { rateConfidence, startQuizSession, submitAnswer } from "@/lib/services/study-service";
import type { MasteryLevel } from "@/lib/types";
import { runAction, toMessage, uuid, type ActionResult } from "./result";

const difficulty = z.enum(["easy", "medium", "hard"]);
const confidence = z.enum(["guessed", "unsure", "confident"]);

const startSchema = z.object({
  mode: z.enum(["quick", "domain", "topic", "weak", "missed", "bookmarked", "review", "daily", "retry", "custom"]),
  count: z.coerce.number().int().min(1).max(MAX_SESSION_QUESTIONS),
  domainIds: z.array(z.coerce.number().int().min(1).max(5)).optional(),
  topicIds: z.array(z.string().regex(/^[a-z0-9-]{1,60}$/)).max(80).optional(),
  difficulties: z.array(difficulty).optional(),
  pool: z.enum(["all", "unanswered", "missed", "bookmarked", "weak", "due"]).optional(),
  hardMode: z.boolean().optional(),
  missedOrder: z.enum(["random", "oldest", "most"]).optional(),
  questionIds: z.array(uuid).max(MAX_SESSION_QUESTIONS).optional(),
  title: z.string().max(120).optional(),
});

function formToStartInput(formData: FormData) {
  const all = (key: string) => formData.getAll(key).map(String).filter(Boolean);
  const one = (key: string) => {
    const v = formData.get(key);
    return typeof v === "string" && v !== "" ? v : undefined;
  };
  return {
    mode: one("mode") ?? "quick",
    count: one("count") ?? "10",
    domainIds: all("domainIds").length ? all("domainIds") : undefined,
    topicIds: all("topicIds").length ? all("topicIds") : undefined,
    difficulties: all("difficulties").filter((d) => d !== "any").length ? all("difficulties").filter((d) => d !== "any") : undefined,
    pool: one("pool"),
    hardMode: one("hardMode") === "on" || one("hardMode") === "true" || undefined,
    missedOrder: one("missedOrder"),
    questionIds: all("questionIds").length ? all("questionIds") : undefined,
    title: one("title"),
  };
}

export interface StartQuizState {
  error?: string;
}

/** Form action: builds a session and navigates to it. */
export async function startQuizAction(_prev: StartQuizState, formData: FormData): Promise<StartQuizState> {
  let sessionId: string;
  try {
    const user = await assertUser();
    const input = startSchema.parse(formToStartInput(formData));
    const session = await startQuizSession(user, await getRepository(), {
      ...input,
      domainIds: input.domainIds as (1 | 2 | 3 | 4 | 5)[] | undefined,
    });
    sessionId = session.id;
  } catch (error) {
    return { error: toMessage(error) };
  }
  redirect(`/quiz/${sessionId}`);
}

export async function submitAnswerAction(input: {
  sessionId: string;
  questionId: string;
  selectedChoiceIds: string[];
  timeSpentMs: number;
  confidence?: string | null;
}): Promise<ActionResult<AnswerFeedback>> {
  return runAction(async () => {
    const user = await assertUser();
    const req = z
      .object({
        sessionId: uuid,
        questionId: uuid,
        selectedChoiceIds: z.array(uuid).min(1).max(8),
        timeSpentMs: z.number().min(0).max(86_400_000),
        confidence: confidence.nullish(),
      })
      .parse(input);
    return submitAnswer(user, await getRepository(), req);
  });
}

export async function rateConfidenceAction(input: {
  attemptId: string;
  confidence: string;
}): Promise<ActionResult<{ masteryAfter: MasteryLevel; nextReviewAt: string }>> {
  return runAction(async () => {
    const user = await assertUser();
    const req = z.object({ attemptId: uuid, confidence }).parse(input);
    return rateConfidence(user, await getRepository(), req.attemptId, req.confidence);
  });
}

export async function endQuizAction(sessionId: string): Promise<ActionResult> {
  return runAction(async () => {
    const user = await assertUser();
    const repo = await getRepository();
    const session = await repo.getQuizSession(user.id, uuid.parse(sessionId));
    if (session?.status === "active") {
      await repo.completeQuizSession(user.id, session.id, session.answeredCount > 0 ? "completed" : "abandoned");
    }
  });
}
