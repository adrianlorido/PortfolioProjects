"use client";

import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { updateReportStatusAction } from "@/lib/actions/admin";
import type { ReportStatus } from "@/lib/types";

export function ReportActions({ id, status }: { id: string; status: ReportStatus }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const set = (next: ReportStatus) =>
    startTransition(async () => {
      const result = await updateReportStatusAction(id, next);
      if (!result.ok) return void toast.error(result.error);
      router.refresh();
    });
  return (
    <div className="flex gap-1">
      {pending && <Loader2 className="size-4 animate-spin self-center" aria-hidden />}
      {status === "open" ? (
        <>
          <Button size="sm" variant="outline" onClick={() => set("resolved")} disabled={pending}>
            Resolve
          </Button>
          <Button size="sm" variant="ghost" onClick={() => set("dismissed")} disabled={pending}>
            Dismiss
          </Button>
        </>
      ) : (
        <Button size="sm" variant="ghost" onClick={() => set("open")} disabled={pending}>
          Reopen
        </Button>
      )}
    </div>
  );
}
