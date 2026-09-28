"use client";

import { Search } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";

import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DOMAINS } from "@/lib/config/domains";
import { cn } from "@/lib/utils";

const ANY = "__any";

export function BankFilters({ topics }: { topics: { id: string; name: string }[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();
  const set = (key: string, value: string | null) => {
    const next = new URLSearchParams(params.toString());
    if (!value || value === ANY) next.delete(key);
    else next.set(key, value);
    next.delete("page");
    startTransition(() => router.replace(`${pathname}?${next.toString()}`, { scroll: false }));
  };
  return (
    <div className={cn("flex flex-wrap gap-2", pending && "opacity-60")}>
      <form
        role="search"
        className="relative min-w-56 flex-1"
        onSubmit={(e) => {
          e.preventDefault();
          set("q", String(new FormData(e.currentTarget).get("q") ?? "").trim());
        }}
      >
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <Input name="q" defaultValue={params.get("q") ?? ""} placeholder="Search questions…" className="pl-9" aria-label="Search questions" />
      </form>
      <Select value={params.get("domain") ?? ANY} onValueChange={(v) => set("domain", v)}>
        <SelectTrigger className="w-auto min-w-36" aria-label="Domain">
          <SelectValue />
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
        <SelectTrigger className="w-auto min-w-36" aria-label="Topic">
          <SelectValue />
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
        <SelectTrigger className="w-auto min-w-32" aria-label="Difficulty">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ANY}>Any difficulty</SelectItem>
          <SelectItem value="easy">Easy</SelectItem>
          <SelectItem value="medium">Medium</SelectItem>
          <SelectItem value="hard">Hard</SelectItem>
        </SelectContent>
      </Select>
      <Select value={params.get("status") ?? ANY} onValueChange={(v) => set("status", v)}>
        <SelectTrigger className="w-auto min-w-32" aria-label="Status">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ANY}>Any status</SelectItem>
          <SelectItem value="published">Published</SelectItem>
          <SelectItem value="draft">Draft</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}
