"use client";

import { Clock, ListChecks, Timer } from "lucide-react";
import { useActionState, useState } from "react";

import { SubmitButton } from "@/components/common/submit-button";
import { startExamAction, type StartExamState } from "@/lib/actions/exam";
import type { ExamPreset } from "@/lib/config/exam";
import { cn } from "@/lib/utils";

export function ExamSetupForm({ presets, defaultPresetId, bankSize }: { presets: ExamPreset[]; defaultPresetId: string; bankSize: number }) {
  const [state, action] = useActionState<StartExamState, FormData>(startExamAction, {});
  const [presetId, setPresetId] = useState(defaultPresetId);
  const preset = presets.find((p) => p.id === presetId) ?? presets[0];
  const shortBank = bankSize < preset.questionCount;
  const actualCount = Math.min(bankSize, preset.questionCount);
  const actualMinutes = Math.round((preset.timeLimitMinutes / preset.questionCount) * actualCount);

  return (
    <form action={action} className="space-y-5">
      <input type="hidden" name="presetId" value={presetId} />
      <div className="grid gap-3 md:grid-cols-3" role="radiogroup" aria-label="Exam length">
        {presets.map((p) => (
          <button
            key={p.id}
            type="button"
            role="radio"
            aria-checked={presetId === p.id}
            onClick={() => setPresetId(p.id)}
            className={cn(
              "flex flex-col rounded-2xl border-2 bg-card p-5 text-left transition-all outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
              presetId === p.id ? "border-primary shadow-md shadow-primary/10" : "border-border hover:border-primary/40",
            )}
          >
            <span className="flex items-center gap-2 font-semibold">
              <Timer className="size-4 text-primary" aria-hidden /> {p.name}
            </span>
            <span className="mt-1 text-sm text-muted-foreground">{p.description}</span>
            <span className="mt-4 flex gap-4 text-sm">
              <span className="inline-flex items-center gap-1.5">
                <ListChecks className="size-4 text-muted-foreground" aria-hidden /> {p.questionCount} questions
              </span>
              <span className="inline-flex items-center gap-1.5">
                <Clock className="size-4 text-muted-foreground" aria-hidden /> {p.timeLimitMinutes} min
              </span>
            </span>
          </button>
        ))}
      </div>
      {shortBank && (
        <p className="rounded-xl bg-warning-soft px-4 py-3 text-sm">
          The question bank currently has {bankSize} questions, so this exam will use {actualCount} questions and {actualMinutes} minutes at the same
          pace. Import more questions to run full-length exams.
        </p>
      )}
      {state.error && (
        <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">
          {state.error}
        </p>
      )}
      <SubmitButton size="lg" variant="brand" pendingText="Preparing exam…">
        Start {preset.name.toLowerCase()}
      </SubmitButton>
    </form>
  );
}
