import { MessageSquareWarning } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { ReportActions } from "@/components/admin/report-actions";
import { EmptyState } from "@/components/common/empty-state";
import { Badge } from "@/components/ui/badge";
import { requireAdmin } from "@/lib/auth/session";
import { getRepository } from "@/lib/data";
import { formatRelative } from "@/lib/format";
import type { ReportStatus } from "@/lib/types";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Reported issues" };

const REASONS: Record<string, string> = {
  incorrect_answer: "Marked answer looks wrong",
  unclear: "Unclear or ambiguous",
  typo: "Typo or formatting",
  outdated: "Outdated",
  other: "Other",
};

const TABS: { value: ReportStatus; label: string }[] = [
  { value: "open", label: "Open" },
  { value: "resolved", label: "Resolved" },
  { value: "dismissed", label: "Dismissed" },
];

export default async function ReportsPage({ searchParams }: PageProps<"/admin/reports">) {
  await requireAdmin();
  const params = await searchParams;
  const status = (TABS.find((t) => t.value === params.status)?.value ?? "open") as ReportStatus;
  const reports = await (await getRepository()).listReports(status);

  return (
    <div className="space-y-4">
      <nav className="inline-flex rounded-xl bg-muted p-1" aria-label="Report status">
        {TABS.map((t) => (
          <Link
            key={t.value}
            href={`/admin/reports?status=${t.value}`}
            aria-current={status === t.value ? "page" : undefined}
            className={cn("rounded-lg px-3 py-1.5 text-sm font-medium", status === t.value ? "bg-card shadow-sm" : "text-muted-foreground")}
          >
            {t.label}
          </Link>
        ))}
      </nav>
      {reports.length === 0 ? (
        <EmptyState icon={MessageSquareWarning} title={`No ${status} reports`} description="Learners can report issues from any question." />
      ) : (
        <ul className="space-y-3">
          {reports.map((r) => (
            <li key={r.id} className="rounded-2xl border bg-card p-4 shadow-sm">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <div className="mb-1.5 flex flex-wrap items-center gap-2">
                    <Badge variant={r.reason === "incorrect_answer" ? "danger" : "secondary"}>{REASONS[r.reason] ?? r.reason}</Badge>
                    <span className="text-xs text-muted-foreground">{formatRelative(r.createdAt)}</span>
                  </div>
                  <Link href={`/admin/questions/${r.questionId}`} className="line-clamp-2 font-medium hover:underline">
                    {r.questionStem}
                  </Link>
                  {r.details && <p className="mt-2 rounded-lg bg-muted px-3 py-2 text-sm">{r.details}</p>}
                </div>
                <ReportActions id={r.id} status={r.status} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
