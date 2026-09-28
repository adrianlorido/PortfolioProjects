"use client";

import { ArrowLeft, ArrowRight, Check, CloudOff, Flag, Grid3x3, Keyboard, Loader2, Send, Timer } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { QuestionCard } from "@/components/quiz/question-card";
import { ShortcutsDialog } from "@/components/quiz/shortcuts-dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useHotkeys } from "@/hooks/use-hotkeys";
import { saveExamResponseAction, submitExamAction } from "@/lib/actions/exam";
import { formatClock } from "@/lib/format";
import type { ExamResponse, QuizQuestion } from "@/lib/types";
import { cn } from "@/lib/utils";

type SaveState = "idle" | "saving" | "saved" | "error";
type NavFilter = "all" | "unanswered" | "flagged";

export interface ExamRunnerProps {
  examId: string;
  title: string;
  questions: QuizQuestion[];
  initialResponses: Record<string, ExamResponse>;
  expiresAt: string;
  serverNow: string;
}

export function ExamRunner({ examId, title, questions, initialResponses, expiresAt, serverNow }: ExamRunnerProps) {
  const router = useRouter();
  const [index, setIndex] = useState(() => {
    const first = questions.findIndex((q) => !(initialResponses[q.id]?.selectedChoiceIds.length > 0));
    return first === -1 ? 0 : first;
  });
  const [responses, setResponses] = useState<Record<string, ExamResponse>>(initialResponses);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [remaining, setRemaining] = useState<number | null>(null);
  const [navOpen, setNavOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [filter, setFilter] = useState<NavFilter>("all");

  const responsesRef = useRef(responses);
  const timers = useRef(new Map<string, number>());
  const inflight = useRef(new Set<Promise<unknown>>());
  const offset = useRef(0);
  const submittedRef = useRef(false);
  const warned = useRef(new Set<number>());
  const rootRef = useRef<HTMLDivElement>(null);

  // Marks the runner as interactive (keyboard shortcuts attached) for end-to-end tests.
  useEffect(() => {
    rootRef.current?.setAttribute("data-ready", "true");
  }, []);

  const question = questions[index];
  const response = responses[question.id] ?? { selectedChoiceIds: [], flagged: false };
  const isAnswered = (id: string) => (responses[id]?.selectedChoiceIds.length ?? 0) > 0;
  const answeredCount = questions.filter((q) => isAnswered(q.id)).length;
  const flaggedCount = questions.filter((q) => responses[q.id]?.flagged).length;
  const unansweredCount = questions.length - answeredCount;

  useEffect(() => {
    responsesRef.current = responses;
  }, [responses]);

  const save = useCallback(
    (questionId: string) => {
      const current = responsesRef.current[questionId] ?? { selectedChoiceIds: [], flagged: false };
      setSaveState("saving");
      const p = saveExamResponseAction({ examId, questionId, selectedChoiceIds: current.selectedChoiceIds, flagged: current.flagged })
        .then((result) => {
          setSaveState(result.ok ? "saved" : "error");
          if (!result.ok) toast.error(result.error, { id: "exam-save" });
        })
        .catch(() => setSaveState("error"))
        .finally(() => inflight.current.delete(p));
      inflight.current.add(p);
    },
    [examId],
  );

  const queueSave = useCallback(
    (questionId: string) => {
      const existing = timers.current.get(questionId);
      if (existing) window.clearTimeout(existing);
      timers.current.set(
        questionId,
        window.setTimeout(() => {
          timers.current.delete(questionId);
          save(questionId);
        }, 400),
      );
    },
    [save],
  );

  const flush = useCallback(async () => {
    for (const [questionId, timer] of timers.current) {
      window.clearTimeout(timer);
      timers.current.delete(questionId);
      save(questionId);
    }
    await Promise.allSettled([...inflight.current]);
  }, [save]);

  const submit = useCallback(
    async (auto = false) => {
      if (submittedRef.current) return;
      submittedRef.current = true;
      setSubmitting(true);
      setConfirmOpen(false);
      await flush();
      const result = await submitExamAction(examId);
      if (!result.ok) {
        submittedRef.current = false;
        setSubmitting(false);
        toast.error(result.error);
        return;
      }
      if (auto) toast.info("Time's up — your exam was submitted.");
      router.replace(result.data.href);
    },
    [examId, flush, router],
  );

  // Countdown against the server clock.
  useEffect(() => {
    offset.current = new Date(serverNow).getTime() - Date.now();
    const deadline = new Date(expiresAt).getTime();
    const tick = () => {
      const secs = Math.max(0, Math.round((deadline - (Date.now() + offset.current)) / 1000));
      setRemaining(secs);
      for (const mark of [600, 300, 60]) {
        if (secs <= mark && secs > mark - 5 && !warned.current.has(mark)) {
          warned.current.add(mark);
          toast.warning(`${mark / 60} minute${mark === 60 ? "" : "s"} remaining`, { id: "exam-time" });
        }
      }
      if (secs <= 0) void submit(true);
    };
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [expiresAt, serverNow, submit]);

  // Warn before closing the tab with unsaved changes.
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (timers.current.size > 0 || inflight.current.size > 0) e.preventDefault();
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, []);

  const update = (questionId: string, next: ExamResponse) => {
    setResponses((prev) => {
      const merged = { ...prev, [questionId]: next };
      responsesRef.current = merged;
      return merged;
    });
    queueSave(questionId);
  };

  const toggleChoice = (choiceId: string) => {
    if (submitting) return;
    const selected = response.selectedChoiceIds;
    let nextSelected: string[];
    if (question.selectCount === 1) nextSelected = [choiceId];
    else if (selected.includes(choiceId)) nextSelected = selected.filter((id) => id !== choiceId);
    else if (selected.length < question.selectCount) nextSelected = [...selected, choiceId];
    else return;
    update(question.id, { ...response, selectedChoiceIds: nextSelected });
  };

  const toggleFlag = () => update(question.id, { ...response, flagged: !response.flagged });
  const clearAnswer = () => update(question.id, { ...response, selectedChoiceIds: [] });
  const goTo = (i: number) => {
    setIndex(Math.max(0, Math.min(questions.length - 1, i)));
    setNavOpen(false);
    window.scrollTo({ top: 0 });
  };

  const hotkeys: Record<string, () => void> = {
    f: toggleFlag,
    n: () => setNavOpen(true),
    ArrowLeft: () => goTo(index - 1),
    ArrowRight: () => goTo(index + 1),
    Enter: () => (index < questions.length - 1 ? goTo(index + 1) : setConfirmOpen(true)),
    "?": () => setShortcutsOpen(true),
  };
  question.choices.forEach((c, i) => {
    if (i < 9) hotkeys[String(i + 1)] = () => toggleChoice(c.id);
  });
  useHotkeys(hotkeys, !submitting && !confirmOpen && !navOpen && !shortcutsOpen);

  const lowTime = remaining !== null && remaining <= 300;
  const navigator = (
    <ExamNavigator
      questions={questions}
      responses={responses}
      index={index}
      filter={filter}
      onFilter={setFilter}
      onJump={goTo}
      counts={{ answered: answeredCount, flagged: flaggedCount, unanswered: unansweredCount }}
    />
  );

  return (
    <div ref={rootRef} className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-30 border-b bg-background/85 backdrop-blur-lg">
        <div className="mx-auto flex h-16 max-w-6xl items-center gap-3 px-3 sm:px-6">
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs text-muted-foreground">{title}</p>
            <p className="text-sm font-semibold tabular-nums">
              Question {index + 1} <span className="font-normal text-muted-foreground">of {questions.length}</span>
            </p>
          </div>
          <SaveIndicator state={saveState} />
          <div
            className={cn(
              "flex items-center gap-1.5 rounded-xl border px-3 py-1.5 font-mono text-sm font-semibold tabular-nums",
              lowTime ? "border-danger/50 bg-danger-soft text-danger" : "bg-card",
            )}
            role="timer"
            aria-label={remaining === null ? "Time remaining" : `Time remaining ${formatClock(remaining)}`}
          >
            <Timer className="size-4" aria-hidden />
            {remaining === null ? "--:--" : formatClock(remaining)}
          </div>
          <Button variant="ghost" size="icon" className="hidden sm:inline-flex" onClick={() => setShortcutsOpen(true)} aria-label="Keyboard shortcuts">
            <Keyboard className="size-5" />
          </Button>
          <Button onClick={() => setConfirmOpen(true)} disabled={submitting} className="hidden sm:inline-flex">
            {submitting ? <Loader2 className="animate-spin" aria-hidden /> : <Send aria-hidden />} Submit exam
          </Button>
        </div>
        <div className="h-1 bg-primary/10" aria-hidden>
          <div className="h-full bg-primary transition-all" style={{ width: `${(answeredCount / questions.length) * 100}%` }} />
        </div>
      </header>

      <div className="mx-auto grid w-full max-w-6xl flex-1 gap-8 px-4 pt-6 pb-32 sm:px-6 lg:grid-cols-[1fr_18rem]">
        <main className="min-w-0">
          <QuestionCard
            key={question.id}
            question={question}
            selected={response.selectedChoiceIds}
            onToggle={toggleChoice}
            disabled={submitting}
            headerExtra={
              response.flagged ? (
                <span className="inline-flex items-center gap-1 rounded-md bg-warning-soft px-2 py-0.5 text-xs font-medium ring-1 ring-warning/50">
                  <Flag className="size-3.5" aria-hidden /> Flagged
                </span>
              ) : null
            }
          />
          <div className="mt-4 flex flex-wrap gap-2">
            <Button variant={response.flagged ? "secondary" : "outline"} size="sm" onClick={toggleFlag} aria-pressed={response.flagged}>
              <Flag className={cn(response.flagged && "fill-warning text-foreground")} /> {response.flagged ? "Unflag" : "Flag for review"}
              <kbd className="ml-1 font-mono text-[10px] text-muted-foreground">F</kbd>
            </Button>
            {response.selectedChoiceIds.length > 0 && (
              <Button variant="ghost" size="sm" onClick={clearAnswer} className="text-muted-foreground">
                Clear answer
              </Button>
            )}
          </div>
        </main>
        <aside className="hidden lg:block">
          <div className="sticky top-24">{navigator}</div>
        </aside>
      </div>

      <footer className="pb-safe fixed inset-x-0 bottom-0 z-30 border-t bg-background/90 backdrop-blur-lg">
        <div className="mx-auto flex max-w-6xl items-center gap-2 px-4 py-3 sm:px-6">
          <Button variant="outline" onClick={() => goTo(index - 1)} disabled={index === 0}>
            <ArrowLeft /> <span className="hidden sm:inline">Previous</span>
          </Button>
          <Button variant="ghost" className="lg:hidden" onClick={() => setNavOpen(true)}>
            <Grid3x3 /> {answeredCount}/{questions.length}
          </Button>
          <p className="hidden flex-1 text-center text-sm text-muted-foreground lg:block">
            {answeredCount} answered · {flaggedCount} flagged · {unansweredCount} unanswered
          </p>
          <div className="flex-1 lg:hidden" />
          {index < questions.length - 1 ? (
            <Button onClick={() => goTo(index + 1)}>
              Next <ArrowRight />
            </Button>
          ) : (
            <Button onClick={() => setConfirmOpen(true)} disabled={submitting}>
              <Send /> Review & submit
            </Button>
          )}
          <Button variant="secondary" onClick={() => setConfirmOpen(true)} disabled={submitting} className="sm:hidden" aria-label="Submit exam">
            <Send />
          </Button>
        </div>
      </footer>

      <Sheet open={navOpen} onOpenChange={setNavOpen}>
        <SheetContent side="bottom" className="max-h-[85dvh] overflow-y-auto">
          <SheetHeader>
            <SheetTitle>Question navigator</SheetTitle>
          </SheetHeader>
          <div className="px-4 pb-6">{navigator}</div>
        </SheetContent>
      </Sheet>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Submit your exam?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3">
                <p>You can&apos;t change answers after submitting.</p>
                <ul className="grid grid-cols-3 gap-2 text-center">
                  <li className="rounded-xl border p-3">
                    <span className="block text-xl font-semibold text-foreground">{answeredCount}</span>
                    <span className="text-xs">Answered</span>
                  </li>
                  <li className={cn("rounded-xl border p-3", unansweredCount > 0 && "border-danger/40 bg-danger-soft")}>
                    <span className="block text-xl font-semibold text-foreground">{unansweredCount}</span>
                    <span className="text-xs">Unanswered</span>
                  </li>
                  <li className={cn("rounded-xl border p-3", flaggedCount > 0 && "border-warning/50 bg-warning-soft")}>
                    <span className="block text-xl font-semibold text-foreground">{flaggedCount}</span>
                    <span className="text-xs">Flagged</span>
                  </li>
                </ul>
                {unansweredCount > 0 && <p>Unanswered questions are scored as incorrect.</p>}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep working</AlertDialogCancel>
            <AlertDialogAction onClick={() => void submit(false)}>Submit exam</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <ShortcutsDialog open={shortcutsOpen} onOpenChange={setShortcutsOpen} mode="exam" />

      {submitting && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-background/70 backdrop-blur-sm" role="status" aria-live="assertive">
          <div className="flex items-center gap-3 rounded-2xl border bg-card px-5 py-4 shadow-lg">
            <Loader2 className="size-5 animate-spin text-primary" aria-hidden /> Grading your exam…
          </div>
        </div>
      )}
      <span className="sr-only" aria-live="polite">
        {remaining !== null && remaining <= 60 ? `${remaining} seconds remaining` : ""}
      </span>
    </div>
  );
}

function SaveIndicator({ state }: { state: SaveState }) {
  if (state === "idle") return null;
  return (
    <span className="hidden items-center gap-1.5 text-xs text-muted-foreground md:inline-flex" aria-live="polite">
      {state === "saving" && (
        <>
          <Loader2 className="size-3.5 animate-spin" aria-hidden /> Saving…
        </>
      )}
      {state === "saved" && (
        <>
          <Check className="size-3.5 text-success" aria-hidden /> Saved
        </>
      )}
      {state === "error" && (
        <>
          <CloudOff className="size-3.5 text-danger" aria-hidden /> Not saved
        </>
      )}
    </span>
  );
}

function ExamNavigator({
  questions,
  responses,
  index,
  filter,
  onFilter,
  onJump,
  counts,
}: {
  questions: QuizQuestion[];
  responses: Record<string, ExamResponse>;
  index: number;
  filter: NavFilter;
  onFilter: (f: NavFilter) => void;
  onJump: (i: number) => void;
  counts: { answered: number; flagged: number; unanswered: number };
}) {
  const filters: { value: NavFilter; label: string; count: number }[] = [
    { value: "all", label: "All", count: questions.length },
    { value: "unanswered", label: "Unanswered", count: counts.unanswered },
    { value: "flagged", label: "Flagged", count: counts.flagged },
  ];
  return (
    <div className="rounded-2xl border bg-card p-4">
      <div className="mb-3 flex gap-1 rounded-xl bg-muted p-1" role="tablist" aria-label="Filter questions">
        {filters.map((f) => (
          <button
            key={f.value}
            role="tab"
            aria-selected={filter === f.value}
            onClick={() => onFilter(f.value)}
            className={cn(
              "flex-1 rounded-lg px-2 py-1 text-xs font-medium transition-colors",
              filter === f.value ? "bg-card shadow-sm" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {f.label} <span className="tabular-nums opacity-70">{f.count}</span>
          </button>
        ))}
      </div>
      <ol className="grid grid-cols-6 gap-1.5" aria-label="Questions">
        {questions.map((q, i) => {
          const r = responses[q.id];
          const answered = (r?.selectedChoiceIds.length ?? 0) > 0;
          const flagged = Boolean(r?.flagged);
          if (filter === "unanswered" && answered) return null;
          if (filter === "flagged" && !flagged) return null;
          return (
            <li key={q.id}>
              <button
                type="button"
                onClick={() => onJump(i)}
                aria-current={i === index ? "step" : undefined}
                aria-label={`Question ${i + 1}${answered ? ", answered" : ", unanswered"}${flagged ? ", flagged" : ""}`}
                className={cn(
                  "relative grid h-9 w-full place-items-center rounded-lg border text-xs font-semibold tabular-nums transition-colors",
                  answered ? "border-primary/30 bg-primary/15 text-foreground" : "bg-background text-muted-foreground hover:bg-accent",
                  i === index && "ring-2 ring-primary ring-offset-1 ring-offset-card",
                )}
              >
                {i + 1}
                {flagged && <Flag className="absolute -top-1 -right-1 size-3.5 fill-warning text-foreground" aria-hidden />}
              </button>
            </li>
          );
        })}
      </ol>
      <dl className="mt-4 grid grid-cols-3 gap-2 text-center text-xs text-muted-foreground">
        <div>
          <dt className="flex items-center justify-center gap-1">
            <span className="size-2.5 rounded-sm bg-primary/30" aria-hidden /> Answered
          </dt>
          <dd className="text-sm font-semibold text-foreground">{counts.answered}</dd>
        </div>
        <div>
          <dt className="flex items-center justify-center gap-1">
            <span className="size-2.5 rounded-sm border" aria-hidden /> Open
          </dt>
          <dd className="text-sm font-semibold text-foreground">{counts.unanswered}</dd>
        </div>
        <div>
          <dt className="flex items-center justify-center gap-1">
            <Flag className="size-3 fill-warning" aria-hidden /> Flagged
          </dt>
          <dd className="text-sm font-semibold text-foreground">{counts.flagged}</dd>
        </div>
      </dl>
    </div>
  );
}
