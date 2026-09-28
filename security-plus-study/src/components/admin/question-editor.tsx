"use client";

import { ArrowDown, ArrowUp, Eye, Loader2, Pencil, Plus, Save, Trash2, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";
import { toast } from "sonner";

import { QuestionCard } from "@/components/quiz/question-card";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { saveQuestionAction } from "@/lib/actions/admin";
import { DOMAINS } from "@/lib/config/domains";
import { choiceLetter, selectPrompt } from "@/lib/questions/transform";
import type { QuestionFormInput } from "@/lib/questions/form";
import type { DomainId, QuestionStatus } from "@/lib/types";
import { cn } from "@/lib/utils";
import { QuestionRowActions } from "./question-row-actions";

interface ChoiceDraft {
  key: string;
  id?: string;
  text: string;
  isCorrect: boolean;
  explanation: string;
}

let keySeq = 0;
const newKey = () => `c${++keySeq}`;

function FieldError({ message, id }: { message?: string; id: string }) {
  if (!message) return null;
  return (
    <p id={id} className="text-sm text-danger">
      {message}
    </p>
  );
}

export function QuestionEditor({
  initial,
  topicOptions,
}: {
  initial?: QuestionFormInput & { id: string };
  topicOptions: { id: string; name: string }[];
}) {
  const router = useRouter();
  const uid = useId();
  const [stem, setStem] = useState(initial?.stem ?? "");
  const [choices, setChoices] = useState<ChoiceDraft[]>(
    () =>
      initial?.choices.map((c) => ({ key: newKey(), id: c.id, text: c.text, isCorrect: c.isCorrect, explanation: c.explanation })) ??
      Array.from({ length: 4 }, (_, i) => ({ key: newKey(), text: "", isCorrect: i === 0, explanation: "" })),
  );
  const [domainId, setDomainId] = useState<number>(initial?.domainId ?? 1);
  const [topics, setTopics] = useState<string[]>(initial?.topics ?? []);
  const [topicInput, setTopicInput] = useState("");
  const [difficulty, setDifficulty] = useState(initial?.difficulty ?? "medium");
  const [explanation, setExplanation] = useState(initial?.explanation ?? "");
  const [examClue, setExamClue] = useState(initial?.examClue ?? "");
  const [memoryTip, setMemoryTip] = useState(initial?.memoryTip ?? "");
  const [isScenario, setIsScenario] = useState(initial?.isScenario ?? false);
  const [status, setStatus] = useState<QuestionStatus>(initial?.status ?? "published");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [preview, setPreview] = useState(false);
  const [pending, startTransition] = useTransition();

  const correctCount = choices.filter((c) => c.isCorrect).length;
  const errorFor = (path: string) => errors[path];
  const choiceError = (i: number) => errors[`choices.${i}`];

  const updateChoice = (key: string, patch: Partial<ChoiceDraft>) => setChoices((prev) => prev.map((c) => (c.key === key ? { ...c, ...patch } : c)));
  const moveChoice = (index: number, delta: number) =>
    setChoices((prev) => {
      const next = [...prev];
      const [item] = next.splice(index, 1);
      next.splice(index + delta, 0, item);
      return next;
    });

  const addTopic = (raw: string) => {
    const label = raw.trim();
    if (!label) return;
    const match = topicOptions.find((t) => t.name.toLowerCase() === label.toLowerCase() || t.id === label.toLowerCase());
    const value = match?.name ?? label;
    setTopics((prev) => (prev.some((t) => t.toLowerCase() === value.toLowerCase()) ? prev : [...prev, value]));
    setTopicInput("");
  };

  const save = () => {
    const form: QuestionFormInput = {
      id: initial?.id,
      stem,
      choices: choices.map((c) => ({ id: c.id, text: c.text, isCorrect: c.isCorrect, explanation: c.explanation })),
      domainId,
      topics,
      difficulty,
      explanation,
      examClue,
      memoryTip,
      isScenario,
      status,
    };
    startTransition(async () => {
      const result = await saveQuestionAction(form);
      if (!result.ok) {
        const map: Record<string, string> = {};
        for (const issue of result.issues ?? []) map[issue.path === "question" ? "stem" : issue.path] ??= issue.message;
        setErrors(map);
        toast.error(result.error);
        return;
      }
      setErrors({});
      toast.success(initial ? "Question saved" : "Question created");
      if (initial) router.refresh();
      else router.push(`/admin/questions/${result.id}`);
    });
  };

  const previewQuestion = {
    id: initial?.id ?? "preview",
    stem: stem || "Your question text will appear here.",
    choices: choices.map((c, i) => ({ id: c.key, text: c.text || `Choice ${choiceLetter(i)}` })),
    domainId: domainId as DomainId,
    topics: [],
    difficulty: difficulty as "easy" | "medium" | "hard",
    questionType: correctCount > 1 ? ("multiple" as const) : ("single" as const),
    selectCount: Math.max(1, correctCount),
    isScenario,
  };

  return (
    <div className="grid gap-6 xl:grid-cols-[1fr_20rem]">
      <div className="min-w-0 space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Question</CardTitle>
            <CardAction>
              <Button variant="ghost" size="sm" onClick={() => setPreview((v) => !v)} aria-pressed={preview}>
                {preview ? <Pencil /> : <Eye />} {preview ? "Edit" : "Preview"}
              </Button>
            </CardAction>
          </CardHeader>
          <CardContent className="space-y-5">
            {preview ? (
              <QuestionCard question={previewQuestion} selected={choices.filter((c) => c.isCorrect).map((c) => c.key)} onToggle={() => {}} />
            ) : (
              <>
                <div className="space-y-2">
                  <Label htmlFor={`${uid}-stem`}>Question text</Label>
                  <Textarea
                    id={`${uid}-stem`}
                    value={stem}
                    onChange={(e) => setStem(e.target.value)}
                    rows={4}
                    maxLength={2000}
                    placeholder="A security analyst notices… Which of the following BEST…?"
                    aria-invalid={Boolean(errorFor("stem")) || undefined}
                    aria-describedby={`${uid}-stem-err`}
                  />
                  <FieldError id={`${uid}-stem-err`} message={errorFor("stem")} />
                </div>

                <fieldset className="space-y-3">
                  <div className="flex items-center justify-between">
                    <legend className="text-sm font-medium">Answers</legend>
                    <span className="text-xs text-muted-foreground">
                      Check every correct answer · {correctCount > 1 ? `Multiple response (${selectPrompt(correctCount)})` : "Single answer"}
                    </span>
                  </div>
                  {choices.map((c, i) => (
                    <div key={c.key} className={cn("rounded-2xl border p-3", c.isCorrect && "border-success/50 bg-success-soft/50")}>
                      <div className="flex items-start gap-3">
                        <span className="mt-2 grid size-7 shrink-0 place-items-center rounded-lg bg-secondary text-sm font-semibold">{choiceLetter(i)}</span>
                        <div className="min-w-0 flex-1 space-y-2">
                          <Input
                            value={c.text}
                            onChange={(e) => updateChoice(c.key, { text: e.target.value })}
                            placeholder={`Answer ${choiceLetter(i)}`}
                            maxLength={600}
                            aria-label={`Answer ${choiceLetter(i)} text`}
                            aria-invalid={Boolean(choiceError(i)) || undefined}
                          />
                          <Textarea
                            value={c.explanation}
                            onChange={(e) => updateChoice(c.key, { explanation: e.target.value })}
                            rows={2}
                            className="min-h-0 text-sm"
                            placeholder={c.isCorrect ? "Optional: why this answer is correct" : "Why this answer is wrong"}
                            aria-label={`Answer ${choiceLetter(i)} explanation`}
                          />
                          {choiceError(i) && <p className="text-sm text-danger">{choiceError(i)}</p>}
                        </div>
                        <div className="flex flex-col items-center gap-1">
                          <label className="flex items-center gap-1.5 text-xs font-medium">
                            <Checkbox checked={c.isCorrect} onCheckedChange={(v) => updateChoice(c.key, { isCorrect: v === true })} />
                            Correct
                          </label>
                          <div className="flex">
                            <Button variant="ghost" size="icon-sm" onClick={() => moveChoice(i, -1)} disabled={i === 0} aria-label="Move up">
                              <ArrowUp />
                            </Button>
                            <Button variant="ghost" size="icon-sm" onClick={() => moveChoice(i, 1)} disabled={i === choices.length - 1} aria-label="Move down">
                              <ArrowDown />
                            </Button>
                          </div>
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            onClick={() => setChoices((prev) => prev.filter((x) => x.key !== c.key))}
                            disabled={choices.length <= 2}
                            aria-label={`Remove answer ${choiceLetter(i)}`}
                          >
                            <Trash2 />
                          </Button>
                        </div>
                      </div>
                    </div>
                  ))}
                  <FieldError id={`${uid}-choices-err`} message={errorFor("correctAnswers") ?? errorFor("choices")} />
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setChoices((prev) => [...prev, { key: newKey(), text: "", isCorrect: false, explanation: "" }])}
                    disabled={choices.length >= 8}
                  >
                    <Plus /> Add answer
                  </Button>
                </fieldset>
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Explanation & study aids</CardTitle>
            <CardDescription>Explain the concept being tested and why the correct answer wins.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor={`${uid}-explanation`}>Explanation</Label>
              <Textarea
                id={`${uid}-explanation`}
                value={explanation}
                onChange={(e) => setExplanation(e.target.value)}
                rows={5}
                maxLength={5000}
                aria-invalid={Boolean(errorFor("explanation")) || undefined}
              />
              <FieldError id={`${uid}-explanation-err`} message={errorFor("explanation")} />
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor={`${uid}-clue`}>Exam clue</Label>
                <Textarea
                  id={`${uid}-clue`}
                  value={examClue}
                  onChange={(e) => setExamClue(e.target.value)}
                  rows={3}
                  maxLength={600}
                  placeholder="If the question emphasizes…, think…"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor={`${uid}-tip`}>Memory tip</Label>
                <Textarea
                  id={`${uid}-tip`}
                  value={memoryTip}
                  onChange={(e) => setMemoryTip(e.target.value)}
                  rows={3}
                  maxLength={600}
                  placeholder="Hashing = integrity. Encryption = confidentiality."
                />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <aside className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Classification</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor={`${uid}-domain`}>Domain</Label>
              <Select value={String(domainId)} onValueChange={(v) => setDomainId(Number(v))}>
                <SelectTrigger id={`${uid}-domain`}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DOMAINS.map((d) => (
                    <SelectItem key={d.id} value={String(d.id)}>
                      {d.code} {d.shortName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor={`${uid}-topics`}>Topics</Label>
              <div className="flex flex-wrap gap-1.5">
                {topics.map((t) => (
                  <span key={t} className="inline-flex items-center gap-1 rounded-full bg-secondary py-0.5 pr-1 pl-2.5 text-xs">
                    {t}
                    <button type="button" onClick={() => setTopics((prev) => prev.filter((x) => x !== t))} aria-label={`Remove ${t}`} className="rounded-full p-0.5 hover:bg-background">
                      <X className="size-3" />
                    </button>
                  </span>
                ))}
              </div>
              <Input
                id={`${uid}-topics`}
                list={`${uid}-topic-list`}
                value={topicInput}
                onChange={(e) => setTopicInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === ",") {
                    e.preventDefault();
                    addTopic(topicInput);
                  }
                }}
                onBlur={() => addTopic(topicInput)}
                placeholder="Type a topic, press Enter"
                aria-invalid={Boolean(errorFor("topics")) || undefined}
              />
              <datalist id={`${uid}-topic-list`}>
                {topicOptions.map((t) => (
                  <option key={t.id} value={t.name} />
                ))}
              </datalist>
              <FieldError id={`${uid}-topics-err`} message={errorFor("topics")} />
            </div>
            <div className="space-y-2">
              <Label htmlFor={`${uid}-difficulty`}>Difficulty</Label>
              <Select value={difficulty} onValueChange={setDifficulty}>
                <SelectTrigger id={`${uid}-difficulty`}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="easy">Easy</SelectItem>
                  <SelectItem value="medium">Medium</SelectItem>
                  <SelectItem value="hard">Hard</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <p className="text-sm font-medium">Question type</p>
              <p className="rounded-lg bg-secondary px-3 py-2 text-sm">
                {correctCount > 1 ? `Multiple response · ${selectPrompt(correctCount)}` : "Single answer"}
              </p>
              <p className="text-xs text-muted-foreground">Set automatically from the number of correct answers.</p>
            </div>
            <div className="flex items-center justify-between gap-3">
              <div>
                <Label htmlFor={`${uid}-scenario`}>Scenario-based</Label>
                <p className="text-xs text-muted-foreground">Weighted up in Hard Mode.</p>
              </div>
              <Switch id={`${uid}-scenario`} checked={isScenario} onCheckedChange={setIsScenario} />
            </div>
            <div className="space-y-2">
              <Label htmlFor={`${uid}-status`}>Status</Label>
              <Select value={status} onValueChange={(v) => setStatus(v as QuestionStatus)}>
                <SelectTrigger id={`${uid}-status`}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="published">Published (visible to learners)</SelectItem>
                  <SelectItem value="draft">Draft (admins only)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>
        <div className="sticky top-24 flex gap-2">
          <Button onClick={save} disabled={pending} className="flex-1" size="lg">
            {pending ? <Loader2 className="animate-spin" aria-hidden /> : <Save />}
            {initial ? "Save changes" : "Create question"}
          </Button>
          {initial && <QuestionRowActions id={initial.id} afterDelete="/admin" />}
        </div>
      </aside>
    </div>
  );
}
