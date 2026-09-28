"use client";

import { X } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DOMAINS } from "@/lib/config/domains";
import { cn } from "@/lib/utils";

const ANY = "__any";

export function ReviewFilters({
  topics,
  showResultFilter = true,
  showStudyFilters = true,
}: {
  topics: { id: string; name: string }[];
  showResultFilter?: boolean;
  showStudyFilters?: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();

  const set = (key: string, value: string | null) => {
    const next = new URLSearchParams(params.toString());
    if (value === null || value === ANY || value === "") next.delete(key);
    else next.set(key, value);
    next.delete("page");
    startTransition(() => router.replace(`${pathname}?${next.toString()}`, { scroll: false }));
  };

  const result = params.get("result") ?? "all";
  const chip = (key: string, label: string) => {
    const on = params.get(key) === "1";
    return (
      <button
        type="button"
        aria-pressed={on}
        onClick={() => set(key, on ? null : "1")}
        className={cn(
          "h-9 rounded-lg border px-3 text-sm font-medium transition-colors",
          on ? "border-primary bg-primary text-primary-foreground" : "bg-card hover:bg-accent",
        )}
      >
        {label}
      </button>
    );
  };
  const hasFilters = ["result", "guessed", "bookmarked", "domain", "topic", "difficulty"].some((k) => params.get(k));

  return (
    <div className={cn("flex flex-wrap items-center gap-2 transition-opacity", pending && "opacity-60")} aria-busy={pending}>
      {showResultFilter && (
        <div className="inline-flex rounded-lg border bg-card p-0.5" role="radiogroup" aria-label="Result">
          {[
            { value: "all", label: "All" },
            { value: "incorrect", label: "Incorrect" },
            { value: "correct", label: "Correct" },
          ].map((o) => (
            <button
              key={o.value}
              type="button"
              role="radio"
              aria-checked={result === o.value}
              onClick={() => set("result", o.value === "all" ? null : o.value)}
              className={cn(
                "h-8 rounded-md px-3 text-sm font-medium transition-colors",
                result === o.value ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {o.label}
            </button>
          ))}
        </div>
      )}
      {showStudyFilters && chip("guessed", "Guessed")}
      {showStudyFilters && chip("bookmarked", "Bookmarked")}
      <Select value={params.get("domain") ?? ANY} onValueChange={(v) => set("domain", v)}>
        <SelectTrigger className="h-9 w-auto min-w-36" aria-label="Domain">
          <SelectValue placeholder="Domain" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ANY}>All domains</SelectItem>
          {DOMAINS.map((d) => (
            <SelectItem key={d.id} value={String(d.id)}>
              {d.code} {d.shortName}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select value={params.get("topic") ?? ANY} onValueChange={(v) => set("topic", v)}>
        <SelectTrigger className="h-9 w-auto min-w-36" aria-label="Topic">
          <SelectValue placeholder="Topic" />
        </SelectTrigger>
        <SelectContent className="max-h-80">
          <SelectItem value={ANY}>All topics</SelectItem>
          {topics.map((t) => (
            <SelectItem key={t.id} value={t.id}>
              {t.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select value={params.get("difficulty") ?? ANY} onValueChange={(v) => set("difficulty", v)}>
        <SelectTrigger className="h-9 w-auto min-w-32" aria-label="Difficulty">
          <SelectValue placeholder="Difficulty" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ANY}>Any difficulty</SelectItem>
          <SelectItem value="easy">Easy</SelectItem>
          <SelectItem value="medium">Medium</SelectItem>
          <SelectItem value="hard">Hard</SelectItem>
        </SelectContent>
      </Select>
      {hasFilters && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            const next = new URLSearchParams();
            for (const k of ["session", "exam"]) if (params.get(k)) next.set(k, params.get(k)!);
            startTransition(() => router.replace(`${pathname}?${next.toString()}`, { scroll: false }));
          }}
        >
          <X /> Clear filters
        </Button>
      )}
    </div>
  );
}
