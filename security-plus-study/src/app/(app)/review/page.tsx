import { History, X } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { EmptyState } from "@/components/common/empty-state";
import { PageHeader } from "@/components/common/page-header";
import { Pagination } from "@/components/common/pagination";
import { ReviewCard } from "@/components/review/review-card";
import { ReviewFilters } from "@/components/review/review-filters";
import { StartQuizButton } from "@/components/study/start-quiz-button";
import { Button } from "@/components/ui/button";
import { requireUser } from "@/lib/auth/session";
import { isDomainId } from "@/lib/config/domains";
import { MAX_SESSION_QUESTIONS } from "@/lib/config/study";
import { getRepository } from "@/lib/data";
import { getReviewPage, getSessionReview, type ReviewFilters as Filters } from "@/lib/services/review-service";
import { toReviewCards } from "@/lib/services/review-view";
import type { Difficulty } from "@/lib/types";

export const metadata: Metadata = { title: "Review" };

const UUID = /^[0-9a-f-]{36}$/i;
const PAGE_SIZE = 10;

function one(v: string | string[] | undefined): string | undefined {
  return typeof v === "string" && v ? v : undefined;
}

export default async function ReviewPage({ searchParams }: PageProps<"/review">) {
  const params = await searchParams;
  const user = await requireUser();
  const repo = await getRepository();

  const domain = Number(one(params.domain));
  const difficulty = one(params.difficulty);
  const filters: Filters = {
    result: one(params.result) === "correct" ? "correct" : one(params.result) === "incorrect" ? "incorrect" : undefined,
    guessed: one(params.guessed) === "1",
    bookmarked: one(params.bookmarked) === "1",
    domainId: isDomainId(domain) ? domain : undefined,
    topicId: one(params.topic)?.match(/^[a-z0-9-]{1,60}$/) ? one(params.topic) : undefined,
    difficulty: difficulty === "easy" || difficulty === "medium" || difficulty === "hard" ? (difficulty as Difficulty) : undefined,
  };
  const sessionId = one(params.session);
  const examId = one(params.exam);
  const page = Math.max(1, Number(one(params.page)) || 1);
  const topics = await repo.listTopics();

  let title: string | null = null;
  let cards;
  let total = 0;
  if ((sessionId && UUID.test(sessionId)) || (examId && UUID.test(examId))) {
    const scoped = await getSessionReview(user, repo, { quizSessionId: sessionId, examId }, filters);
    title = scoped?.title ?? null;
    cards = toReviewCards(scoped?.items ?? []);
    total = cards.length;
  } else {
    const result = await getReviewPage(user, repo, filters, page, PAGE_SIZE);
    cards = toReviewCards(result.items);
    total = result.total;
  }
  const scopedParam = sessionId ? `session=${sessionId}` : examId ? `exam=${examId}` : "";
  const hrefFor = (p: number) => {
    const next = new URLSearchParams(Object.entries(params).flatMap(([k, v]) => (typeof v === "string" ? [[k, v]] : [])));
    next.set("page", String(p));
    return `/review?${next.toString()}`;
  };
  const retryIds = cards.filter((c) => !c.feedback.isCorrect).map((c) => c.question.id).slice(0, MAX_SESSION_QUESTIONS);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Review"
        description="Revisit your answers with full explanations. Filter to find exactly what you need to work on."
        actions={
          retryIds.length > 0 && filters.result === "incorrect" ? (
            <StartQuizButton fields={{ mode: "retry", count: String(retryIds.length), questionIds: retryIds, title: "Retry reviewed misses" }}>
              Practice these {retryIds.length}
            </StartQuizButton>
          ) : null
        }
      />
      {title && (
        <div className="flex items-center justify-between gap-3 rounded-xl border bg-accent/50 px-4 py-2.5 text-sm">
          <span>
            Reviewing <span className="font-semibold">{title}</span>
          </span>
          <Button variant="ghost" size="sm" asChild>
            <Link href="/review">
              <X /> All answers
            </Link>
          </Button>
        </div>
      )}
      <Suspense>
        <ReviewFilters topics={topics} />
      </Suspense>

      {cards.length === 0 ? (
        <EmptyState
          icon={History}
          title={filters.result === "incorrect" ? "No missed questions yet." : "Nothing to review yet"}
          description={
            Object.values(filters).some(Boolean)
              ? "No answers match these filters. Try clearing some of them."
              : "Answer a few questions and they'll show up here with explanations."
          }
          action={
            <Button asChild>
              <Link href="/study">Start studying</Link>
            </Button>
          }
        />
      ) : (
        <>
          <p className="text-sm text-muted-foreground" aria-live="polite">
            {total} {total === 1 ? "question" : "questions"}
            {scopedParam ? " in this session" : ""}
          </p>
          <div className="space-y-3">
            {cards.map((c, i) => (
              <ReviewCard key={c.question.id} item={c} defaultOpen={i === 0 && Boolean(scopedParam)} />
            ))}
          </div>
          {!scopedParam && <Pagination page={page} pageSize={PAGE_SIZE} total={total} hrefFor={hrefFor} />}
        </>
      )}
    </div>
  );
}
