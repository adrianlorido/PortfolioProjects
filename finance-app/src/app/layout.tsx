import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Nav } from "@/components/layout/nav";
import { SampleBanner } from "@/components/layout/sample-banner";
import { getDataSourceInfo } from "@/db";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Personal Finance", template: "%s · Personal Finance" },
  description: "Personal finance dashboard",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  const dataSource = getDataSourceInfo();
  return (
    <html lang="en">
      <body className="min-h-screen">
        {dataSource.mode === "sample" ? <SampleBanner asOf={dataSource.asOf} /> : null}
        <div className="mx-auto flex max-w-[1400px]">
          <aside className="sticky top-0 hidden h-screen w-56 shrink-0 flex-col border-r border-border px-3 py-5 md:flex">
            <Brand />
            <div className="mt-6">
              <Nav orientation="vertical" />
            </div>
            <p className="mt-auto px-3 text-[11px] leading-4 text-muted">Phase 1 · offline sample mode. No bank connections.</p>
          </aside>
          <div className="min-w-0 flex-1">
            <header className="border-b border-border px-4 py-3 md:hidden">
              <Brand />
              <div className="mt-3">
                <Nav orientation="horizontal" />
              </div>
            </header>
            <main className="px-4 py-6 md:px-8 md:py-8">{children}</main>
          </div>
        </div>
      </body>
    </html>
  );
}

function Brand() {
  return (
    <div className="flex items-center gap-2 px-3">
      <span aria-hidden className="grid size-7 place-items-center rounded-lg bg-accent text-sm font-bold text-surface">$</span>
      <span className="text-base font-semibold tracking-tight">Personal Finance</span>
    </div>
  );
}
