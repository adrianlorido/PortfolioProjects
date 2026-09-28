"use client";

import { ArrowLeft, ArrowRight, Bookmark, BookmarkCheck, Clock, Flag, Keyboard, Loader2, Trophy, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { toast } from "sonner";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useHotkeys } from "@/hooks/use-hotkeys";
import { setBookmarkAction } from "@/lib/actions/library";
import { endQuizAction, rateConfidenceAction, submitAnswerAction } from "@/lib/actions/study";
import { formatClock } from "@/lib/format";
import type { AnswerFeedback } from "@/lib/services/feedback";
import type { Confidence, QuizQuestion } from "@/lib/types";
import { cn } from "@/lib/utils";
import { ExplanationDetails, ResultBanner } from "./answer-feedback";
import { ConfidencePicker } from "./confidence-picker";
import { NoteEditor } from "./note-editor";
import { QuestionCard } from "./question-card";
import { ReportDialog } from "./report-dialog";
import { ShortcutsDialog } from "./shortcuts-dialog";

export interface QuizRunnerProps {
  sessionId: string;
  title: string;
  questions: QuizQuestion[];
  initialAnswered: Record<string, AnswerFeedback>;
  initialBookmarks: string[];
  initialNotes: Record<string, string>;
  settings: { showExplanationsImmediately: boolean; confidenceEnabled: boolean; timerEnabled: boolean };
  goal: { dailyGoal: number; answeredToday: number };
}

const SEGMENT_LIMIT = 30;

/** Wall-clock milliseconds; kept outside the component so event handlers stay pure for the compiler. */
const now = () => Date.now();

export function QuizRunner({ sessionId, title, questions, initialAnswered, initialBookmarks, initialNotes, settings, goal }: QuizRunnerProps) {
  const router = useRouter();
  const firstOpen = questions.findIndex((q) => !initialAnswered[q.id]);
  const [index, setIndex] = useState(firstOpen === -1 ? 0 : firstOpen);
  const [answered, setAnswered] = useState(initialAnswered);
  const [selections, setSelections] = useState<Record<string, string[]>>(() =>
    Object.fromEntries(Object.entries(initialAnswered).map(([id, f]) => [id, f.selectedChoiceIds])),
  );
  const [bookmarks, setBookmarks] = useState(() => new Set(initialBookmarks));
  const [notes, setNotes] = useState(initialNotes);
  const [explanationOpen, setExplanationOpen] = useState(settings.showExplanationsImmediately);
  const [limitHint, setLimitHint] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [exitOpen, setExitOpen] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [pending, startTransition] = useTransition();
  const [finishing, startFinishing] = useTransition();
  const questionStart = useRef(0);
  const answeredToday = useRef(goal.answeredToday);
  const nextButton = useRef<HTMLButtonElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  // Marks the runner as interactive (keyboard shortcuts attached) for end-to-end tests.
  useEffect(() => {
    rootRef.current?.setAttribute("data-ready", "true");
  }, []);

  const question = questions[index];
  const feedback = answered[question.id];
  const selected = selections[question.id] ?? [];
  const answeredCount = Object.keys(answered).length;
  const correctCount = Object.values(answered).filter((f) => f.isCorrect).length;
  const allDone = answeredCount === questions.length;
  const isLast = index === questions.length - 1;
  const canSubmit = !feedback && selected.length === question.selectCount && !pending;
  const nextOpenIndex = questions.findIndex((q, i) => i > index && !answered[q.id]);
  const firstOpenIndex = questions.findIndex((q) => !answered[q.id]);

  useEffect(() => {
    questionStart.current = Date.now();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, [index]);

  const goTo = (next: number) => {
    setIndex(next);
    setExplanationOpen(settings.showExplanationsImmediately);
    setLimitHint(false);
  };

  useEffect(() => {
    if (!settings.timerEnabled) return;
    const started = Date.now();
    const id = window.setInterval(() => setElapsed(Math.floor((Date.now() - started) / 1000)), 1000);
    return () => window.clearInterval(id);
  }, [settings.timerEnabled]);

  const toggleChoice = useCallback(
    (choiceId: string) => {
      if (feedback) return;
      setSelections((prev) => {
        const current = prev[question.id] ?? [];
        if (question.selectCount === 1) return { ...prev, [question.id]: [choiceId] };
        if (current.includes(choiceId)) return { ...prev, [question.id]: current.filter((id) => id !== choiceId) };
        if (current.length >= question.selectCount) {
          setLimitHint(true);
          window.setTimeout(() => setLimitHint(false), 1800);
          return prev;
        }
        return { ...prev, [question.id]: [...current, choiceId] };
      });
    },
    [feedback, question.id, question.selectCount],
  );

  const submit = () => {
    if (!canSubmit) return;
    const timeSpentMs = now() - questionStart.current;
    startTransition(async () => {
      const result = await submitAnswerAction({
        sessionId,
        questionId: question.id,
        selectedChoiceIds: selected,
        timeSpentMs,
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setAnswered((prev) => ({ ...prev, [question.id]: result.data }));
      const before = answeredToday.current;
      answeredToday.current = before + 1;
      if (before < goal.dailyGoal && before + 1 >= goal.dailyGoal) {
        toast.success("Daily goal complete", {
          description: `${goal.dailyGoal} questions today. Consistency beats cramming.`,
          icon: <Trophy className="size-4" aria-hidden />,
        });
      }
      window.setTimeout(() => nextButton.current?.focus({ preventScroll: true }), 50);
    });
  };

  const finish = () =>
    startFinishing(async () => {
      await endQuizAction(sessionId);
      router.push(`/quiz/${sessionId}/summary`);
    });

  const goNext = () => {
    if (!feedback) return;
    if (allDone && (isLast || nextOpenIndex === -1)) return finish();
    if (nextOpenIndex !== -1) goTo(nextOpenIndex);
    else if (firstOpenIndex !== -1) goTo(firstOpenIndex);
    else if (!isLast) goTo(index + 1);
  };

  const goPrevious = () => index > 0 && goTo(index - 1);

  const toggleBookmark = () => {
    const next = !bookmarks.has(question.id);
    setBookmarks((prev) => {
      const copy = new Set(prev);
      if (next) copy.add(question.id);
      else copy.delete(question.id);
      return copy;
    });
    void setBookmarkAction(question.id, next).then((result) => {
      if (!result.ok) {
        toast.error(result.error);
        setBookmarks((prev) => {
          const copy = new Set(prev);
          if (next) copy.delete(question.id);
          else copy.add(question.id);
          return copy;
        });
      }
    });
  };

  const rate = (confidence: Confidence) => {
    if (!feedback || feedback.confidence === confidence) return;
    const previous = feedback;
    setAnswered((prev) => ({ ...prev, [question.id]: { ...feedback, confidence } }));
    void rateConfidenceAction({ attemptId: feedback.attemptId, confidence }).then((result) => {
      if (!result.ok) {
        toast.error(result.error);
        setAnswered((prev) => ({ ...prev, [question.id]: previous }));
        return;
      }
      setAnswered((prev) => ({
        ...prev,
        [question.id]: { ...prev[question.id], confidence, masteryAfter: result.data.masteryAfter, nextReviewAt: result.data.nextReviewAt },
      }));
    });
  };

  const hotkeys: Record<string, () => void> = {
    Enter: () => (feedback ? goNext() : submit()),
    b: toggleBookmark,
    e: () => feedback && setExplanationOpen((v) => !v),
    ArrowLeft: goPrevious,
    ArrowRight: () => feedback && goNext(),
    "?": () => setShortcutsOpen(true),
  };
  question.choices.forEach((c, i) => {
    if (i < 9) hotkeys[String(i + 1)] = () => toggleChoice(c.id);
  });
  if (settings.confidenceEnabled) {
    hotkeys.g = () => rate("guessed");
    hotkeys.u = () => rate("unsure");
    hotkeys.c = () => rate("confident");
  }
  useHotkeys(hotkeys, !shortcutsOpen && !exitOpen);

  const bookmarked = bookmarks.has(question.id);
  const primaryLabel = feedback ? (allDone && (isLast || nextOpenIndex === -1) ? "Finish session" : "Next question") : "Submit answer";

  return (
    <div ref={rootRef} className="flex min-h-dvh flex-col">
      {/* Top bar */}
      <header className="sticky top-0 z-30 border-b bg-background/85 backdrop-blur-lg">
        <div className="mx-auto flex h-14 max-w-3xl items-center gap-2 px-3 sm:px-4">
          <AlertDialog open={exitOpen} onOpenChange={setExitOpen}>
            <AlertDialogTrigger asChild>
              <Button variant="ghost" size="icon" aria-label="Exit session">
                <X className="size-5" />
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Leave this session?</AlertDialogTitle>
                <AlertDialogDescription>
                  Your answers are saved. You can pick up where you left off from Recent activity on your dashboard.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Keep studying</AlertDialogCancel>
                <AlertDialogAction onClick={() => router.push(answeredCount > 0 ? `/quiz/${sessionId}/summary` : "/dashboard")}>
                  Leave session
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>

          <div className="min-w-0 flex-1 text-center">
            <p className="truncate text-xs text-muted-foreground">{title}</p>
            <p className="text-sm font-semibold tabular-nums">
              Question {index + 1} <span className="font-normal text-muted-foreground">of {questions.length}</span>
            </p>
          </div>

          {settings.timerEnabled && (
            <span className="hidden items-center gap-1.5 rounded-lg bg-secondary px-2.5 py-1 font-mono text-xs tabular-nums sm:inline-flex" aria-label="Elapsed time">
              <Clock className="size-3.5" aria-hidden /> {formatClock(elapsed)}
            </span>
          )}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                onClick={toggleBookmark}
                aria-pressed={bookmarked}
                aria-label={bookmarked ? "Remove bookmark" : "Bookmark question"}
              >
                {bookmarked ? <BookmarkCheck className="size-5 fill-primary/20 text-primary" /> : <Bookmark className="size-5" />}
              </Button>
            </TooltipTrigger>
            <TooltipContent>{bookmarked ? "Bookmarked (B)" : "Bookmark (B)"}</TooltipContent>
          </Tooltip>
          <Button variant="ghost" size="icon" className="hidden sm:inline-flex" aria-label="Keyboard shortcuts" onClick={() => setShortcutsOpen(true)}>
            <Keyboard className="size-5" />
          </Button>
        </div>
        <SessionProgress
          questions={questions}
          answered={answered}
          index={index}
          onJump={(i) => (answered[questions[i].id] || i === firstOpenIndex ? goTo(i) : undefined)}
        />
      </header>

      {/* Question */}
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 pt-6 pb-36 sm:pt-8">
        <QuestionCard
          key={question.id}
          question={question}
          selected={selected}
          onToggle={toggleChoice}
          correctChoiceIds={feedback?.correctChoiceIds ?? null}
          disabled={pending}
          limitHint={limitHint}
        />

        {feedback && (
          <div className="mt-6 space-y-3">
            <ResultBanner feedback={feedback} question={question} />
            {settings.confidenceEnabled && <ConfidencePicker value={feedback.confidence} onChange={rate} />}
            {explanationOpen ? (
              <ExplanationDetails feedback={feedback} question={question} />
            ) : (
              <Button variant="outline" className="w-full" onClick={() => setExplanationOpen(true)}>
                Show explanation <kbd className="ml-1 font-mono text-[11px] text-muted-foreground">E</kbd>
              </Button>
            )}
            <div className="flex flex-wrap items-center gap-1">
              <Button variant="ghost" size="sm" onClick={toggleBookmark} aria-pressed={bookmarked} className="text-muted-foreground">
                {bookmarked ? <BookmarkCheck className="text-primary" /> : <Bookmark />}
                {bookmarked ? "Bookmarked" : "Bookmark question"}
              </Button>
              <ReportDialog
                questionId={question.id}
                trigger={
                  <Button variant="ghost" size="sm" className="text-muted-foreground">
                    <Flag /> Report issue
                  </Button>
                }
              />
            </div>
            <NoteEditor
              key={`note-${question.id}`}
              questionId={question.id}
              initialNote={notes[question.id] ?? null}
              onSaved={(body) => setNotes((prev) => ({ ...prev, [question.id]: body ?? "" }))}
            />
          </div>
        )}
      </main>

      {/* Action bar */}
      <footer className="pb-safe fixed inset-x-0 bottom-0 z-30 border-t bg-background/90 backdrop-blur-lg">
        <div className="mx-auto flex max-w-3xl items-center gap-3 px-4 py-3">
          <Button variant="ghost" size="icon" onClick={goPrevious} disabled={index === 0} aria-label="Previous question">
            <ArrowLeft className="size-5" />
          </Button>
          <p className="hidden flex-1 text-sm text-muted-foreground sm:block" aria-live="polite">
            <span className="font-medium text-foreground">{correctCount}</span> correct ·{" "}
            <span className="font-medium text-foreground">{answeredCount - correctCount}</span> incorrect ·{" "}
            {questions.length - answeredCount} left
          </p>
          <div className="flex-1 sm:hidden" />
          <Button
            ref={nextButton}
            size="lg"
            onClick={feedback ? goNext : submit}
            disabled={feedback ? finishing : !canSubmit}
            className="min-w-44"
          >
            {(pending || finishing) && <Loader2 className="animate-spin" aria-hidden />}
            {primaryLabel}
            {!pending && !finishing && feedback && <ArrowRight aria-hidden />}
            <kbd className="ml-1 hidden rounded bg-primary-foreground/15 px-1.5 font-mono text-[10px] sm:inline" aria-hidden>
              Enter
            </kbd>
          </Button>
        </div>
      </footer>

      <ShortcutsDialog open={shortcutsOpen} onOpenChange={setShortcutsOpen} confidenceEnabled={settings.confidenceEnabled} />
    </div>
  );
}

function SessionProgress({
  questions,
  answered,
  index,
  onJump,
}: {
  questions: QuizQuestion[];
  answered: Record<string, AnswerFeedback>;
  index: number;
  onJump: (index: number) => void;
}) {
  const done = Object.keys(answered).length;
  if (questions.length > SEGMENT_LIMIT) {
    return <Progress value={(done / questions.length) * 100} className="h-1 rounded-none" aria-label={`${done} of ${questions.length} answered`} />;
  }
  return (
    <ol className="mx-auto flex max-w-3xl gap-1 px-3 pb-2 sm:px-4" aria-label="Session progress">
      {questions.map((q, i) => {
        const f = answered[q.id];
        const state = f ? (f.isCorrect ? "correct" : "incorrect") : "unanswered";
        return (
          <li key={q.id} className="flex-1">
            <button
              type="button"
              onClick={() => onJump(i)}
              aria-label={`Question ${i + 1}: ${state}${i === index ? " (current)" : ""}`}
              aria-current={i === index ? "step" : undefined}
              className={cn(
                "block h-1.5 w-full rounded-full transition-all",
                state === "correct" && "bg-success",
                state === "incorrect" && "bg-danger",
                state === "unanswered" && "bg-primary/15",
                i === index && "h-2 -translate-y-px ring-2 ring-primary/40",
              )}
            />
          </li>
        );
      })}
    </ol>
  );
}
