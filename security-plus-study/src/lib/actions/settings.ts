"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { isValidTimeZone } from "@/lib/analytics/dates";
import { assertUser } from "@/lib/auth/session";
import { DAILY_GOALS, QUIZ_SIZES } from "@/lib/config/study";
import { getRepository } from "@/lib/data";
import type { UserSettings } from "@/lib/types";
import { runAction, type ActionResult } from "./result";

const settingsSchema = z.object({
  theme: z.enum(["light", "dark", "system"]),
  dailyGoal: z.number().int().refine((v) => (DAILY_GOALS as readonly number[]).includes(v), "Choose a supported daily goal."),
  defaultQuizSize: z.number().int().refine((v) => (QUIZ_SIZES as readonly number[]).includes(v), "Choose a supported quiz size."),
  defaultDifficulty: z.enum(["any", "easy", "medium", "hard"]),
  showExplanationsImmediately: z.boolean(),
  confidenceEnabled: z.boolean(),
  timerEnabled: z.boolean(),
  timezone: z.string().refine(isValidTimeZone, "Unknown timezone."),
});

export async function saveSettingsAction(input: UserSettings): Promise<ActionResult<UserSettings>> {
  return runAction(async () => {
    const user = await assertUser();
    const settings = settingsSchema.parse(input);
    await (await getRepository()).saveSettings(user.id, settings);
    revalidatePath("/", "layout");
    return settings;
  });
}

export async function updatePreferenceAction(patch: Partial<Pick<UserSettings, "theme" | "timezone">>): Promise<ActionResult> {
  return runAction(async () => {
    const user = await assertUser();
    const repo = await getRepository();
    const current = await repo.getSettings(user.id);
    const next = settingsSchema.parse({ ...current, ...patch });
    if (next.theme !== current.theme || next.timezone !== current.timezone) await repo.saveSettings(user.id, next);
  });
}

export async function updateDisplayNameAction(displayName: string): Promise<ActionResult<{ displayName: string }>> {
  return runAction(async () => {
    const user = await assertUser();
    const name = z.string().trim().min(1, "Enter a name.").max(80, "Name is too long.").parse(displayName);
    await (await getRepository()).updateDisplayName(user.id, name);
    revalidatePath("/", "layout");
    return { displayName: name };
  });
}

export async function resetProgressAction(confirmation: string): Promise<ActionResult> {
  return runAction(async () => {
    const user = await assertUser();
    z.literal("RESET", { error: 'Type "RESET" to confirm.' }).parse(confirmation);
    await (await getRepository()).resetProgress(user.id);
    revalidatePath("/", "layout");
  });
}
