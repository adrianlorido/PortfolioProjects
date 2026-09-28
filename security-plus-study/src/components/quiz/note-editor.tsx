"use client";

import { Check, Loader2, NotebookPen } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { saveNoteAction } from "@/lib/actions/library";
import { callAction } from "@/lib/call-action";

export function NoteEditor({
  questionId,
  initialNote,
  onSaved,
  defaultOpen,
}: {
  questionId: string;
  initialNote: string | null;
  onSaved?: (body: string | null) => void;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(Boolean(defaultOpen || initialNote));
  const [value, setValue] = useState(initialNote ?? "");
  const [saved, setSaved] = useState(initialNote ?? "");
  const [pending, startTransition] = useTransition();
  const dirty = value.trim() !== saved.trim();

  const save = () =>
    startTransition(async () => {
      const result = await callAction(saveNoteAction(questionId, value));
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setSaved(result.data.body ?? "");
      setValue(result.data.body ?? "");
      onSaved?.(result.data.body);
    });

  if (!open) {
    return (
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)} className="text-muted-foreground">
        <NotebookPen /> Add a personal note
      </Button>
    );
  }

  return (
    <div className="rounded-2xl border bg-card p-4">
      <label htmlFor={`note-${questionId}`} className="mb-2 flex items-center gap-2 text-sm font-medium">
        <NotebookPen className="size-4 text-muted-foreground" aria-hidden /> My note
      </label>
      <Textarea
        id={`note-${questionId}`}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        maxLength={4000}
        placeholder="e.g. Remember: OCSP checks certificate revocation status in real time."
        className="min-h-20 resize-y"
      />
      <div className="mt-2 flex items-center justify-end gap-2">
        {!dirty && saved && (
          <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
            <Check className="size-3.5" aria-hidden /> Saved
          </span>
        )}
        <Button size="sm" onClick={save} disabled={!dirty || pending}>
          {pending && <Loader2 className="animate-spin" aria-hidden />}
          {value.trim() || !saved ? "Save note" : "Delete note"}
        </Button>
      </div>
    </div>
  );
}
