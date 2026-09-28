"use client";

import { ScanSearch } from "lucide-react";

import { DifficultyBadge } from "@/components/common/difficulty-badge";
import { DomainBadge } from "@/components/common/domain-badge";
import { selectPrompt } from "@/lib/questions/transform";
import type { QuizQuestion } from "@/lib/types";
import { cn } from "@/lib/utils";
import { ChoiceOption, type ChoiceReveal } from "./choice-option";

interface QuestionCardProps {
  question: QuizQuestion;
  selected: string[];
  onToggle: (choiceId: string) => void;
  /** When set, choices are locked and shown with their result. */
  correctChoiceIds?: string[] | null;
  disabled?: boolean;
  limitHint?: boolean;
  headerExtra?: React.ReactNode;
}

export function revealFor(choiceId: string, selected: string[], correct: string[]): ChoiceReveal {
  const isSelected = selected.includes(choiceId);
  const isCorrect = correct.includes(choiceId);
  if (isCorrect) return isSelected ? "correct-selected" : "correct-missed";
  return isSelected ? "incorrect-selected" : "neutral";
}

export function QuestionCard({ question, selected, onToggle, correctChoiceIds, disabled, limitHint, headerExtra }: QuestionCardProps) {
  const multiple = question.selectCount > 1;
  const stemId = `stem-${question.id}`;
  return (
    <article className="animate-rise" aria-labelledby={stemId}>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <DomainBadge domainId={question.domainId} />
        <DifficultyBadge difficulty={question.difficulty} />
        {question.isScenario && (
          <span className="inline-flex items-center gap-1 rounded-md border bg-card px-2 py-0.5 text-xs font-medium text-muted-foreground">
            <ScanSearch className="size-3.5" aria-hidden /> Scenario
          </span>
        )}
        {headerExtra}
      </div>

      <h2 id={stemId} className="text-lg leading-relaxed font-medium text-pretty sm:text-xl sm:leading-relaxed">
        {question.stem}
      </h2>

      <div className="mt-4 mb-3 flex items-center gap-2">
        <span
          className={cn(
            "inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold tracking-wide uppercase",
            multiple ? "bg-warning-soft text-foreground ring-1 ring-warning/50" : "bg-secondary text-secondary-foreground",
          )}
        >
          {selectPrompt(question.selectCount)}
        </span>
        {multiple && !correctChoiceIds && (
          <span className={cn("text-xs text-muted-foreground transition-colors", limitHint && "animate-shake text-foreground")} aria-live="polite">
            {selected.length}/{question.selectCount} selected
            {limitHint ? " · deselect one to change your answer" : ""}
          </span>
        )}
      </div>

      <div role={multiple ? "group" : "radiogroup"} aria-labelledby={stemId} className="space-y-2.5">
        {question.choices.map((choice, index) => (
          <ChoiceOption
            key={choice.id}
            index={index}
            text={choice.text}
            multiple={multiple}
            selected={selected.includes(choice.id)}
            disabled={disabled}
            reveal={correctChoiceIds ? revealFor(choice.id, selected, correctChoiceIds) : null}
            onToggle={() => onToggle(choice.id)}
          />
        ))}
      </div>
    </article>
  );
}
