import type { Metadata } from "next";

import { ImportPanel } from "@/components/admin/import-panel";
import { requireAdmin } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Import questions" };

export default async function ImportPage() {
  await requireAdmin();
  return <ImportPanel />;
}
