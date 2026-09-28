"use client";

import { Bookmark, BookmarkCheck } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { setBookmarkAction } from "@/lib/actions/library";

export function BookmarkButton({
  questionId,
  initial,
  refreshOnChange = false,
  size = "sm",
  labels = { on: "Bookmarked", off: "Bookmark" },
}: {
  questionId: string;
  initial: boolean;
  refreshOnChange?: boolean;
  size?: "sm" | "default";
  labels?: { on: string; off: string };
}) {
  const [on, setOn] = useState(initial);
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const toggle = () =>
    startTransition(async () => {
      const next = !on;
      setOn(next);
      const result = await setBookmarkAction(questionId, next);
      if (!result.ok) {
        setOn(!next);
        toast.error(result.error);
        return;
      }
      if (refreshOnChange) router.refresh();
    });
  return (
    <Button variant="outline" size={size} onClick={toggle} disabled={pending} aria-pressed={on}>
      {on ? <BookmarkCheck className="text-primary" /> : <Bookmark />}
      {on ? labels.on : labels.off}
    </Button>
  );
}
