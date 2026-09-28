"use client";

import { useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import type { TimelinePoint } from "@/lib/analytics/stats";
import { formatCalendarDate, formatPercent } from "@/lib/format";
import { AXIS_PROPS, ChartCard, ChartTooltip } from "./chart-card";

const RANGES = [
  { value: "14", label: "14 days" },
  { value: "30", label: "30 days" },
  { value: "90", label: "90 days" },
];

const SERIES = {
  rolling: { label: "7-day accuracy", color: "var(--chart-1)" },
  cumulative: { label: "Overall accuracy", color: "var(--chart-2)" },
};

function Legend() {
  return (
    <ul className="mb-3 flex flex-wrap gap-4 text-xs text-muted-foreground" aria-label="Legend">
      {Object.values(SERIES).map((s) => (
        <li key={s.label} className="flex items-center gap-1.5">
          <span className="h-0.5 w-4 rounded-full" style={{ backgroundColor: s.color }} aria-hidden />
          {s.label}
        </li>
      ))}
    </ul>
  );
}

export function TrendsSection({ timeline, dailyGoal }: { timeline: TimelinePoint[]; dailyGoal: number }) {
  const [range, setRange] = useState("30");
  const data = useMemo(
    () =>
      timeline.slice(-Number(range)).map((p) => ({
        ...p,
        label: formatCalendarDate(p.date),
        rollingPct: p.rollingAccuracy === null ? null : Math.round(p.rollingAccuracy * 100),
        cumulativePct: p.cumulativeAccuracy === null ? null : Math.round(p.cumulativeAccuracy * 100),
      })),
    [timeline, range],
  );
  const interval = Number(range) > 30 ? 13 : Number(range) > 14 ? 4 : 1;
  // Round the volume axis to clean ticks that always include the goal line.
  const volumeMax = Math.max(dailyGoal, ...data.map((p) => p.answered));
  const volumeStep = volumeMax <= 20 ? 5 : volumeMax <= 60 ? 10 : 25;
  const volumeTop = Math.ceil((volumeMax + 1) / volumeStep) * volumeStep;
  const volumeTicks = Array.from({ length: volumeTop / volumeStep + 1 }, (_, i) => i * volumeStep);

  return (
    <section aria-label="Trends" className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">Trends</h2>
        <ToggleGroup type="single" value={range} onValueChange={(v) => v && setRange(v)} aria-label="Date range">
          {RANGES.map((r) => (
            <ToggleGroupItem key={r.value} value={r.value} className="h-8 text-xs">
              {r.label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </div>
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <ChartCard
          title="Accuracy over time"
          description="Rolling 7-day accuracy against your all-time accuracy."
          legend={<Legend />}
          chart={
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: -12 }}>
                  <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
                  <XAxis dataKey="label" {...AXIS_PROPS} interval={interval} minTickGap={12} />
                  <YAxis domain={[0, 100]} ticks={[0, 25, 50, 75, 100]} {...AXIS_PROPS} axisLine={false} tickFormatter={(v) => `${v}%`} />
                  <Tooltip
                    cursor={{ stroke: "var(--chart-axis)", strokeWidth: 1 }}
                    content={({ active, payload, label }) => {
                      const p = payload?.[0]?.payload as (typeof data)[number] | undefined;
                      return (
                        <ChartTooltip
                          active={active}
                          label={label}
                          rows={
                            p
                              ? [
                                  { label: SERIES.rolling.label, value: p.rollingPct === null ? "—" : `${p.rollingPct}%`, color: SERIES.rolling.color },
                                  { label: SERIES.cumulative.label, value: p.cumulativePct === null ? "—" : `${p.cumulativePct}%`, color: SERIES.cumulative.color },
                                  { label: "Answered that day", value: String(p.answered) },
                                ]
                              : []
                          }
                        />
                      );
                    }}
                  />
                  <Line type="monotone" dataKey="cumulativePct" stroke={SERIES.cumulative.color} strokeWidth={2} dot={false} activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--card)" }} connectNulls />
                  <Line type="monotone" dataKey="rollingPct" stroke={SERIES.rolling.color} strokeWidth={2} dot={false} activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--card)" }} connectNulls />
                </LineChart>
              </ResponsiveContainer>
            </div>
          }
          table={
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted-foreground">
                <tr>
                  <th className="py-1.5 font-medium">Date</th>
                  <th className="py-1.5 text-right font-medium">7-day</th>
                  <th className="py-1.5 text-right font-medium">Overall</th>
                </tr>
              </thead>
              <tbody className="tabular-nums">
                {[...data].reverse().map((p) => (
                  <tr key={p.date} className="border-t">
                    <td className="py-1.5">{p.label}</td>
                    <td className="py-1.5 text-right">{formatPercent(p.rollingAccuracy)}</td>
                    <td className="py-1.5 text-right">{formatPercent(p.cumulativeAccuracy)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          }
        />
        <ChartCard
          title="Questions answered per day"
          description={`Your daily goal is ${dailyGoal} questions.`}
          chart={
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data} margin={{ top: 16, right: 44, bottom: 0, left: -12 }} barCategoryGap={2}>
                  <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
                  <XAxis dataKey="label" {...AXIS_PROPS} interval={interval} minTickGap={12} />
                  <YAxis domain={[0, volumeTop]} ticks={volumeTicks} {...AXIS_PROPS} axisLine={false} />
                  <Tooltip
                    cursor={{ fill: "var(--muted)", opacity: 0.6 }}
                    content={({ active, payload, label }) => {
                      const p = payload?.[0]?.payload as (typeof data)[number] | undefined;
                      return (
                        <ChartTooltip
                          active={active}
                          label={label}
                          rows={p ? [{ label: "Answered", value: String(p.answered) }, { label: "Correct", value: String(p.correct) }] : []}
                        />
                      );
                    }}
                  />
                  <ReferenceLine y={dailyGoal} stroke="var(--chart-axis)" strokeWidth={1} label={{ value: `Goal ${dailyGoal}`, position: "right", fill: "var(--chart-axis)", fontSize: 11 }} />
                  <Bar dataKey="answered" fill="var(--chart-1)" radius={[4, 4, 0, 0]} maxBarSize={24} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          }
          table={
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted-foreground">
                <tr>
                  <th className="py-1.5 font-medium">Date</th>
                  <th className="py-1.5 text-right font-medium">Answered</th>
                  <th className="py-1.5 text-right font-medium">Correct</th>
                </tr>
              </thead>
              <tbody className="tabular-nums">
                {[...data].reverse().map((p) => (
                  <tr key={p.date} className="border-t">
                    <td className="py-1.5">{p.label}</td>
                    <td className="py-1.5 text-right">{p.answered}</td>
                    <td className="py-1.5 text-right">{p.correct}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          }
        />
      </div>
    </section>
  );
}
