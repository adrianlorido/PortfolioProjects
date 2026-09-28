"use client";

import { Bar, BarChart, CartesianGrid, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import type { DifficultyPerformance, DomainPerformance } from "@/lib/analytics/stats";
import { getDomain } from "@/lib/config/domains";
import { formatPercent } from "@/lib/format";
import { AXIS_PROPS, ChartCard, ChartTooltip } from "./chart-card";

export function DomainAccuracyChart({ domains }: { domains: DomainPerformance[] }) {
  const data = domains.map((d) => ({
    name: getDomain(d.domainId).shortName,
    code: getDomain(d.domainId).code,
    pct: d.accuracy === null ? 0 : Math.round(d.accuracy * 100),
    hasData: d.accuracy !== null,
    answers: d.answers,
    attempted: d.attempted,
    total: d.totalQuestions,
  }));
  return (
    <ChartCard
      title="Accuracy by domain"
      description="Share of answers correct in each domain."
      chart={
        <div className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} layout="vertical" margin={{ top: 0, right: 44, bottom: 0, left: 8 }} barCategoryGap={10}>
              <CartesianGrid horizontal={false} stroke="var(--chart-grid)" />
              <XAxis type="number" domain={[0, 100]} ticks={[0, 25, 50, 75, 100]} tickFormatter={(v) => `${v}%`} {...AXIS_PROPS} />
              <YAxis type="category" dataKey="name" width={150} {...AXIS_PROPS} axisLine={false} tick={{ fill: "var(--foreground)", fontSize: 12 }} />
              <Tooltip
                cursor={{ fill: "var(--muted)", opacity: 0.6 }}
                content={({ active, payload }) => {
                  const p = payload?.[0]?.payload as (typeof data)[number] | undefined;
                  return (
                    <ChartTooltip
                      active={active}
                      label={p ? `${p.code} ${p.name}` : undefined}
                      rows={p ? [{ label: "Accuracy", value: p.hasData ? `${p.pct}%` : "No data" }, { label: "Answers", value: String(p.answers) }] : []}
                    />
                  );
                }}
              />
              <Bar dataKey="pct" fill="var(--chart-1)" radius={[0, 4, 4, 0]} maxBarSize={24}>
                <LabelList dataKey="pct" position="right" formatter={(v) => `${v}%`} style={{ fill: "var(--foreground)", fontSize: 12, fontWeight: 600 }} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      }
      table={
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-muted-foreground">
            <tr>
              <th className="py-1.5 font-medium">Domain</th>
              <th className="py-1.5 text-right font-medium">Accuracy</th>
              <th className="py-1.5 text-right font-medium">Attempted</th>
            </tr>
          </thead>
          <tbody className="tabular-nums">
            {data.map((d) => (
              <tr key={d.code} className="border-t">
                <td className="py-1.5">
                  {d.code} {d.name}
                </td>
                <td className="py-1.5 text-right">{d.hasData ? `${d.pct}%` : "—"}</td>
                <td className="py-1.5 text-right">
                  {d.attempted}/{d.total}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      }
    />
  );
}

export function DifficultyChart({ difficulty }: { difficulty: DifficultyPerformance[] }) {
  const data = difficulty.map((d) => ({
    name: d.difficulty[0].toUpperCase() + d.difficulty.slice(1),
    pct: d.accuracy === null ? 0 : Math.round(d.accuracy * 100),
    hasData: d.accuracy !== null,
    answers: d.answers,
  }));
  return (
    <ChartCard
      title="Accuracy by difficulty"
      description="How you perform as questions get harder."
      chart={
        <div className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} margin={{ top: 24, right: 12, bottom: 0, left: -12 }} barCategoryGap="30%">
              <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
              <XAxis dataKey="name" {...AXIS_PROPS} tick={{ fill: "var(--foreground)", fontSize: 12 }} />
              <YAxis domain={[0, 100]} ticks={[0, 25, 50, 75, 100]} tickFormatter={(v) => `${v}%`} {...AXIS_PROPS} axisLine={false} />
              <Tooltip
                cursor={{ fill: "var(--muted)", opacity: 0.6 }}
                content={({ active, payload, label }) => {
                  const p = payload?.[0]?.payload as (typeof data)[number] | undefined;
                  return (
                    <ChartTooltip
                      active={active}
                      label={label}
                      rows={p ? [{ label: "Accuracy", value: p.hasData ? `${p.pct}%` : "No data" }, { label: "Answers", value: String(p.answers) }] : []}
                    />
                  );
                }}
              />
              <Bar dataKey="pct" fill="var(--chart-1)" radius={[4, 4, 0, 0]} maxBarSize={24}>
                <LabelList dataKey="pct" position="top" formatter={(v) => `${v}%`} style={{ fill: "var(--foreground)", fontSize: 12, fontWeight: 600 }} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      }
      table={
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-muted-foreground">
            <tr>
              <th className="py-1.5 font-medium">Difficulty</th>
              <th className="py-1.5 text-right font-medium">Accuracy</th>
              <th className="py-1.5 text-right font-medium">Answers</th>
            </tr>
          </thead>
          <tbody className="tabular-nums">
            {difficulty.map((d) => (
              <tr key={d.difficulty} className="border-t capitalize">
                <td className="py-1.5">{d.difficulty}</td>
                <td className="py-1.5 text-right">{formatPercent(d.accuracy)}</td>
                <td className="py-1.5 text-right">{d.answers}</td>
              </tr>
            ))}
          </tbody>
        </table>
      }
    />
  );
}
