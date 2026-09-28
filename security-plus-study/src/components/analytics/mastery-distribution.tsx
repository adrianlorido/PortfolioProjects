import { MASTERY_DESCRIPTIONS, MASTERY_LABELS } from "@/lib/config/study";
import type { MasteryLevel } from "@/lib/types";

const LEVELS: MasteryLevel[] = [0, 1, 2, 3, 4];
const FILL = ["var(--heat-0)", "var(--heat-1)", "var(--heat-2)", "var(--heat-3)", "var(--heat-4)"];

/** Stacked bar on an ordinal (light → dark) ramp, with a labelled legend so values never rely on color. */
export function MasteryDistribution({ counts }: { counts: Record<MasteryLevel, number> }) {
  const total = LEVELS.reduce<number>((s, l) => s + counts[l], 0) || 1;
  return (
    <div>
      <div className="flex h-4 gap-[2px] overflow-hidden rounded-full" role="img" aria-label={LEVELS.map((l) => `${MASTERY_LABELS[l]}: ${counts[l]}`).join(", ")}>
        {LEVELS.map((l) =>
          counts[l] > 0 ? <span key={l} style={{ width: `${(counts[l] / total) * 100}%`, backgroundColor: FILL[l] }} className="h-full first:rounded-l-full last:rounded-r-full" /> : null,
        )}
      </div>
      <ul className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-5">
        {LEVELS.map((l) => (
          <li key={l} className="rounded-xl border p-3">
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <span className="size-2.5 rounded-sm ring-1 ring-black/10 ring-inset" style={{ backgroundColor: FILL[l] }} aria-hidden />
              {MASTERY_LABELS[l]}
            </p>
            <p className="mt-1 text-xl font-semibold">{counts[l]}</p>
            <p className="text-[11px] text-muted-foreground">{MASTERY_DESCRIPTIONS[l]}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}
