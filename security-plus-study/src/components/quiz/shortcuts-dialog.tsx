"use client";

import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

function Row({ keys, label }: { keys: string[]; label: string }) {
  return (
    <div className="flex items-center justify-between gap-4 py-2">
      <span className="text-sm">{label}</span>
      <span className="flex gap-1">
        {keys.map((k) => (
          <kbd key={k} className="min-w-7 rounded-md border bg-muted px-2 py-0.5 text-center font-mono text-xs">
            {k}
          </kbd>
        ))}
      </span>
    </div>
  );
}

export function ShortcutsDialog({
  open,
  onOpenChange,
  confidenceEnabled = true,
  mode = "quiz",
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  confidenceEnabled?: boolean;
  mode?: "quiz" | "exam";
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Keyboard shortcuts</DialogTitle>
          <DialogDescription>Shortcuts are paused while you type in a note or text field.</DialogDescription>
        </DialogHeader>
        <div className="divide-y">
          <Row keys={["1", "2", "3", "4"]} label="Select answer A, B, C, D" />
          {mode === "quiz" ? (
            <>
              <Row keys={["Enter"]} label="Submit answer / next question" />
              <Row keys={["B"]} label="Bookmark question" />
              <Row keys={["E"]} label="Show or hide explanation" />
              {confidenceEnabled && <Row keys={["G", "U", "C"]} label="Rate confidence: guessed, unsure, confident" />}
            </>
          ) : (
            <>
              <Row keys={["F"]} label="Flag question for review" />
              <Row keys={["N"]} label="Open question navigator" />
            </>
          )}
          <Row keys={["←", "→"]} label="Previous / next question" />
          <Row keys={["?"]} label="Show this help" />
        </div>
      </DialogContent>
    </Dialog>
  );
}
