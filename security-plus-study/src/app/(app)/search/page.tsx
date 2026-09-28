import { Search } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { DifficultyBadge } from "@/components/common/difficulty-badge";
import { DomainBadge } from "@/components/common/domain-badge";
import { EmptyState } from "@/components/common/empty-state";
import { PageHeader } from "@/components/common/page-header";
import { Pagination } from "@/components/common/pagination";
import { TopicChips } from "@/components/common/topic-chips";
import { ReviewFilters } from "@/components/review/review-filters";
import { StartQuizButton } from "@/components/study/start-quiz-button";
import { Input } from "@/components/ui/input";
import { requireUser } from "@/lib/auth/session";
import { isDomainId } from "@/lib/config/domains";
import { getTopicName } from "@/lib/config/topics";
import { getRepository } from "@/lib/data";
import type { Difficulty } from "@/lib/types";

export const metadata: Metadata = { title: "Search" };

const PAGE_SIZE = 20;

function one(v: string | string[] | undefined): string | undefined {
  return typeof v === "string" && v ? v : undefined;
}

function highlight(text: string, query: string) {
  const q = query.trim();
  if (!q) return text;
  const i = text.toLowerCase().indexOf(q.toLowerCase());
  if (i === -1) return text;
  return (
    <>
      {text.slice(0, i)}
      <mark className="rounded bg-warning-soft px-0.5 text-foreground ring-1 ring-warning/40">{text.slice(i, i + q.length)}</mark>
      {text.slice(i + q.length)}
    </>
  );
}

export default async function SearchPage({ searchParams }: PageProps<"/search">) {
  const params = await searchParams;
  await requireUser();
  const repo = await getRepository();
  const query = (one(params.q) ?? "").slice(0, 200);
  const topicId = one(params.topic)?.match(/^[a-z0-9-]{1,60}$/) ? one(params.topic) : undefined;
  const domain = Number(one(params.domain));
  const difficulty = one(params.difficulty);
  const page = Math.max(1, Number(one(params.page)) || 1);
  const filters = {
    query,
    topicId,
    domainId: isDomainId(domain) ? domain : undefined,
    difficulty: difficulty === "easy" || difficulty === "medium" || difficulty === "hard" ? (difficulty as Difficulty) : undefined,
  };
  const active = Boolean(query || topicId || filters.domainId || filters.difficulty);
  const [results, topics, practice] = await Promise.all([
    repo.listQuestions({ ...filters, page, pageSize: PAGE_SIZE }),
    repo.listTopics(),
    active ? repo.listQuestions({ ...filters, page: 1, pageSize: 50 }) : Promise.resolve(null),
  ]);
  const hrefFor = (p: number) => {
    const next = new URLSearchParams(Object.entries(params).flatMap(([k, v]) => (typeof v === "string" ? [[k, v]] : [])));
    next.set("page", String(p));
    return `/search?${next.toString()}`;
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Search questions"
        description="Search question text, explanations, topics and acronyms — try “PKI”, “OCSP” or “race condition”."
        actions={
          practice && practice.items.length > 0 ? (
            <StartQuizButton
              fields={{
                mode: "custom",
                count: String(practice.items.length),
                questionIds: practice.items.map((q) => q.id),
                title: query ? `Search: ${query}`.slice(0, 120) : topicId ? `${getTopicName(topicId)} questions` : "Search results",
              }}
            >
              Quiz these results
            </StartQuizButton>
          ) : null
        }
      />
      <form role="search" action="/search" className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-3.5 size-5 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <Input name="q" type="search" defaultValue={query} placeholder="Search by keyword, topic or acronym…" className="h-12 rounded-2xl pl-11 text-base" aria-label="Search" />
        {topicId && <input type="hidden" name="topic" value={topicId} />}
      </form>
      <Suspense>
        <ReviewFilters topics={topics} showResultFilter={false} showStudyFilters={false} />
      </Suspense>

      {results.items.length === 0 ? (
        <EmptyState
          icon={Search}
          title="No questions found"
          description={active ? "Try a different keyword or remove a filter." : "The question bank is empty."}
        />
      ) : (
        <>
          <p className="text-sm text-muted-foreground" aria-live="polite">
            {results.total} {results.total === 1 ? "question" : "questions"}
            {topicId ? ` tagged ${getTopicName(topicId)}` : ""}
            {query ? ` matching “${query}”` : ""}
          </p>
          <ul className="space-y-3">
            {results.items.map((q) => (
              <li key={q.id}>
                <Link
                  href={`/questions/${q.id}`}
                  className="block rounded-2xl border bg-card p-4 shadow-sm transition-colors hover:border-primary/40 sm:p-5"
                >
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    <DomainBadge domainId={q.domainId} />
                    <DifficultyBadge difficulty={q.difficulty} />
                    {q.questionType === "multiple" && <span className="rounded-md bg-warning-soft px-2 py-0.5 text-xs">Multiple response</span>}
                  </div>
                  <p className="leading-relaxed">{highlight(q.stem, query)}</p>
                  <TopicChips topics={q.topics} className="mt-3" />
                </Link>
              </li>
            ))}
          </ul>
          <Pagination page={page} pageSize={PAGE_SIZE} total={results.total} hrefFor={hrefFor} />
        </>
      )}
    </div>
  );
}
