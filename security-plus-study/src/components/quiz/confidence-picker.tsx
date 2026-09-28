"use client";

import { cn } from "@/lib/utils";
import type { Confidence } from "@/lib/types";

const OPTIONS: { value: Confidence; label: string; key: string; hint: string }[] = [
  { value: "guessed", label: "Guessed", key: "G", hint: "I wasn't sure at all" },
  { value: "unsure", label: "Unsure", key: "U", hint: "I had a hunch" },
  { value: "confident", label: "Confident", key: "C", hint: "I knew it" },
];

export function ConfidencePicker({
  value,
  onChange,
  disabled,
}: {
  value: Confidence | null;
  onChange: (value: Confidence) => void;
  disabled?: boolean;
}) {
  return (
    <fieldset className="rounded-2xl border bg-card p-4">
      <legend className="sr-only">How confident were you?</legend>
      <div className="mb-3 flex items-baseline justify-between gap-2">
        <p className="text-sm font-medium" aria-hidden>
          How confident were you?
        </p>
        <p className="text-xs text-muted-foreground">Optional · shapes your review schedule</p>
      </div>
      <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Confidence">
        {OPTIONS.map((o) => (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={value === o.value}
            disabled={disabled}
            onClick={() => onChange(o.value)}
            title={o.hint}
            className={cn(
              "flex flex-col items-center gap-0.5 rounded-xl border px-2 py-2.5 text-sm font-medium transition-all outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-60",
              value === o.value ? "border-primary bg-primary text-primary-foreground shadow-sm" : "hover:bg-accent",
            )}
          >
            {o.label}
            <kbd className={cn("font-mono text-[10px] opacity-60", value === o.value && "opacity-80")} aria-hidden>
              {o.key}
            </kbd>
          </button>
        ))}
      </div>
    </fieldset>
  );
}
