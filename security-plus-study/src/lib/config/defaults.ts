import type { UserSettings } from "@/lib/types";

export const DEFAULT_SETTINGS: UserSettings = {
  theme: "system",
  dailyGoal: 20,
  defaultQuizSize: 10,
  defaultDifficulty: "any",
  showExplanationsImmediately: true,
  confidenceEnabled: true,
  timerEnabled: false,
  timezone: "UTC",
};
