"use client";

import { Loader2, TriangleAlert } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { resetProgressAction } from "@/lib/actions/settings";

export function ResetProgress() {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" className="border-destructive/40 text-destructive hover:bg-destructive/10">
          Reset study progress
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <TriangleAlert className="size-5 text-destructive" aria-hidden /> Reset all progress?
          </DialogTitle>
          <DialogDescription>
            This permanently deletes your answers, mastery, review schedule, streaks, sessions and exam history. Bookmarks, notes and settings are
            kept.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="reset-confirm">
            Type <span className="font-mono font-semibold">RESET</span> to confirm
          </Label>
          <Input id="reset-confirm" value={text} onChange={(e) => setText(e.target.value)} autoComplete="off" />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            disabled={text !== "RESET" || pending}
            onClick={() =>
              startTransition(async () => {
                const result = await resetProgressAction(text);
                if (!result.ok) return void toast.error(result.error);
                toast.success("Progress reset. Fresh start!");
                setOpen(false);
                router.push("/dashboard");
              })
            }
          >
            {pending && <Loader2 className="animate-spin" aria-hidden />}
            Reset progress
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
