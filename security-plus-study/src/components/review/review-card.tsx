"use client";

import { Bookmark, BookmarkCheck, ChevronDown, CircleCheck, CircleMinus, CircleX, ExternalLink } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";

import { DifficultyBadge } from "@/components/common/difficulty-badge";
import { DomainBadge } from "@/components/common/domain-badge";
import { MasteryMeter } from "@/components/common/mastery-badge";
import { ExplanationDetails } from "@/components/quiz/answer-feedback";
import { NoteEditor } from "@/components/quiz/note-editor";
import { Button } from "@/components/ui/button";
import { setBookmarkAction } from "@/lib/actions/library";
import { callAction } from "@/lib/call-action";
import { formatRelative } from "@/lib/format";
import { choiceLetter } from "@/lib/questions/transform";
import type { AnswerFeedback } from "@/lib/services/feedback";
import type { Confidence, MasteryLevel, QuizQuestion } from "@/lib/types";
import { cn } from "@/lib/utils";

export interface ReviewCardData {
  question: QuizQuestion;
  feedback: AnswerFeedback;
  unanswered: boolean;
  bookmarked: boolean;
  note: string | null;
  mastery: MasteryLevel | null;
  answeredAt: string | null;
  confidence: Confidence | null;
  timesIncorrect: number;
}

export function ReviewCard({ item, defaultOpen = false }: { item: ReviewCardData; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const [bookmarked, setBookmarked] = useState(item.bookmarked);
  const { question, feedback } = item;
  const status = item.unanswered ? "unanswered" : feedback.isCorrect ? "correct" : "incorrect";

  const toggleBookmark = async () => {
    const next = !bookmarked;
    setBookmarked(next);
    const result = await callAction(setBookmarkAction(question.id, next));
    if (!result.ok) {
      setBookmarked(!next);
      toast.error(result.error);
    }
  };

  const answerText = (ids: string[]) =>
    question.choices
      .map((c, i) => (ids.includes(c.id) ? `${choiceLetter(i)}. ${c.text}` : null))
      .filter(Boolean) as string[];

  return (
    <article className="rounded-2xl border bg-card shadow-sm shadow-black/[0.02]">
      <div className="p-4 sm:p-5">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 shrink-0">
            {status === "correct" && <CircleCheck className="size-6 text-success" aria-label="Correct" />}
            {status === "incorrect" && <CircleX className="size-6 text-danger" aria-label="Incorrect" />}
            {status === "unanswered" && <CircleMinus className="size-6 text-muted-foreground" aria-label="Unanswered" />}
          </span>
          <div className="min-w-0 flex-1">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <DomainBadge domainId={question.domainId} />
              <DifficultyBadge difficulty={question.difficulty} />
              {item.confidence && <span className="rounded-md bg-secondary px-2 py-0.5 text-xs capitalize">{item.confidence}</span>}
              {item.timesIncorrect > 1 && <span className="rounded-md bg-danger-soft px-2 py-0.5 text-xs text-danger">Missed {item.timesIncorrect}×</span>}
            </div>
            <p className="leading-relaxed font-medium">{question.stem}</p>

            <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
              <div
                className={cn(
                  "rounded-xl border px-3 py-2",
                  status === "correct" ? "border-success/40 bg-success-soft" : status === "incorrect" ? "border-danger/40 bg-danger-soft" : "border-dashed",
                )}
              >
                <dt className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Your answer</dt>
                <dd className="mt-0.5">{item.unanswered ? "Not answered" : answerText(feedback.selectedChoiceIds).join(" · ")}</dd>
              </div>
              <div className="rounded-xl border border-success/40 bg-success-soft px-3 py-2">
                <dt className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Correct answer</dt>
                <dd className="mt-0.5">{answerText(feedback.correctChoiceIds).join(" · ")}</dd>
              </div>
            </dl>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-1 sm:pl-9">
          <Button variant="ghost" size="sm" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
            <ChevronDown className={cn("transition-transform", open && "rotate-180")} />
            {open ? "Hide explanation" : "Show explanation"}
          </Button>
          <Button variant="ghost" size="sm" onClick={toggleBookmark} aria-pressed={bookmarked} className="text-muted-foreground">
            {bookmarked ? <BookmarkCheck className="text-primary" /> : <Bookmark />}
            {bookmarked ? "Bookmarked" : "Bookmark"}
          </Button>
          <Button variant="ghost" size="sm" asChild className="text-muted-foreground">
            <Link href={`/questions/${question.id}`}>
              <ExternalLink /> Open
            </Link>
          </Button>
          <span className="ml-auto flex items-center gap-3 text-xs text-muted-foreground">
            {item.mastery !== null && <MasteryMeter level={item.mastery} />}
            {item.answeredAt && <span className="hidden sm:inline">{formatRelative(item.answeredAt)}</span>}
          </span>
        </div>
      </div>
      {open && (
        <div className="space-y-3 border-t bg-background/40 p-4 sm:p-5">
          <ExplanationDetails feedback={feedback} question={question} />
          <NoteEditor questionId={question.id} initialNote={item.note} />
        </div>
      )}
    </article>
  );
}
