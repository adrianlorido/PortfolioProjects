import { MASTERY_LABELS } from "@/lib/config/study";
import type { MasteryLevel } from "@/lib/types";
import { cn } from "@/lib/utils";

/** Five-segment meter + label so mastery never relies on color alone. */
export function MasteryMeter({ level, className, showLabel = true }: { level: MasteryLevel; className?: string; showLabel?: boolean }) {
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <span className="flex gap-0.5" aria-hidden>
        {[1, 2, 3, 4].map((step) => (
          <span key={step} className={cn("h-1.5 w-3 rounded-full", step <= level ? "bg-primary" : "bg-primary/15")} />
        ))}
      </span>
      {showLabel && <span className="text-xs font-medium text-muted-foreground">{MASTERY_LABELS[level]}</span>}
      {!showLabel && <span className="sr-only">Mastery: {MASTERY_LABELS[level]}</span>}
    </span>
  );
}
