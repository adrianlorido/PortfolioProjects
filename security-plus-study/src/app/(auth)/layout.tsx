import { CircleCheck } from "lucide-react";

import { Brand } from "@/components/brand";
import { ThemeToggle } from "@/components/layout/theme-toggle";

const POINTS = [
  "Original SY0-701 practice questions with full explanations",
  "Spaced repetition that brings weak questions back at the right time",
  "Timed exam simulations with a domain-by-domain report",
];

export default function AuthLayout({ children }: LayoutProps<"/">) {
  return (
    <div className="grid min-h-dvh lg:grid-cols-2">
      <aside className="relative hidden overflow-hidden bg-[oklch(0.18_0.04_275)] p-10 text-white lg:flex lg:flex-col">
        <div aria-hidden className="bg-grid absolute inset-0 opacity-40 [mask-image:radial-gradient(ellipse_at_center,black,transparent_75%)]" />
        <div aria-hidden className="brand-gradient absolute -bottom-32 -left-32 size-96 rounded-full opacity-40 blur-3xl" />
        <div className="relative [&_span]:text-white">
          <Brand />
        </div>
        <div className="relative mt-auto max-w-md">
          <p className="text-3xl leading-tight font-semibold tracking-tight">Pass Security+ with a study plan that adapts to you.</p>
          <ul className="mt-8 space-y-3">
            {POINTS.map((p) => (
              <li key={p} className="flex gap-3 text-white/80">
                <CircleCheck className="mt-0.5 size-5 shrink-0 text-[oklch(0.8_0.12_205)]" aria-hidden />
                {p}
              </li>
            ))}
          </ul>
        </div>
      </aside>
      <div className="flex flex-col">
        <div className="flex items-center justify-between p-4 sm:p-6">
          <div className="lg:invisible">
            <Brand />
          </div>
          <ThemeToggle persist={false} />
        </div>
        <main className="flex flex-1 items-center justify-center px-4 pb-16 sm:px-6">
          <div className="w-full max-w-sm">{children}</div>
        </main>
      </div>
    </div>
  );
}
