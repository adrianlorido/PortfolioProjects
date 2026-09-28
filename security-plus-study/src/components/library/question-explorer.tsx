"use client";

import { Eye, Loader2 } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { ExplanationDetails } from "@/components/quiz/answer-feedback";
import { QuestionCard } from "@/components/quiz/question-card";
import { Button } from "@/components/ui/button";
import { revealAnswerAction } from "@/lib/actions/library";
import type { AnswerFeedback } from "@/lib/services/feedback";
import type { QuizQuestion } from "@/lib/types";

/** Read-only question with an explicit "reveal answer" step (answers are fetched only on demand). */
export function QuestionExplorer({ question }: { question: QuizQuestion }) {
  const [selected, setSelected] = useState<string[]>([]);
  const [feedback, setFeedback] = useState<AnswerFeedback | null>(null);
  const [pending, startTransition] = useTransition();

  const toggle = (id: string) => {
    if (feedback) return;
    setSelected((prev) =>
      question.selectCount === 1 ? [id] : prev.includes(id) ? prev.filter((x) => x !== id) : prev.length < question.selectCount ? [...prev, id] : prev,
    );
  };

  const reveal = () =>
    startTransition(async () => {
      const result = await revealAnswerAction(question.id);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setFeedback(result.data);
    });

  return (
    <div className="space-y-5">
      <QuestionCard question={question} selected={selected} onToggle={toggle} correctChoiceIds={feedback?.correctChoiceIds ?? null} />
      {!feedback ? (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <Button onClick={reveal} disabled={pending}>
            {pending ? <Loader2 className="animate-spin" aria-hidden /> : <Eye />} Reveal answer
          </Button>
          <p className="text-sm text-muted-foreground">Picking an answer here is just for you: it doesn&apos;t affect your stats.</p>
        </div>
      ) : (
        <ExplanationDetails feedback={feedback} question={question} />
      )}
    </div>
  );
}
