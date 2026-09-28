import type { Difficulty } from "@/lib/types";
import { cn } from "@/lib/utils";

const LEVEL: Record<Difficulty, { label: string; bars: number }> = {
  easy: { label: "Easy", bars: 1 },
  medium: { label: "Medium", bars: 2 },
  hard: { label: "Hard", bars: 3 },
};

export function DifficultyBars({ difficulty, className }: { difficulty: Difficulty; className?: string }) {
  const { bars } = LEVEL[difficulty];
  return (
    <span className={cn("inline-flex items-end gap-[2px]", className)} aria-hidden>
      {[1, 2, 3].map((b) => (
        <span key={b} className={cn("w-[3px] rounded-sm", b <= bars ? "bg-current" : "bg-current opacity-25")} style={{ height: 4 + b * 3 }} />
      ))}
    </span>
  );
}

export function DifficultyBadge({ difficulty, className }: { difficulty: Difficulty; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md border bg-card px-2 py-0.5 text-xs font-medium text-muted-foreground",
        className,
      )}
    >
      <DifficultyBars difficulty={difficulty} className="text-foreground/70" />
      {LEVEL[difficulty].label}
    </span>
  );
}
