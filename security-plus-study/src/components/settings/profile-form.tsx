"use client";

import { Loader2 } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { updateDisplayNameAction } from "@/lib/actions/settings";
import { callAction } from "@/lib/call-action";

export function ProfileForm({ displayName, email }: { displayName: string; email: string }) {
  const [name, setName] = useState(displayName);
  const [saved, setSaved] = useState(displayName);
  const [pending, startTransition] = useTransition();
  return (
    <form
      className="grid gap-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end"
      onSubmit={(e) => {
        e.preventDefault();
        startTransition(async () => {
          const result = await callAction(updateDisplayNameAction(name));
          if (!result.ok) return void toast.error(result.error);
          setSaved(result.data.displayName);
          toast.success("Profile updated");
        });
      }}
    >
      <div className="space-y-2">
        <Label htmlFor="display-name">Display name</Label>
        <Input id="display-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} required />
      </div>
      <div className="space-y-2">
        <Label htmlFor="email">Email</Label>
        <Input id="email" value={email} readOnly disabled />
      </div>
      <Button type="submit" disabled={pending || name.trim() === saved || !name.trim()}>
        {pending && <Loader2 className="animate-spin" aria-hidden />}
        Update
      </Button>
    </form>
  );
}
