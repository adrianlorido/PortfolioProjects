"use client";

import { Flame, Search, Zap } from "lucide-react";
import { useActionState, useMemo, useState } from "react";

import { DomainDot } from "@/components/common/domain-badge";
import { SubmitButton } from "@/components/common/submit-button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { startQuizAction, type StartQuizState } from "@/lib/actions/study";
import { DOMAINS } from "@/lib/config/domains";
import { QUIZ_SIZES } from "@/lib/config/study";
import type { Difficulty, DomainId } from "@/lib/types";
import { cn } from "@/lib/utils";

type Source = "all" | "domains" | "topics" | "weak" | "unanswered" | "missed" | "bookmarked";

const SOURCES: { value: Source; label: string; hint: string }[] = [
  { value: "all", label: "All domains", hint: "Mixed practice" },
  { value: "domains", label: "Selected domains", hint: "Pick one or more" },
  { value: "topics", label: "Selected topics", hint: "Drill specific topics" },
  { value: "weak", label: "Weak areas only", hint: "Your lowest topics" },
  { value: "unanswered", label: "Unanswered only", hint: "Fresh questions" },
  { value: "missed", label: "Missed only", hint: "Previously wrong" },
  { value: "bookmarked", label: "Bookmarked", hint: "Your saved list" },
];

export interface TopicOption {
  id: string;
  name: string;
  count: number;
  domainHint: DomainId | null;
}

export function QuickQuizForm({
  defaultSize,
  defaultDifficulty,
  topics,
  counts,
}: {
  defaultSize: number;
  defaultDifficulty: Difficulty | "any";
  topics: TopicOption[];
  counts: { weak: number; unanswered: number; missed: number; bookmarked: number };
}) {
  const [state, action] = useActionState<StartQuizState, FormData>(startQuizAction, {});
  const [size, setSize] = useState(String((QUIZ_SIZES as readonly number[]).includes(defaultSize) ? defaultSize : 10));
  const [source, setSource] = useState<Source>("all");
  const [domains, setDomains] = useState<DomainId[]>([]);
  const [topicIds, setTopicIds] = useState<string[]>([]);
  const [topicFilter, setTopicFilter] = useState("");
  const [difficulties, setDifficulties] = useState<string[]>(defaultDifficulty === "any" ? [] : [defaultDifficulty]);
  const [hardMode, setHardMode] = useState(false);

  const filteredTopics = useMemo(() => {
    const q = topicFilter.trim().toLowerCase();
    return topics.filter((t) => !q || t.name.toLowerCase().includes(q) || t.id.includes(q));
  }, [topics, topicFilter]);

  const disabledReason =
    source === "domains" && domains.length === 0
      ? "Choose at least one domain"
      : source === "topics" && topicIds.length === 0
        ? "Choose at least one topic"
        : source === "weak" && counts.weak === 0
          ? "Answer more questions to unlock weak-area quizzes"
          : source === "missed" && counts.missed === 0
            ? "No missed questions yet"
            : source === "bookmarked" && counts.bookmarked === 0
              ? "No bookmarks yet"
              : null;

  const pool = source === "weak" || source === "unanswered" || source === "missed" || source === "bookmarked" ? source : "all";
  const mode = source === "topics" ? "topic" : source === "domains" ? "domain" : source === "weak" ? "weak" : source === "missed" ? "missed" : source === "bookmarked" ? "bookmarked" : "quick";

  return (
    <form action={action} className="space-y-6">
      <input type="hidden" name="mode" value={mode} />
      <input type="hidden" name="count" value={size} />
      <input type="hidden" name="pool" value={pool} />
      {hardMode && <input type="hidden" name="hardMode" value="true" />}
      {source === "domains" && domains.map((d) => <input key={d} type="hidden" name="domainIds" value={d} />)}
      {source === "topics" && topicIds.map((t) => <input key={t} type="hidden" name="topicIds" value={t} />)}
      {difficulties.map((d) => (
        <input key={d} type="hidden" name="difficulties" value={d} />
      ))}

      <fieldset>
        <legend className="mb-2 text-sm font-medium">Number of questions</legend>
        <ToggleGroup type="single" value={size} onValueChange={(v) => v && setSize(v)} aria-label="Number of questions">
          {QUIZ_SIZES.map((n) => (
            <ToggleGroupItem key={n} value={String(n)} className="min-w-12">
              {n}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </fieldset>

      <fieldset>
        <legend className="mb-2 text-sm font-medium">Question source</legend>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" role="radiogroup" aria-label="Question source">
          {SOURCES.map((s) => {
            const count = s.value in counts ? counts[s.value as keyof typeof counts] : null;
            return (
              <button
                key={s.value}
                type="button"
                role="radio"
                aria-checked={source === s.value}
                onClick={() => setSource(s.value)}
                className={cn(
                  "rounded-xl border bg-card px-3 py-2.5 text-left transition-all outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
                  source === s.value ? "border-primary ring-1 ring-primary" : "hover:bg-accent/50",
                )}
              >
                <span className="block text-sm font-medium">{s.label}</span>
                <span className="block text-xs text-muted-foreground">
                  {count !== null ? `${count} available` : s.hint}
                </span>
              </button>
            );
          })}
        </div>
      </fieldset>

      {source === "domains" && (
        <fieldset className="animate-rise rounded-2xl border bg-background/50 p-4">
          <legend className="sr-only">Domains</legend>
          <div className="grid gap-2.5 sm:grid-cols-2">
            {DOMAINS.map((d) => (
              <label key={d.id} className="flex cursor-pointer items-center gap-3 rounded-lg p-1.5 hover:bg-accent/50">
                <Checkbox
                  checked={domains.includes(d.id)}
                  onCheckedChange={(checked) => setDomains((prev) => (checked ? [...prev, d.id] : prev.filter((x) => x !== d.id)))}
                />
                <DomainDot domainId={d.id} />
                <span className="text-sm">
                  <span className="text-muted-foreground">{d.code}</span> {d.name}
                </span>
              </label>
            ))}
          </div>
        </fieldset>
      )}

      {source === "topics" && (
        <fieldset className="animate-rise rounded-2xl border bg-background/50 p-4">
          <legend className="sr-only">Topics</legend>
          <div className="relative mb-3">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input
              value={topicFilter}
              onChange={(e) => setTopicFilter(e.target.value)}
              placeholder="Filter topics (e.g. PKI, SIEM)…"
              className="pl-9"
              aria-label="Filter topics"
            />
          </div>
          <div className="flex max-h-60 flex-wrap gap-2 overflow-y-auto">
            {filteredTopics.map((t) => {
              const on = topicIds.includes(t.id);
              return (
                <button
                  key={t.id}
                  type="button"
                  aria-pressed={on}
                  onClick={() => setTopicIds((prev) => (on ? prev.filter((x) => x !== t.id) : [...prev, t.id]))}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
                    on ? "border-primary bg-primary text-primary-foreground" : "bg-card hover:bg-accent",
                  )}
                >
                  {t.domainHint && <DomainDot domainId={t.domainHint} />}
                  {t.name}
                  <span className={cn("text-xs", on ? "text-primary-foreground/70" : "text-muted-foreground")}>{t.count}</span>
                </button>
              );
            })}
            {filteredTopics.length === 0 && <p className="text-sm text-muted-foreground">No topics match.</p>}
          </div>
          {topicIds.length > 0 && <p className="mt-3 text-xs text-muted-foreground">{topicIds.length} selected</p>}
        </fieldset>
      )}

      <div className="flex flex-col gap-6 sm:flex-row sm:items-start sm:justify-between">
        <fieldset>
          <legend className="mb-2 text-sm font-medium">Difficulty</legend>
          <ToggleGroup type="multiple" value={difficulties} onValueChange={setDifficulties} aria-label="Difficulty">
            <ToggleGroupItem value="easy">Easy</ToggleGroupItem>
            <ToggleGroupItem value="medium">Medium</ToggleGroupItem>
            <ToggleGroupItem value="hard">Hard</ToggleGroupItem>
          </ToggleGroup>
          <p className="mt-1.5 text-xs text-muted-foreground">{difficulties.length === 0 ? "Any difficulty" : "Only selected levels"}</p>
        </fieldset>
        <div className="flex items-start gap-3 rounded-2xl border bg-card p-3 sm:max-w-xs">
          <Flame className="mt-0.5 size-5 shrink-0 text-orange-500" aria-hidden />
          <div className="flex-1">
            <Label htmlFor="hard-mode" className="font-semibold">
              Hard Mode
            </Label>
            <p className="mt-1 text-xs text-muted-foreground">Strongly favors scenario-based and hard questions.</p>
          </div>
          <Switch id="hard-mode" checked={hardMode} onCheckedChange={setHardMode} />
        </div>
      </div>

      {state.error && (
        <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">
          {state.error}
        </p>
      )}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <SubmitButton size="lg" disabled={Boolean(disabledReason)} pendingText="Building quiz…">
          <Zap /> Start quiz
        </SubmitButton>
        {disabledReason && <p className="text-sm text-muted-foreground">{disabledReason}</p>}
      </div>
    </form>
  );
}
