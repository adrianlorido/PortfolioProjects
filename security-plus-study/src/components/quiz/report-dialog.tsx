"use client";

import { Flag, Loader2 } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Textarea } from "@/components/ui/textarea";
import { reportQuestionAction } from "@/lib/actions/library";

const REASONS = [
  { value: "incorrect_answer", label: "The marked answer looks wrong" },
  { value: "unclear", label: "The question is unclear or ambiguous" },
  { value: "typo", label: "Typo or formatting problem" },
  { value: "outdated", label: "Outdated for SY0-701" },
  { value: "other", label: "Something else" },
];

export function ReportDialog({ questionId, trigger }: { questionId: string; trigger?: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("incorrect_answer");
  const [details, setDetails] = useState("");
  const [pending, startTransition] = useTransition();

  const submit = () =>
    startTransition(async () => {
      const result = await reportQuestionAction({ questionId, reason, details });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Thanks! We'll review this question.");
      setOpen(false);
      setDetails("");
    });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button variant="ghost" size="sm" className="text-muted-foreground">
            <Flag /> Report issue
          </Button>
        )}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Report an issue</DialogTitle>
          <DialogDescription>Help keep the question bank accurate. Reports go to the question bank admins.</DialogDescription>
        </DialogHeader>
        <RadioGroup value={reason} onValueChange={setReason} className="gap-2.5">
          {REASONS.map((r) => (
            <div key={r.value} className="flex items-center gap-3">
              <RadioGroupItem value={r.value} id={`reason-${r.value}`} />
              <Label htmlFor={`reason-${r.value}`} className="font-normal">
                {r.label}
              </Label>
            </div>
          ))}
        </RadioGroup>
        <div className="space-y-2">
          <Label htmlFor="report-details">Details (optional)</Label>
          <Textarea
            id="report-details"
            value={details}
            onChange={(e) => setDetails(e.target.value)}
            maxLength={2000}
            placeholder="What should be fixed?"
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={pending}>
            {pending && <Loader2 className="animate-spin" aria-hidden />}
            Send report
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
