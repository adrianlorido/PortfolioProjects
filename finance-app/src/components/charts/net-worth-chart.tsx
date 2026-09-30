"use client";

import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { NetWorthPoint } from "@/modules/finance/net-worth";
import { formatMoney, money } from "@/modules/finance/money";
import { TooltipCard, TooltipRow } from "./chart-tooltip";

const dateLabel = (iso: string, style: "short" | "long" = "short") =>
  new Intl.DateTimeFormat("en-US", { month: "short", day: style === "long" ? "numeric" : undefined, year: style === "long" ? "numeric" : undefined, timeZone: "UTC" }).format(
    new Date(`${iso}T00:00:00Z`),
  );

export function NetWorthChart({ points }: { points: NetWorthPoint[] }) {
  if (points.length < 2) {
    return <p className="py-16 text-center text-sm text-muted">Not enough balance history yet.</p>;
  }
  const data = points.map((p) => ({ date: p.date, netWorth: p.netWorth, assets: p.assets, liabilities: p.liabilities }));
  return (
    <div className="h-64 w-full" role="img" aria-label={`Net worth from ${dateLabel(points[0]!.date, "long")} to ${dateLabel(points[points.length - 1]!.date, "long")}`}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
          <defs>
            <linearGradient id="nw-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--series-1)" stopOpacity={0.22} />
              <stop offset="100%" stopColor="var(--series-1)" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
          <XAxis dataKey="date" tickFormatter={(d: string) => dateLabel(d)} tick={{ fill: "var(--text-muted)", fontSize: 11 }} axisLine={false} tickLine={false} minTickGap={24} />
          <YAxis
            width={56}
            domain={["auto", "auto"]}
            tickFormatter={(v: number) => formatMoney(money(Math.round(v)), { compact: true })}
            tick={{ fill: "var(--text-muted)", fontSize: 11 }}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip
            cursor={{ stroke: "var(--text-muted)", strokeDasharray: "3 3" }}
            content={({ active, payload }) => {
              const row = active ? (payload?.[0]?.payload as (typeof data)[number] | undefined) : undefined;
              if (!row) return null;
              return (
                <TooltipCard title={dateLabel(row.date, "long")}>
                  <TooltipRow swatch="var(--series-1)" label="Net worth" value={formatMoney(row.netWorth)} />
                  <TooltipRow label="Assets" value={formatMoney(row.assets)} />
                  <TooltipRow label="Liabilities" value={formatMoney(row.liabilities)} />
                </TooltipCard>
              );
            }}
          />
          <Area
            type="monotone"
            dataKey="netWorth"
            stroke="var(--series-1)"
            strokeWidth={2}
            fill="url(#nw-fill)"
            dot={{ r: 3, fill: "var(--series-1)", stroke: "var(--surface)", strokeWidth: 2 }}
            activeDot={{ r: 5, fill: "var(--series-1)", stroke: "var(--surface)", strokeWidth: 2 }}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
