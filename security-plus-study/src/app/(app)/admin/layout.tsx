import { AdminTabs } from "@/components/admin/admin-tabs";
import { PageHeader } from "@/components/common/page-header";
import { requireAdmin } from "@/lib/auth/session";
import { getRepository } from "@/lib/data";

export default async function AdminLayout({ children }: LayoutProps<"/admin">) {
  await requireAdmin();
  const reports = await (await getRepository()).listReports("open");
  return (
    <div>
      <PageHeader title="Question bank" description="Create, edit and import questions. Changes are visible to learners immediately when published." />
      <AdminTabs openReports={reports.length} />
      {children}
    </div>
  );
}
