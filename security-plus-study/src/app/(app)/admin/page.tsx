import { Database, FileUp, Plus } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { BankFilters } from "@/components/admin/bank-filters";
import { QuestionRowActions } from "@/components/admin/question-row-actions";
import { DifficultyBadge } from "@/components/common/difficulty-badge";
import { DomainBadge } from "@/components/common/domain-badge";
import { EmptyState } from "@/components/common/empty-state";
import { Pagination } from "@/components/common/pagination";
import { TopicChips } from "@/components/common/topic-chips";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireAdmin } from "@/lib/auth/session";
import { isDomainId } from "@/lib/config/domains";
import { getRepository } from "@/lib/data";
import { formatDate } from "@/lib/format";
import type { Difficulty } from "@/lib/types";

export const metadata: Metadata = { title: "Question bank" };

const PAGE_SIZE = 25;

function one(v: string | string[] | undefined): string | undefined {
  return typeof v === "string" && v ? v : undefined;
}

export default async function AdminQuestionsPage({ searchParams }: PageProps<"/admin">) {
  await requireAdmin();
  const params = await searchParams;
  const repo = await getRepository();
  const domain = Number(one(params.domain));
  const difficulty = one(params.difficulty);
  const status = one(params.status);
  const page = Math.max(1, Number(one(params.page)) || 1);
  const [result, topics, bank] = await Promise.all([
    repo.listQuestions({
      query: one(params.q)?.slice(0, 200),
      domainId: isDomainId(domain) ? domain : undefined,
      topicId: one(params.topic)?.match(/^[a-z0-9-]{1,60}$/) ? one(params.topic) : undefined,
      difficulty: difficulty === "easy" || difficulty === "medium" || difficulty === "hard" ? (difficulty as Difficulty) : undefined,
      status: status === "published" || status === "draft" ? status : "all",
      page,
      pageSize: PAGE_SIZE,
    }),
    repo.listTopics(),
    repo.getBankStats(),
  ]);
  const hrefFor = (p: number) => {
    const next = new URLSearchParams(Object.entries(params).flatMap(([k, v]) => (typeof v === "string" ? [[k, v]] : [])));
    next.set("page", String(p));
    return `/admin?${next.toString()}`;
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-muted-foreground">
          <span className="font-semibold text-foreground">{bank.total}</span> published ·{" "}
          {bank.byDifficulty.easy} easy · {bank.byDifficulty.medium} medium · {bank.byDifficulty.hard} hard
        </p>
        <div className="flex gap-2">
          <Button variant="outline" asChild>
            <Link href="/admin/import">
              <FileUp /> Import JSON
            </Link>
          </Button>
          <Button asChild>
            <Link href="/admin/questions/new">
              <Plus /> New question
            </Link>
          </Button>
        </div>
      </div>
      <Suspense>
        <BankFilters topics={topics} />
      </Suspense>

      {result.items.length === 0 ? (
        <EmptyState icon={Database} title="No questions found" description="Try different filters, or create a new question." />
      ) : (
        <div className="rounded-2xl border bg-card">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="w-full">Question</TableHead>
                <TableHead>Domain</TableHead>
                <TableHead>Difficulty</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Updated</TableHead>
                <TableHead>
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {result.items.map((q) => (
                <TableRow key={q.id}>
                  <TableCell className="max-w-xl min-w-72 whitespace-normal">
                    <Link href={`/admin/questions/${q.id}`} className="line-clamp-2 font-medium hover:underline">
                      {q.stem}
                    </Link>
                    <TopicChips topics={q.topics} max={3} className="mt-1.5" />
                  </TableCell>
                  <TableCell>
                    <DomainBadge domainId={q.domainId} />
                  </TableCell>
                  <TableCell>
                    <DifficultyBadge difficulty={q.difficulty} />
                  </TableCell>
                  <TableCell className="text-muted-foreground">{q.questionType === "multiple" ? "Multiple" : "Single"}</TableCell>
                  <TableCell>
                    <Badge variant={q.status === "published" ? "success" : "secondary"} className="capitalize">
                      {q.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{formatDate(q.updatedAt, { month: "short", day: "numeric", year: "2-digit" })}</TableCell>
                  <TableCell>
                    <QuestionRowActions id={q.id} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      <Pagination page={page} pageSize={PAGE_SIZE} total={result.total} hrefFor={hrefFor} />
    </div>
  );
}
