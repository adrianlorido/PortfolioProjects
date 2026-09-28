import { dayOfWeek } from "@/lib/analytics/dates";
import type { HeatmapDay } from "@/lib/services/insights-service";
import { formatCalendarDate } from "@/lib/format";

const LEVEL_BG = ["var(--heat-0)", "var(--heat-1)", "var(--heat-2)", "var(--heat-3)", "var(--heat-4)"];
const DAY_LABELS = ["", "Mon", "", "Wed", "", "Fri", ""];

/** GitHub-style study calendar: one column per week, one row per weekday. */
export function ActivityHeatmap({ days }: { days: HeatmapDay[] }) {
  const pad = days.length ? dayOfWeek(days[0].date) : 0;
  const cells: (HeatmapDay | null)[] = [...Array.from({ length: pad }, () => null), ...days];
  const weeks: (HeatmapDay | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));

  const rawLabels = weeks.map((week, i) => {
    const first = week.find(Boolean);
    if (!first) return "";
    const month = formatCalendarDate(first.date, { month: "short" });
    const prev = weeks[i - 1]?.find(Boolean);
    return !prev || formatCalendarDate(prev.date, { month: "short" }) !== month ? month : "";
  });
  // Drop a label when the next month starts within two columns, so labels never collide.
  const monthLabels = rawLabels.map((label, i) => (label && (rawLabels[i + 1] || rawLabels[i + 2]) ? "" : label));

  return (
    <div>
      <div className="overflow-x-auto pb-2">
        <div className="inline-flex gap-2">
          <div className="grid grid-rows-[16px_repeat(7,14px)] gap-[3px] pt-0 text-[10px] text-muted-foreground" aria-hidden>
            <span />
            {DAY_LABELS.map((d, i) => (
              <span key={i} className="leading-[14px]">
                {d}
              </span>
            ))}
          </div>
          <div role="grid" aria-label="Study activity calendar" className="flex gap-[3px]">
            {weeks.map((week, wi) => (
              <div key={wi} role="row" className="grid grid-rows-[16px_repeat(7,14px)] gap-[3px]">
                <span className="text-[10px] whitespace-nowrap text-muted-foreground" aria-hidden>
                  {monthLabels[wi]}
                </span>
                {Array.from({ length: 7 }, (_, di) => {
                  const day = week[di];
                  if (!day) return <span key={di} className="size-[14px]" />;
                  const label = `${formatCalendarDate(day.date, { weekday: "short", month: "short", day: "numeric" })}: ${
                    day.answered ? `${day.answered} answered, ${day.correct} correct` : "no activity"
                  }`;
                  return (
                    <span
                      key={di}
                      role="gridcell"
                      aria-label={label}
                      title={label}
                      className="size-[14px] rounded-[3px] ring-1 ring-black/5 ring-inset dark:ring-white/5"
                      style={{ backgroundColor: LEVEL_BG[day.level] }}
                    />
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="mt-2 flex items-center justify-end gap-1.5 text-xs text-muted-foreground" aria-hidden>
        Less
        {LEVEL_BG.map((bg) => (
          <span key={bg} className="size-3 rounded-[3px] ring-1 ring-black/5 ring-inset" style={{ backgroundColor: bg }} />
        ))}
        More
      </div>
    </div>
  );
}
