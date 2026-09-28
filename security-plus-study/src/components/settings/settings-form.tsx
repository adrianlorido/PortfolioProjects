"use client";

import { Loader2, Monitor, Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { saveSettingsAction } from "@/lib/actions/settings";
import { DAILY_GOALS, QUIZ_SIZES } from "@/lib/config/study";
import type { ThemePreference, UserSettings } from "@/lib/types";

function Row({ title, description, htmlFor, children }: { title: string; description: string; htmlFor?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-3 py-5 sm:flex-row sm:items-center sm:justify-between sm:gap-8">
      <div className="max-w-md">
        {htmlFor ? (
          <Label htmlFor={htmlFor} className="text-sm font-medium">
            {title}
          </Label>
        ) : (
          <p className="text-sm font-medium">{title}</p>
        )}
        <p className="mt-1 text-sm text-muted-foreground">{description}</p>
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

export function SettingsForm({ initial }: { initial: UserSettings }) {
  const [settings, setSettings] = useState(initial);
  const [saved, setSaved] = useState(initial);
  const [pending, startTransition] = useTransition();
  const { setTheme } = useTheme();
  const dirty = JSON.stringify(settings) !== JSON.stringify(saved);

  const set = <K extends keyof UserSettings>(key: K, value: UserSettings[K]) => {
    setSettings((s) => ({ ...s, [key]: value }));
    if (key === "theme") setTheme(value as ThemePreference);
  };

  const save = () =>
    startTransition(async () => {
      const result = await saveSettingsAction(settings);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setSaved(result.data);
      toast.success("Settings saved");
    });

  return (
    <div>
      <div className="divide-y">
        <Row title="Theme" description="Choose light, dark, or follow your device.">
          <ToggleGroup type="single" value={settings.theme} onValueChange={(v) => v && set("theme", v as ThemePreference)} aria-label="Theme">
            <ToggleGroupItem value="light">
              <Sun /> Light
            </ToggleGroupItem>
            <ToggleGroupItem value="dark">
              <Moon /> Dark
            </ToggleGroupItem>
            <ToggleGroupItem value="system">
              <Monitor /> System
            </ToggleGroupItem>
          </ToggleGroup>
        </Row>
        <Row title="Daily question goal" description="Your dashboard ring fills as you work toward it each day.">
          <ToggleGroup type="single" value={String(settings.dailyGoal)} onValueChange={(v) => v && set("dailyGoal", Number(v))} aria-label="Daily goal">
            {DAILY_GOALS.map((g) => (
              <ToggleGroupItem key={g} value={String(g)} className="min-w-11">
                {g}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </Row>
        <Row title="Default quiz size" description="Pre-selected number of questions for quick quizzes.">
          <ToggleGroup
            type="single"
            value={String(settings.defaultQuizSize)}
            onValueChange={(v) => v && set("defaultQuizSize", Number(v))}
            aria-label="Default quiz size"
          >
            {QUIZ_SIZES.map((g) => (
              <ToggleGroupItem key={g} value={String(g)} className="min-w-11">
                {g}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </Row>
        <Row title="Default difficulty" description="Used for new quizzes and daily study sessions." htmlFor="default-difficulty">
          <Select value={settings.defaultDifficulty} onValueChange={(v) => set("defaultDifficulty", v as UserSettings["defaultDifficulty"])}>
            <SelectTrigger id="default-difficulty" className="w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="any">Any difficulty</SelectItem>
              <SelectItem value="easy">Easy</SelectItem>
              <SelectItem value="medium">Medium</SelectItem>
              <SelectItem value="hard">Hard</SelectItem>
            </SelectContent>
          </Select>
        </Row>
        <Row
          title="Show explanations immediately"
          description="Reveal the full explanation right after each answer. When off, you'll see the result first and can expand the explanation."
          htmlFor="show-explanations"
        >
          <Switch id="show-explanations" checked={settings.showExplanationsImmediately} onCheckedChange={(v) => set("showExplanationsImmediately", v)} />
        </Row>
        <Row
          title="Confidence ratings"
          description="Rate how sure you were after each answer. Guesses come back sooner; confident misses become top priority."
          htmlFor="confidence"
        >
          <Switch id="confidence" checked={settings.confidenceEnabled} onCheckedChange={(v) => set("confidenceEnabled", v)} />
        </Row>
        <Row title="Session timer" description="Show an elapsed-time clock during study sessions (exams always have a timer)." htmlFor="timer">
          <Switch id="timer" checked={settings.timerEnabled} onCheckedChange={(v) => set("timerEnabled", v)} />
        </Row>
        <Row title="Timezone" description="Used to decide when your day (and streak) rolls over. Detected from your browser.">
          <span className="rounded-lg bg-secondary px-3 py-1.5 font-mono text-sm">{settings.timezone}</span>
        </Row>
      </div>
      <div className="sticky bottom-20 mt-4 flex items-center justify-end gap-3 rounded-2xl border bg-card/95 p-3 backdrop-blur lg:bottom-4">
        <p className="mr-auto text-sm text-muted-foreground" aria-live="polite">
          {dirty ? "You have unsaved changes." : "All changes saved."}
        </p>
        <Button variant="ghost" onClick={() => setSettings(saved)} disabled={!dirty || pending}>
          Discard
        </Button>
        <Button onClick={save} disabled={!dirty || pending}>
          {pending && <Loader2 className="animate-spin" aria-hidden />}
          Save changes
        </Button>
      </div>
    </div>
  );
}
