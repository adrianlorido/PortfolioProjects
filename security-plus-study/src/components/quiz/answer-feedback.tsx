"use client";

import { ArrowRight, Brain, CircleCheck, CircleX, Crosshair, Lightbulb } from "lucide-react";

import { MasteryMeter } from "@/components/common/mastery-badge";
import { getDomain } from "@/lib/config/domains";
import { MASTERY_LABELS } from "@/lib/config/study";
import { getTopicName } from "@/lib/config/topics";
import { formatRelative } from "@/lib/format";
import { choiceLetter } from "@/lib/questions/transform";
import type { AnswerFeedback } from "@/lib/services/feedback";
import type { QuizQuestion } from "@/lib/types";
import { cn } from "@/lib/utils";

function Section({
  icon: Icon,
  title,
  children,
  tone = "default",
}: {
  icon: typeof Lightbulb;
  title: string;
  children: React.ReactNode;
  tone?: "default" | "clue" | "memory";
}) {
  return (
    <section
      className={cn(
        "rounded-2xl border p-4 sm:p-5",
        tone === "default" && "bg-card",
        tone === "clue" && "border-warning/40 bg-warning-soft",
        tone === "memory" && "border-primary/25 bg-accent",
      )}
    >
      <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold">
        <Icon className={cn("size-4", tone === "memory" ? "text-primary" : "text-muted-foreground")} aria-hidden />
        {title}
      </h3>
      <div className="text-[15px] leading-relaxed text-foreground/90">{children}</div>
    </section>
  );
}

export function ResultBanner({ feedback, question }: { feedback: AnswerFeedback; question: QuizQuestion }) {
  const letters = (ids: string[]) =>
    question.choices
      .map((c, i) => (ids.includes(c.id) ? choiceLetter(i) : null))
      .filter(Boolean)
      .join(", ");
  const masteryChanged = feedback.masteryAfter !== feedback.masteryBefore;
  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        "animate-pop-in flex flex-col gap-3 rounded-2xl border-2 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5",
        feedback.isCorrect ? "border-success/60 bg-success-soft" : "border-danger/60 bg-danger-soft",
      )}
    >
      <div className="flex items-center gap-3">
        {feedback.isCorrect ? (
          <CircleCheck className="size-9 shrink-0 text-success" aria-hidden />
        ) : (
          <CircleX className="size-9 shrink-0 text-danger" aria-hidden />
        )}
        <div>
          <p className={cn("text-xl font-semibold", feedback.isCorrect ? "text-success" : "text-danger")}>
            {feedback.isCorrect ? "Correct" : "Incorrect"}
          </p>
          <p className="text-sm text-foreground/80">
            {feedback.isCorrect
              ? `You chose ${letters(feedback.selectedChoiceIds)}.`
              : `You chose ${letters(feedback.selectedChoiceIds) || "nothing"}. Correct answer: ${letters(feedback.correctChoiceIds)}.`}
          </p>
        </div>
      </div>
      <div className="flex flex-col gap-1 sm:items-end">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="font-medium">Mastery</span>
          {masteryChanged && (
            <>
              <span className="line-through decoration-muted-foreground/50">{MASTERY_LABELS[feedback.masteryBefore]}</span>
              <ArrowRight className="size-3" aria-hidden />
            </>
          )}
          <MasteryMeter level={feedback.masteryAfter} />
        </div>
        {feedback.nextReviewAt && (
          <p className="text-xs text-muted-foreground">Next review {formatRelative(feedback.nextReviewAt)}</p>
        )}
      </div>
    </div>
  );
}

export function ExplanationDetails({ feedback, question }: { feedback: AnswerFeedback; question: QuizQuestion }) {
  const correct = question.choices
    .map((c, i) => ({ ...c, letter: choiceLetter(i) }))
    .filter((c) => feedback.correctChoiceIds.includes(c.id));
  const wrong = question.choices
    .map((c, i) => ({ ...c, letter: choiceLetter(i), why: feedback.choiceExplanations[c.id] }))
    .filter((c) => !feedback.correctChoiceIds.includes(c.id));

  return (
    <div className="animate-rise space-y-3">
      <Section icon={CircleCheck} title={correct.length > 1 ? "Correct answers" : "Correct answer"}>
        <ul className="space-y-1.5">
          {correct.map((c) => (
            <li key={c.id} className="flex gap-2">
              <span className="font-semibold text-success">{c.letter}.</span>
              <span className="font-medium">{c.text}</span>
            </li>
          ))}
        </ul>
      </Section>

      <Section icon={Brain} title="Explanation">
        <p>{feedback.explanation}</p>
        {wrong.some((c) => c.why) && (
          <>
            <h4 className="mt-4 mb-2 text-sm font-semibold">Why the other options are wrong</h4>
            <ul className="space-y-2">
              {wrong.map((c) => (
                <li key={c.id} className="flex gap-2.5 text-[14.5px]">
                  <span
                    className={cn(
                      "mt-0.5 grid size-5 shrink-0 place-items-center rounded-md text-[11px] font-semibold",
                      feedback.selectedChoiceIds.includes(c.id) ? "bg-danger text-danger-foreground" : "bg-secondary text-secondary-foreground",
                    )}
                    aria-hidden
                  >
                    {c.letter}
                  </span>
                  <span>
                    <span className="sr-only">Option {c.letter}: </span>
                    {c.why ?? "Not the best answer for this scenario."}
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}
      </Section>

      <Section icon={Crosshair} title="Concept tested">
        <p>
          {getDomain(question.domainId).name} · {question.topics.map((t) => getTopicName(t)).join(", ")}
        </p>
      </Section>

      {feedback.examClue && (
        <Section icon={Lightbulb} title="Exam Clue" tone="clue">
          <p>{feedback.examClue}</p>
        </Section>
      )}
      {feedback.memoryTip && (
        <Section icon={Brain} title="Remember This" tone="memory">
          <p className="font-medium">{feedback.memoryTip}</p>
        </Section>
      )}
    </div>
  );
}
