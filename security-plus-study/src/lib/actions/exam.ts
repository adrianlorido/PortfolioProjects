"use server";

import { redirect } from "next/navigation";
import { z } from "zod";

import { assertUser } from "@/lib/auth/session";
import { EXAM_CONFIG } from "@/lib/config/exam";
import { getRepository } from "@/lib/data";
import { saveExamResponse, startExam, submitExam } from "@/lib/services/exam-service";
import { runAction, toMessage, uuid, type ActionResult } from "./result";

export interface StartExamState {
  error?: string;
}

export async function startExamAction(_prev: StartExamState, formData: FormData): Promise<StartExamState> {
  let examId: string;
  try {
    const user = await assertUser();
    const presetId = z
      .string()
      .refine((id) => EXAM_CONFIG.presets.some((p) => p.id === id), "Unknown exam type.")
      .parse(formData.get("presetId") ?? EXAM_CONFIG.defaultPresetId);
    examId = (await startExam(user, await getRepository(), presetId)).id;
  } catch (error) {
    return { error: toMessage(error) };
  }
  redirect(`/exam/${examId}`);
}

export async function saveExamResponseAction(input: {
  examId: string;
  questionId: string;
  selectedChoiceIds: string[];
  flagged: boolean;
}): Promise<ActionResult> {
  return runAction(async () => {
    const user = await assertUser();
    const req = z
      .object({ examId: uuid, questionId: uuid, selectedChoiceIds: z.array(uuid).max(8), flagged: z.boolean() })
      .parse(input);
    await saveExamResponse(user, await getRepository(), req.examId, req.questionId, {
      selectedChoiceIds: req.selectedChoiceIds,
      flagged: req.flagged,
    });
  });
}

export async function submitExamAction(examId: string): Promise<ActionResult<{ href: string }>> {
  return runAction(async () => {
    const user = await assertUser();
    const exam = await submitExam(user, await getRepository(), uuid.parse(examId));
    return { href: `/exam/${exam.id}/results` };
  });
}
