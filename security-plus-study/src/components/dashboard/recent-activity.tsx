import { CircleCheck, CircleDot, CircleX, History } from "lucide-react";
import Link from "next/link";

import { EmptyState } from "@/components/common/empty-state";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDate, formatDuration } from "@/lib/format";
import type { RecentActivityItem } from "@/lib/services/insights-service";

function ResultBadge({ item }: { item: RecentActivityItem }) {
  switch (item.status) {
    case "passed":
      return (
        <Badge variant="success">
          <CircleCheck aria-hidden /> Passed
        </Badge>
      );
    case "failed":
      return (
        <Badge variant="danger">
          <CircleX aria-hidden /> Below passing
        </Badge>
      );
    case "in_progress":
      return (
        <Badge variant="soft">
          <CircleDot aria-hidden /> In progress
        </Badge>
      );
    default:
      return <Badge variant="secondary">Completed</Badge>;
  }
}

export function RecentActivity({ items }: { items: RecentActivityItem[] }) {
  if (items.length === 0) {
    return (
      <EmptyState icon={History} title="No activity yet" description="Your quizzes and practice exams will appear here." className="py-8" />
    );
  }
  return (
    <>
      <ul className="divide-y md:hidden">
        {items.map((item) => (
          <li key={item.id}>
            <Link href={item.href} className="flex items-center justify-between gap-3 py-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{item.title}</p>
                <p className="text-xs text-muted-foreground">
                  {formatDate(item.startedAt)} · {item.modeLabel} · {item.answered}/{item.questions}
                </p>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1">
                <span className="text-sm font-semibold tabular-nums">{item.percent !== null ? `${item.percent}%` : "—"}</span>
                <ResultBadge item={item} />
              </div>
            </Link>
          </li>
        ))}
      </ul>
      <Table className="hidden md:table">
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead>Date</TableHead>
            <TableHead>Mode</TableHead>
            <TableHead className="text-right">Questions</TableHead>
            <TableHead className="text-right">Score</TableHead>
            <TableHead className="text-right">Time</TableHead>
            <TableHead>Result</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((item) => (
            <TableRow key={item.id} className="group">
              <TableCell>
                <Link href={item.href} className="font-medium group-hover:underline">
                  {formatDate(item.startedAt, { month: "short", day: "numeric" })}
                </Link>
              </TableCell>
              <TableCell>
                <span className="block max-w-56 truncate">{item.title}</span>
                <span className="text-xs text-muted-foreground">{item.modeLabel}</span>
              </TableCell>
              <TableCell className="text-right">
                {item.answered}/{item.questions}
              </TableCell>
              <TableCell className="text-right font-semibold">{item.percent !== null ? `${item.percent}%` : "—"}</TableCell>
              <TableCell className="text-right">{item.timeSeconds ? formatDuration(item.timeSeconds) : "—"}</TableCell>
              <TableCell>
                <ResultBadge item={item} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </>
  );
}
