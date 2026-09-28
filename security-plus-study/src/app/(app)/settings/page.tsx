import type { Metadata } from "next";

import { PageHeader } from "@/components/common/page-header";
import { ProfileForm } from "@/components/settings/profile-form";
import { ResetProgress } from "@/components/settings/reset-progress";
import { SettingsForm } from "@/components/settings/settings-form";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireUser } from "@/lib/auth/session";
import { getRepository } from "@/lib/data";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage() {
  const user = await requireUser();
  const repo = await getRepository();
  const settings = await repo.getSettings(user.id);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader title="Settings" description="Tune your study experience. Preferences are saved to your account." />

      <Card>
        <CardHeader>
          <CardTitle>Study preferences</CardTitle>
        </CardHeader>
        <CardContent>
          <SettingsForm initial={settings} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            Profile <Badge variant="secondary" className="capitalize">{user.role}</Badge>
          </CardTitle>
          <CardDescription>
            {repo.kind === "demo"
              ? "Demo mode: your account is stored locally on this server."
              : "Signed in with Supabase Auth. Use “Forgot password” on the sign-in page to change your password."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ProfileForm displayName={user.displayName} email={user.email} />
        </CardContent>
      </Card>

      <Card className="border-destructive/30">
        <CardHeader>
          <CardTitle>Danger zone</CardTitle>
          <CardDescription>Start over with a clean slate. This can&apos;t be undone.</CardDescription>
        </CardHeader>
        <CardContent>
          <ResetProgress />
        </CardContent>
      </Card>
    </div>
  );
}
