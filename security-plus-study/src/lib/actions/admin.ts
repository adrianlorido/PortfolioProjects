"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { assertAdmin } from "@/lib/auth/session";
import { getRepository } from "@/lib/data";
import { validateQuestionForm, type QuestionFormInput } from "@/lib/questions/form";
import { validateImport, type ImportIssue } from "@/lib/questions/import-schema";
import { UserFacingError } from "@/lib/services/errors";
import type { QuestionInput } from "@/lib/types";
import { runAction, uuid, type ActionResult } from "./result";

export type SaveQuestionResult = { ok: true; id: string } | { ok: false; error: string; issues?: ImportIssue[] };

export async function saveQuestionAction(form: QuestionFormInput): Promise<SaveQuestionResult> {
  const result = await runAction(async () => {
    const user = await assertAdmin();
    if (form.id) uuid.parse(form.id);
    const { input, issues } = validateQuestionForm(form);
    if (!input) return { issues: issues.filter((i) => i.severity === "error") };
    const [id] = await (await getRepository()).saveQuestions([input], user.id);
    revalidatePath("/admin");
    return { id };
  });
  if (!result.ok) return result;
  if ("issues" in result.data) return { ok: false, error: "Please fix the highlighted fields.", issues: result.data.issues };
  return { ok: true, id: result.data.id };
}

export async function deleteQuestionAction(id: string): Promise<ActionResult> {
  return runAction(async () => {
    await assertAdmin();
    await (await getRepository()).deleteQuestion(uuid.parse(id));
    revalidatePath("/admin");
  });
}

export async function duplicateQuestionAction(id: string): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const user = await assertAdmin();
    const repo = await getRepository();
    const q = await repo.getQuestion(uuid.parse(id));
    if (!q) throw new UserFacingError("Question not found.");
    const topics = await repo.listTopics();
    const names = new Map(topics.map((t) => [t.id, t.name]));
    const copy: QuestionInput = {
      stem: `${q.stem} (copy)`.slice(0, 2000),
      choices: q.choices.map((c) => ({ text: c.text, isCorrect: c.isCorrect, explanation: c.explanation })),
      domainId: q.domainId,
      topics: q.topics.map((t) => ({ id: t, name: names.get(t) ?? t })),
      difficulty: q.difficulty,
      explanation: q.explanation,
      examClue: q.examClue,
      memoryTip: q.memoryTip,
      isScenario: q.isScenario,
      status: "draft",
    };
    const [newId] = await repo.saveQuestions([copy], user.id);
    revalidatePath("/admin");
    return { id: newId };
  });
}

export interface ImportPreview {
  fileError: string | null;
  total: number;
  validCount: number;
  errorCount: number;
  warningCount: number;
  issues: ImportIssue[];
  preview: { index: number; stem: string; domainId: number; difficulty: string; topics: string[]; correctCount: number }[];
}

async function analyze(json: string): Promise<{ preview: ImportPreview; valid: QuestionInput[] }> {
  const first = validateImport(json);
  if (first.fileError) {
    return { preview: { fileError: first.fileError, total: 0, validCount: 0, errorCount: 0, warningCount: 0, issues: [], preview: [] }, valid: [] };
  }
  const existing = await (await getRepository()).findExistingStems(first.valid.map((v) => v.input.stem));
  const result = existing.length ? validateImport(json, existing) : first;
  const errors = result.issues.filter((i) => i.severity === "error");
  return {
    preview: {
      fileError: null,
      total: result.total,
      validCount: result.valid.length,
      errorCount: errors.length,
      warningCount: result.issues.length - errors.length,
      issues: result.issues.slice(0, 300),
      preview: result.valid.slice(0, 50).map((v) => ({
        index: v.index,
        stem: v.input.stem,
        domainId: v.input.domainId,
        difficulty: v.input.difficulty,
        topics: v.input.topics.map((t) => t.name),
        correctCount: v.input.choices.filter((c) => c.isCorrect).length,
      })),
    },
    valid: result.valid.map((v) => v.input),
  };
}

export async function validateImportAction(json: string): Promise<ActionResult<ImportPreview>> {
  return runAction(async () => {
    await assertAdmin();
    return (await analyze(z.string().max(5_000_000, "File is too large (5 MB max).").parse(json))).preview;
  });
}

export async function importQuestionsAction(json: string, options: { skipInvalid: boolean }): Promise<ActionResult<{ imported: number }>> {
  return runAction(async () => {
    const user = await assertAdmin();
    const { preview, valid } = await analyze(z.string().max(5_000_000).parse(json));
    if (preview.fileError) throw new UserFacingError(preview.fileError);
    if (preview.errorCount > 0 && !options.skipInvalid) {
      throw new UserFacingError("Some questions have errors. Fix them or choose to import only the valid questions.");
    }
    if (valid.length === 0) throw new UserFacingError("There are no valid questions to import.");
    const ids = await (await getRepository()).saveQuestions(valid, user.id);
    revalidatePath("/admin");
    return { imported: ids.length };
  });
}

export async function updateReportStatusAction(id: string, status: string): Promise<ActionResult> {
  return runAction(async () => {
    await assertAdmin();
    await (await getRepository()).updateReportStatus(uuid.parse(id), z.enum(["open", "resolved", "dismissed"]).parse(status));
    revalidatePath("/admin/reports");
  });
}
