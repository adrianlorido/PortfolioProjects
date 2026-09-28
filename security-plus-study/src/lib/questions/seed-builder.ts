import { TOPICS } from "@/lib/config/topics";
import type { Question, Topic } from "@/lib/types";
import { validateImport, type ImportIssue } from "./import-schema";
import { stableUuid } from "./stable-id";

export interface SeedBank {
  questions: Question[];
  topics: Topic[];
  issues: ImportIssue[];
}

const SEED_TIMESTAMP = "2026-01-01T00:00:00.000Z";

function stemKey(stem: string): string {
  return stem.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/**
 * Validate raw seed files with the same importer used for user uploads, then
 * assign deterministic ids so reseeding is idempotent.
 */
export function buildSeedBank(files: unknown[]): SeedBank {
  const questions: Question[] = [];
  const topics = new Map<string, Topic>(TOPICS.map((t) => [t.id, { id: t.id, name: t.name }]));
  const issues: ImportIssue[] = [];

  for (const file of files) {
    const result = validateImport(file);
    if (result.fileError) throw new Error(`Seed file error: ${result.fileError}`);
    issues.push(...result.issues.filter((i) => i.severity === "error"));
    for (const { input } of result.valid) {
      const id = input.id ?? stableUuid(`question:${stemKey(input.stem)}`);
      for (const t of input.topics) if (!topics.has(t.id)) topics.set(t.id, t);
      const correctCount = input.choices.filter((c) => c.isCorrect).length;
      questions.push({
        id,
        stem: input.stem,
        choices: input.choices.map((c, i) => ({
          id: stableUuid(`${id}:choice:${i}`),
          text: c.text,
          isCorrect: c.isCorrect,
          explanation: c.explanation,
        })),
        domainId: input.domainId,
        topics: input.topics.map((t) => t.id),
        difficulty: input.difficulty,
        questionType: correctCount > 1 ? "multiple" : "single",
        correctCount,
        explanation: input.explanation,
        examClue: input.examClue,
        memoryTip: input.memoryTip,
        isScenario: input.isScenario,
        status: input.status,
        createdAt: SEED_TIMESTAMP,
        updatedAt: SEED_TIMESTAMP,
      });
    }
  }
  return { questions, topics: [...topics.values()], issues };
}
