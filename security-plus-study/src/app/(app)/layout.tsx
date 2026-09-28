import { AppShell } from "@/components/layout/app-shell";
import { requireUser } from "@/lib/auth/session";
import { getRepository } from "@/lib/data";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const user = await requireUser();
  const repo = await getRepository();
  const settings = await repo.getSettings(user.id);
  return (
    <AppShell user={user} settings={settings} isDemo={repo.kind === "demo"}>
      {children}
    </AppShell>
  );
}
