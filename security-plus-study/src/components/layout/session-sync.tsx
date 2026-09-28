"use client";

import { useTheme } from "next-themes";
import { useEffect, useRef } from "react";

import { updatePreferenceAction } from "@/lib/actions/settings";
import type { ThemePreference } from "@/lib/types";

/**
 * Keeps account preferences and the browser in step: applies the saved theme
 * once per session and records the learner's timezone so streaks roll over at
 * their local midnight.
 */
export function SessionSync({ theme, timezone }: { theme: ThemePreference; timezone: string }) {
  const { setTheme } = useTheme();
  const applied = useRef(false);

  useEffect(() => {
    if (applied.current) return;
    applied.current = true;
    try {
      if (!sessionStorage.getItem("bastion-theme-applied")) {
        setTheme(theme);
        sessionStorage.setItem("bastion-theme-applied", "1");
      }
    } catch {
      // Storage unavailable (private mode); the theme toggle still works.
    }
    const local = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (local && local !== timezone) void updatePreferenceAction({ timezone: local });
  }, [setTheme, theme, timezone]);

  return null;
}
