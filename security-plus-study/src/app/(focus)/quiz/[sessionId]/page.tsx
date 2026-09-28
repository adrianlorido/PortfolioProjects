import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { QuizRunner } from "@/components/quiz/quiz-runner";
import { toLocalDate } from "@/lib/analytics/dates";
import { requireUser } from "@/lib/auth/session";
import { getRepository } from "@/lib/data";
import { loadQuizSession } from "@/lib/services/study-service";

export const metadata: Metadata = { title: "Study session" };

export default async function QuizPage({ params }: PageProps<"/quiz/[sessionId]">) {
  const { sessionId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(sessionId)) notFound();
  const user = await requireUser();
  const repo = await getRepository();
  const loaded = await loadQuizSession(user, repo, sessionId);
  if (!loaded || loaded.questions.length === 0) notFound();

  const today = toLocalDate(new Date(), loaded.settings.timezone);
  const [todayActivity] = await repo.getActivity(user.id, today);

  return (
    <QuizRunner
      sessionId={loaded.session.id}
      title={loaded.session.title}
      questions={loaded.questions}
      initialAnswered={loaded.answered}
      initialBookmarks={loaded.bookmarkedIds}
      initialNotes={loaded.notes}
      settings={{
        showExplanationsImmediately: loaded.settings.showExplanationsImmediately,
        confidenceEnabled: loaded.settings.confidenceEnabled,
        timerEnabled: loaded.settings.timerEnabled,
      }}
      goal={{ dailyGoal: loaded.settings.dailyGoal, answeredToday: todayActivity?.answered ?? 0 }}
    />
  );
}
