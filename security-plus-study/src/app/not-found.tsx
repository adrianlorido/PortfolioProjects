import { Compass } from "lucide-react";
import Link from "next/link";

import { Brand } from "@/components/brand";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-6 px-4 text-center">
      <Brand />
      <div className="grid size-14 place-items-center rounded-2xl bg-accent text-primary">
        <Compass className="size-7" aria-hidden />
      </div>
      <div>
        <h1 className="text-2xl font-semibold">Page not found</h1>
        <p className="mt-2 max-w-sm text-muted-foreground">That page doesn&apos;t exist, or it may belong to another account.</p>
      </div>
      <Button asChild>
        <Link href="/dashboard">Back to dashboard</Link>
      </Button>
    </div>
  );
}
