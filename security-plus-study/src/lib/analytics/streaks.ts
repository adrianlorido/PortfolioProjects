import type { DailyActivity } from "@/lib/types";
import { addDays } from "./dates";

export interface StreakSummary {
  current: number;
  longest: number;
  studiedToday: boolean;
  answeredToday: number;
}

/**
 * A day counts toward the streak when at least one question was answered.
 * The current streak stays alive through today until midnight: if the learner
 * studied yesterday but not yet today, the streak is still reported.
 */
export function computeStreaks(activity: readonly DailyActivity[], today: string): StreakSummary {
  const active = new Set(activity.filter((a) => a.answered > 0).map((a) => a.date));
  const answeredToday = activity.find((a) => a.date === today)?.answered ?? 0;
  const studiedToday = active.has(today);

  let current = 0;
  let cursor = studiedToday ? today : addDays(today, -1);
  while (active.has(cursor)) {
    current++;
    cursor = addDays(cursor, -1);
  }

  let longest = 0;
  const sorted = [...active].sort();
  let run = 0;
  let prev: string | null = null;
  for (const date of sorted) {
    run = prev !== null && addDays(prev, 1) === date ? run + 1 : 1;
    longest = Math.max(longest, run);
    prev = date;
  }

  return { current, longest: Math.max(longest, current), studiedToday, answeredToday };
}
