"use client";

import { ChartColumn, Table2 } from "lucide-react";
import { useState } from "react";

import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/** Card wrapper that pairs every chart with an accessible table view. */
export function ChartCard({
  title,
  description,
  chart,
  table,
  className,
  legend,
}: {
  title: string;
  description?: string;
  chart: React.ReactNode;
  table: React.ReactNode;
  className?: string;
  legend?: React.ReactNode;
}) {
  const [view, setView] = useState<"chart" | "table">("chart");
  return (
    <Card className={cn("gap-4", className)}>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        {description && <CardDescription>{description}</CardDescription>}
        <CardAction>
          <div className="inline-flex rounded-lg border p-0.5" role="radiogroup" aria-label={`${title} view`}>
            {(["chart", "table"] as const).map((v) => (
              <button
                key={v}
                type="button"
                role="radio"
                aria-checked={view === v}
                aria-label={v === "chart" ? "Chart view" : "Table view"}
                onClick={() => setView(v)}
                className={cn("rounded-md p-1.5 text-muted-foreground", view === v && "bg-secondary text-foreground")}
              >
                {v === "chart" ? <ChartColumn className="size-4" /> : <Table2 className="size-4" />}
              </button>
            ))}
          </div>
        </CardAction>
      </CardHeader>
      <CardContent>
        {view === "chart" ? (
          <>
            {legend}
            {chart}
          </>
        ) : (
          <div className="max-h-80 overflow-auto">{table}</div>
        )}
      </CardContent>
    </Card>
  );
}

export function ChartTooltip({
  active,
  label,
  rows,
}: {
  active?: boolean;
  label?: React.ReactNode;
  rows: { label: string; value: string; color?: string }[];
}) {
  if (!active) return null;
  return (
    <div className="min-w-36 rounded-xl border bg-popover px-3 py-2 text-xs shadow-lg">
      {label && <p className="mb-1 font-medium text-foreground">{label}</p>}
      <ul className="space-y-0.5">
        {rows.map((r) => (
          <li key={r.label} className="flex items-center justify-between gap-4">
            <span className="flex items-center gap-1.5 text-muted-foreground">
              {r.color && <span className="h-0.5 w-3 rounded-full" style={{ backgroundColor: r.color }} aria-hidden />}
              {r.label}
            </span>
            <span className="font-medium text-foreground tabular-nums">{r.value}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export const AXIS_PROPS = {
  tick: { fill: "var(--chart-axis)", fontSize: 12 },
  tickLine: false,
  axisLine: { stroke: "var(--chart-grid)" },
} as const;
