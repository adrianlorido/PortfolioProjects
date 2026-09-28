import { Bookmark, ExternalLink, NotebookPen } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { DifficultyBadge } from "@/components/common/difficulty-badge";
import { DomainBadge } from "@/components/common/domain-badge";
import { EmptyState } from "@/components/common/empty-state";
import { MasteryMeter } from "@/components/common/mastery-badge";
import { PageHeader } from "@/components/common/page-header";
import { TopicChips } from "@/components/common/topic-chips";
import { BookmarkButton } from "@/components/library/bookmark-button";
import { StartQuizButton } from "@/components/study/start-quiz-button";
import { Button } from "@/components/ui/button";
import { requireUser } from "@/lib/auth/session";
import { MAX_SESSION_QUESTIONS } from "@/lib/config/study";
import { getRepository } from "@/lib/data";
import { formatRelative } from "@/lib/format";
import { getBookmarks } from "@/lib/services/review-service";

export const metadata: Metadata = { title: "Bookmarks" };

export default async function BookmarksPage() {
  const user = await requireUser();
  const bookmarks = await getBookmarks(user, await getRepository());
  const ids = bookmarks.map((b) => b.question.id).slice(0, MAX_SESSION_QUESTIONS);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Bookmarks"
        description="Questions you saved to revisit. Quiz yourself on all of them or review one at a time."
        actions={
          ids.length > 0 ? (
            <>
              <Button variant="outline" asChild>
                <Link href="/review?bookmarked=1">Review answers</Link>
              </Button>
              <StartQuizButton fields={{ mode: "bookmarked", count: String(ids.length) }}>Quiz all {ids.length}</StartQuizButton>
            </>
          ) : null
        }
      />
      {bookmarks.length === 0 ? (
        <EmptyState
          icon={Bookmark}
          title="No bookmarks yet."
          description="Tap the bookmark icon (or press B) during a quiz to save tricky questions here."
          action={
            <Button asChild>
              <Link href="/study">Start studying</Link>
            </Button>
          }
        />
      ) : (
        <ul className="space-y-3">
          {bookmarks.map((b) => (
            <li key={b.question.id} className="rounded-2xl border bg-card p-4 shadow-sm sm:p-5">
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <DomainBadge domainId={b.question.domainId} />
                <DifficultyBadge difficulty={b.question.difficulty} />
                <span className="text-xs text-muted-foreground">Saved {formatRelative(b.createdAt)}</span>
              </div>
              <Link href={`/questions/${b.question.id}`} className="block leading-relaxed font-medium hover:underline">
                {b.question.stem}
              </Link>
              {b.note && (
                <p className="mt-3 flex gap-2 rounded-xl bg-accent/60 px-3 py-2 text-sm">
                  <NotebookPen className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
                  <span>{b.note}</span>
                </p>
              )}
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <TopicChips topics={b.question.topics} max={3} className="mr-auto" />
                {b.state ? <MasteryMeter level={b.state.mastery} /> : <span className="text-xs text-muted-foreground">Not answered yet</span>}
                <Button variant="ghost" size="sm" asChild>
                  <Link href={`/questions/${b.question.id}`}>
                    <ExternalLink /> Open
                  </Link>
                </Button>
                <BookmarkButton questionId={b.question.id} initial refreshOnChange labels={{ on: "Remove", off: "Bookmark" }} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
