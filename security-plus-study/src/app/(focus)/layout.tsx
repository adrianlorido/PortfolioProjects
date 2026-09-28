import { SessionSync } from "@/components/layout/session-sync";
import { requireUser } from "@/lib/auth/session";
import { getRepository } from "@/lib/data";

/** Distraction-free layout for quizzes and exams. */
export default async function FocusLayout({ children }: LayoutProps<"/">) {
  const user = await requireUser();
  const settings = await (await getRepository()).getSettings(user.id);
  return (
    <div className="min-h-dvh bg-background">
      <SessionSync theme={settings.theme} timezone={settings.timezone} />
      {children}
    </div>
  );
}
