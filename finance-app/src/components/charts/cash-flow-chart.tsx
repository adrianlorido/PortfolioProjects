"use client";

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { MonthlyCashFlow } from "@/modules/finance/cash-flow";
import { formatBasisPoints, formatMoney, money } from "@/modules/finance/money";
import { formatMonthLabel } from "@/modules/finance/period";
import { TooltipCard, TooltipRow } from "./chart-tooltip";

export function CashFlowChart({ series, selectedMonth }: { series: MonthlyCashFlow[]; selectedMonth: string | null }) {
  const data = series.map((m) => ({ ...m, label: formatMonthLabel(m.month, "short").split(" ")[0] }));
  return (
    <div>
      <div className="mb-3 flex items-center gap-4 text-xs text-secondary" aria-hidden>
        <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-sm bg-series-1" />Income</span>
        <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-sm bg-series-2" />Spending</span>
      </div>
      <div className="h-56 w-full" role="img" aria-label="Monthly income and spending">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: 8 }} barGap={2} barCategoryGap="28%">
            <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
            <XAxis
              dataKey="label"
              tick={({ x, y, payload, index }) => (
                <text x={x} y={Number(y) + 12} textAnchor="middle" fontSize={11} fontWeight={data[index]?.month === selectedMonth ? 600 : 400} fill={data[index]?.month === selectedMonth ? "var(--text)" : "var(--text-muted)"}>
                  {payload.value}
                </text>
              )}
              axisLine={false}
              tickLine={false}
            />
            <YAxis width={52} tickFormatter={(v: number) => formatMoney(money(Math.round(v)), { compact: true })} tick={{ fill: "var(--text-muted)", fontSize: 11 }} axisLine={false} tickLine={false} />
            <Tooltip
              cursor={{ fill: "var(--surface-2)" }}
              content={({ active, payload }) => {
                const row = active ? (payload?.[0]?.payload as (typeof data)[number] | undefined) : undefined;
                if (!row) return null;
                return (
                  <TooltipCard title={formatMonthLabel(row.month)}>
                    <TooltipRow swatch="var(--series-1)" label="Income" value={formatMoney(row.income)} />
                    <TooltipRow swatch="var(--series-2)" label="Spending" value={formatMoney(row.spending)} />
                    <TooltipRow label="Savings" value={formatMoney(row.savings)} />
                    <TooltipRow label="Savings rate" value={formatBasisPoints(row.savingsRate)} />
                  </TooltipCard>
                );
              }}
            />
            <Bar dataKey="income" name="Income" fill="var(--series-1)" radius={[4, 4, 0, 0]} isAnimationActive={false} />
            <Bar dataKey="spending" name="Spending" fill="var(--series-2)" radius={[4, 4, 0, 0]} isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
