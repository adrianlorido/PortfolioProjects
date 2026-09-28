"use client";

import { ArrowDown, ArrowUp, ArrowUpDown, Search } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";

import { StartQuizButton } from "@/components/study/start-quiz-button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { TopicPerformance } from "@/lib/analytics/stats";
import { formatPercent } from "@/lib/format";

type Row = TopicPerformance & { name: string };
type SortKey = "name" | "attempted" | "correct" | "incorrect" | "accuracy" | "mastery";

const COLUMNS: { key: SortKey; label: string; numeric?: boolean }[] = [
  { key: "name", label: "Topic" },
  { key: "attempted", label: "Questions attempted", numeric: true },
  { key: "correct", label: "Correct", numeric: true },
  { key: "incorrect", label: "Incorrect", numeric: true },
  { key: "accuracy", label: "Accuracy", numeric: true },
  { key: "mastery", label: "Mastery", numeric: true },
];

export function TopicTable({ rows }: { rows: Row[] }) {
  const [sort, setSort] = useState<{ key: SortKey; dir: "asc" | "desc" }>({ key: "accuracy", dir: "asc" });
  const [filter, setFilter] = useState("");

  const sorted = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const list = rows.filter((r) => !q || r.name.toLowerCase().includes(q));
    const value = (r: Row) => (sort.key === "name" ? r.name : sort.key === "accuracy" ? (r.accuracy ?? -1) : r[sort.key]);
    return [...list].sort((a, b) => {
      // Topics without answers always sink to the bottom when sorting by accuracy.
      if (sort.key === "accuracy" && (a.accuracy === null) !== (b.accuracy === null)) return a.accuracy === null ? 1 : -1;
      const va = value(a);
      const vb = value(b);
      const cmp = typeof va === "string" ? va.localeCompare(vb as string) : (va as number) - (vb as number);
      return sort.dir === "asc" ? cmp : -cmp;
    });
  }, [rows, sort, filter]);

  const toggle = (key: SortKey) =>
    setSort((s) => (s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: key === "name" ? "asc" : "desc" }));

  return (
    <div>
      <div className="relative mb-3 max-w-xs">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <Input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter topics…" className="pl-9" aria-label="Filter topics" />
      </div>
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            {COLUMNS.map((c) => {
              const active = sort.key === c.key;
              const Icon = active ? (sort.dir === "asc" ? ArrowUp : ArrowDown) : ArrowUpDown;
              return (
                <TableHead
                  key={c.key}
                  className={c.numeric ? "text-right" : undefined}
                  aria-sort={active ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}
                >
                  <button type="button" onClick={() => toggle(c.key)} className="inline-flex items-center gap-1 uppercase hover:text-foreground">
                    {c.label}
                    <Icon className="size-3" aria-hidden />
                  </button>
                </TableHead>
              );
            })}
            <TableHead>
              <span className="sr-only">Actions</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {sorted.map((r) => (
            <TableRow key={r.topicId}>
              <TableCell className="font-medium whitespace-normal">
                <Link href={`/search?topic=${r.topicId}`} className="hover:underline">
                  {r.name}
                </Link>
              </TableCell>
              <TableCell className="text-right">
                {r.attempted}/{r.totalQuestions}
              </TableCell>
              <TableCell className="text-right">{r.correct}</TableCell>
              <TableCell className="text-right">{r.incorrect}</TableCell>
              <TableCell className="text-right font-semibold">{formatPercent(r.accuracy)}</TableCell>
              <TableCell className="text-right text-muted-foreground">{r.masteryLabel}</TableCell>
              <TableCell className="text-right">
                <StartQuizButton fields={{ mode: "topic", count: "10", topicIds: r.topicId }} variant="ghost" size="sm">
                  Practice
                </StartQuizButton>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {sorted.length === 0 && <p className="py-6 text-center text-sm text-muted-foreground">No topics match.</p>}
    </div>
  );
}
