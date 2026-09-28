"use client";

import { Check, X } from "lucide-react";

import { choiceLetter } from "@/lib/questions/transform";
import { cn } from "@/lib/utils";

export type ChoiceReveal = "correct-selected" | "correct-missed" | "incorrect-selected" | "neutral";

interface ChoiceOptionProps {
  index: number;
  text: string;
  selected: boolean;
  multiple: boolean;
  disabled?: boolean;
  reveal?: ChoiceReveal | null;
  onToggle: () => void;
  showShortcut?: boolean;
}

const REVEAL_LABEL: Record<Exclude<ChoiceReveal, "neutral">, string> = {
  "correct-selected": "Your answer · Correct",
  "correct-missed": "Correct answer",
  "incorrect-selected": "Your answer · Incorrect",
};

export function ChoiceOption({ index, text, selected, multiple, disabled, reveal, onToggle, showShortcut = true }: ChoiceOptionProps) {
  const letter = choiceLetter(index);
  const revealed = Boolean(reveal);
  const isCorrect = reveal === "correct-selected" || reveal === "correct-missed";
  const isWrong = reveal === "incorrect-selected";

  return (
    <button
      type="button"
      role={multiple ? "checkbox" : "radio"}
      aria-checked={selected}
      aria-disabled={disabled || revealed}
      onClick={() => !disabled && !revealed && onToggle()}
      className={cn(
        "group relative flex w-full items-start gap-3.5 rounded-2xl border-2 bg-card px-4 py-3.5 text-left transition-all duration-150 outline-none sm:px-5 sm:py-4",
        "focus-visible:ring-[3px] focus-visible:ring-ring/50",
        !revealed && !selected && "border-border hover:border-primary/40 hover:bg-accent/40",
        !revealed && selected && "border-primary bg-primary/[0.06] shadow-sm shadow-primary/10",
        !revealed && "active:scale-[0.995]",
        revealed && "cursor-default",
        isCorrect && "border-success bg-success-soft",
        isWrong && "border-danger bg-danger-soft",
        reveal === "neutral" && "border-border opacity-60",
      )}
    >
      <span
        aria-hidden
        className={cn(
          "grid size-8 shrink-0 place-items-center text-sm font-semibold transition-colors",
          multiple ? "rounded-lg" : "rounded-full",
          !revealed && !selected && "bg-secondary text-secondary-foreground group-hover:bg-primary/10",
          !revealed && selected && "bg-primary text-primary-foreground",
          isCorrect && "bg-success text-success-foreground",
          isWrong && "bg-danger text-danger-foreground",
          reveal === "neutral" && "bg-secondary text-muted-foreground",
        )}
      >
        {isCorrect ? <Check className="size-4" strokeWidth={3} /> : isWrong ? <X className="size-4" strokeWidth={3} /> : letter}
      </span>
      <span className="min-w-0 flex-1 pt-1">
        <span className="sr-only">{`Option ${letter}: `}</span>
        <span className="block text-[15px] leading-relaxed sm:text-base">{text}</span>
        {reveal && reveal !== "neutral" && (
          <span
            className={cn(
              "mt-1.5 inline-flex items-center gap-1 text-xs font-semibold tracking-wide uppercase",
              isCorrect ? "text-success" : "text-danger",
            )}
          >
            {REVEAL_LABEL[reveal]}
          </span>
        )}
      </span>
      {showShortcut && !revealed && (
        <kbd
          aria-hidden
          className="mt-1 hidden rounded-md border bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground sm:block"
        >
          {index + 1}
        </kbd>
      )}
    </button>
  );
}
