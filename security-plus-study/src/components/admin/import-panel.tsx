"use client";

import { CircleAlert, CircleCheck, FileUp, Loader2, TriangleAlert, Upload } from "lucide-react";
import Link from "next/link";
import { useRef, useState, useTransition } from "react";
import { toast } from "sonner";

import { DomainBadge } from "@/components/common/domain-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { importQuestionsAction, validateImportAction, type ImportPreview } from "@/lib/actions/admin";
import type { DomainId } from "@/lib/types";
import { cn } from "@/lib/utils";

const MAX_BYTES = 5_000_000;

export function ImportPanel() {
  const [json, setJson] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [skipInvalid, setSkipInvalid] = useState(false);
  const [imported, setImported] = useState<number | null>(null);
  const [validating, startValidate] = useTransition();
  const [importing, startImport] = useTransition();
  const fileRef = useRef<HTMLInputElement>(null);

  const reset = (text: string) => {
    setJson(text);
    setPreview(null);
    setImported(null);
  };

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    if (file.size > MAX_BYTES) return void toast.error("File is too large (5 MB max).");
    setFileName(file.name);
    reset(await file.text());
  };

  const validate = () =>
    startValidate(async () => {
      const result = await validateImportAction(json);
      if (!result.ok) return void toast.error(result.error);
      setPreview(result.data);
    });

  const runImport = () =>
    startImport(async () => {
      const result = await importQuestionsAction(json, { skipInvalid });
      if (!result.ok) return void toast.error(result.error);
      setImported(result.data.imported);
      toast.success(`Imported ${result.data.imported} question${result.data.imported === 1 ? "" : "s"}`);
    });

  const canImport = preview && !preview.fileError && preview.validCount > 0 && (preview.errorCount === 0 || skipInvalid);

  return (
    <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1fr_22rem]">
      <div className="min-w-0 space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>1. Add your JSON</CardTitle>
            <CardDescription>Upload a .json file or paste questions below. Up to 2,000 questions (5 MB) per import.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div
              className="flex flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed p-6 text-center"
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                void onFile(e.dataTransfer.files[0]);
              }}
            >
              <Upload className="size-6 text-muted-foreground" aria-hidden />
              <p className="text-sm text-muted-foreground">{fileName ? `Loaded ${fileName}` : "Drag a JSON file here, or"}</p>
              <input ref={fileRef} type="file" accept="application/json,.json" className="sr-only" onChange={(e) => void onFile(e.target.files?.[0])} aria-label="Choose JSON file" />
              <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()}>
                <FileUp /> Choose file
              </Button>
            </div>
            <Label htmlFor="import-json" className="sr-only">
              Question JSON
            </Label>
            <Textarea
              id="import-json"
              value={json}
              onChange={(e) => reset(e.target.value)}
              rows={12}
              spellCheck={false}
              placeholder='[{ "question": "…", "choices": ["…", "…"], "correctAnswers": [0], "domain": "Security Operations", "topics": ["SIEM"], "difficulty": "medium", "explanation": "…" }]'
              className="font-mono text-xs"
            />
            <div className="flex flex-wrap gap-2">
              <Button onClick={validate} disabled={!json.trim() || validating}>
                {validating && <Loader2 className="animate-spin" aria-hidden />} Validate
              </Button>
              <Button
                variant="ghost"
                onClick={async () => {
                  const res = await fetch("/question-import-example.json");
                  setFileName("question-import-example.json");
                  reset(await res.text());
                }}
              >
                Load example
              </Button>
            </div>
          </CardContent>
        </Card>

        {preview && (
          <Card className="animate-rise">
            <CardHeader>
              <CardTitle>2. Review</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {preview.fileError ? (
                <p className="flex items-center gap-2 rounded-xl bg-danger-soft px-4 py-3 text-sm text-danger" role="alert">
                  <CircleAlert className="size-4" aria-hidden /> {preview.fileError}
                </p>
              ) : (
                <>
                  <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                    {[
                      { label: "Questions", value: preview.total },
                      { label: "Valid", value: preview.validCount, tone: "success" },
                      { label: "Errors", value: preview.errorCount, tone: preview.errorCount ? "danger" : undefined },
                      { label: "Warnings", value: preview.warningCount, tone: preview.warningCount ? "warning" : undefined },
                    ].map((s) => (
                      <div
                        key={s.label}
                        className={cn(
                          "rounded-xl border p-3",
                          s.tone === "success" && "border-success/40 bg-success-soft",
                          s.tone === "danger" && "border-danger/40 bg-danger-soft",
                          s.tone === "warning" && "border-warning/50 bg-warning-soft",
                        )}
                      >
                        <dt className="text-xs text-muted-foreground">{s.label}</dt>
                        <dd className="text-2xl font-semibold">{s.value}</dd>
                      </div>
                    ))}
                  </dl>

                  {preview.issues.length > 0 && (
                    <div className="max-h-80 overflow-auto rounded-xl border">
                      <Table>
                        <TableHeader>
                          <TableRow className="hover:bg-transparent">
                            <TableHead>Row</TableHead>
                            <TableHead>Field</TableHead>
                            <TableHead className="w-full">Problem</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {preview.issues.map((issue, i) => (
                            <TableRow key={i}>
                              <TableCell>#{issue.index + 1}</TableCell>
                              <TableCell className="font-mono text-xs">{issue.path}</TableCell>
                              <TableCell className="whitespace-normal">
                                <span className={cn("inline-flex items-center gap-1.5", issue.severity === "error" ? "text-danger" : "text-foreground")}>
                                  {issue.severity === "error" ? (
                                    <CircleAlert className="size-4 shrink-0" aria-label="Error" />
                                  ) : (
                                    <TriangleAlert className="size-4 shrink-0 text-warning" aria-label="Warning" />
                                  )}
                                  {issue.message}
                                </span>
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  )}

                  {preview.preview.length > 0 && (
                    <div>
                      <p className="mb-2 text-sm font-medium">Preview of valid questions</p>
                      <ul className="divide-y rounded-xl border">
                        {preview.preview.map((q) => (
                          <li key={q.index} className="flex flex-col gap-1.5 p-3 text-sm sm:flex-row sm:items-center sm:gap-3">
                            <span className="text-muted-foreground tabular-nums">#{q.index + 1}</span>
                            <span className="line-clamp-2 flex-1">{q.stem}</span>
                            <span className="flex shrink-0 flex-wrap items-center gap-1.5">
                              <DomainBadge domainId={q.domainId as DomainId} />
                              <span className="rounded-md border px-1.5 py-0.5 text-xs capitalize">{q.difficulty}</span>
                              {q.correctCount > 1 && <span className="rounded-md bg-warning-soft px-1.5 py-0.5 text-xs">Select {q.correctCount}</span>}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {imported !== null ? (
                    <div className="flex items-center justify-between gap-3 rounded-xl bg-success-soft px-4 py-3">
                      <span className="flex items-center gap-2 text-sm font-medium text-success">
                        <CircleCheck className="size-4" aria-hidden /> Imported {imported} questions.
                      </span>
                      <Button size="sm" variant="outline" asChild>
                        <Link href="/admin">View question bank</Link>
                      </Button>
                    </div>
                  ) : (
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                      {preview.errorCount > 0 && (
                        <label className="flex items-center gap-2 text-sm">
                          <Checkbox checked={skipInvalid} onCheckedChange={(v) => setSkipInvalid(v === true)} />
                          Skip the rows with errors and import only valid questions
                        </label>
                      )}
                      <Button onClick={runImport} disabled={!canImport || importing} className="sm:ml-auto">
                        {importing && <Loader2 className="animate-spin" aria-hidden />}
                        Import {preview.validCount} question{preview.validCount === 1 ? "" : "s"}
                      </Button>
                    </div>
                  )}
                </>
              )}
            </CardContent>
          </Card>
        )}
      </div>

      <Card className="h-fit">
        <CardHeader>
          <CardTitle>Format</CardTitle>
          <CardDescription>
            An array of questions, or <code className="font-mono text-xs">{"{ \"indexBase\": 0|1, \"questions\": [...] }"}</code>.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <ul className="space-y-2 text-muted-foreground">
            <li>
              <code className="font-mono text-xs text-foreground">correctAnswers</code>: 0-based indexes (or 1-based with{" "}
              <code className="font-mono text-xs">indexBase: 1</code>), or letters like <code className="font-mono text-xs">&quot;B&quot;</code>. Two
              or more makes it a multiple-response question.
            </li>
            <li>
              <code className="font-mono text-xs text-foreground">domain</code>: 1–5, &quot;4.0&quot;, or the domain name.
            </li>
            <li>
              <code className="font-mono text-xs text-foreground">topics</code>: names; unknown topics are created automatically.
            </li>
            <li>
              <code className="font-mono text-xs text-foreground">difficulty</code>: easy, medium or hard.
            </li>
            <li>
              Optional: <code className="font-mono text-xs text-foreground">id</code> (UUID, makes re-imports update in place),{" "}
              <code className="font-mono text-xs">incorrectAnswerExplanations</code>, <code className="font-mono text-xs">examClue</code>,{" "}
              <code className="font-mono text-xs">memoryTip</code>, <code className="font-mono text-xs">scenario</code>,{" "}
              <code className="font-mono text-xs">status</code>.
            </li>
          </ul>
          <Button variant="outline" size="sm" asChild className="w-full">
            <a href="/question-import-example.json" download>
              Download template
            </a>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
