import {
  ArrowRight,
  Brain,
  CalendarClock,
  ChartColumn,
  Check,
  CircleCheck,
  Crosshair,
  Lightbulb,
  ListChecks,
  Timer,
} from "lucide-react";
import Link from "next/link";

import { Brand } from "@/components/brand";
import { DomainDot } from "@/components/common/domain-badge";
import { ThemeToggle } from "@/components/layout/theme-toggle";
import { Button } from "@/components/ui/button";
import { DOMAINS } from "@/lib/config/domains";
import { EXAM_CONFIG } from "@/lib/config/exam";

const FEATURES = [
  {
    icon: ListChecks,
    title: "Practice questions",
    body: "Original SY0-701 questions: terminology, concepts, and scenario-based 'BEST answer' items, including multiple-response.",
  },
  {
    icon: Crosshair,
    title: "Weak area detection",
    body: "Topic-level accuracy weighted toward your recent answers pinpoints exactly where your score is leaking.",
  },
  {
    icon: Brain,
    title: "Detailed explanations",
    body: "Why the right answer is right, why every distractor is wrong, an exam clue, and a one-line memory aid.",
  },
  {
    icon: Timer,
    title: "Exam simulation",
    body: `Timed ${EXAM_CONFIG.presets[0].questionCount}-question exams with flagging, navigation, and a domain-by-domain score report.`,
  },
  {
    icon: ChartColumn,
    title: "Progress tracking",
    body: "Accuracy trends, study streaks, mastery by topic, and a readiness estimate built from the exam blueprint.",
  },
  {
    icon: CalendarClock,
    title: "Spaced repetition",
    body: "Missed and guessed questions come back at the right moment; mastered ones step aside so you study smarter.",
  },
];

const STEPS = [
  { title: "Answer", body: "Work through short, focused sessions. Rate your confidence after each answer." },
  { title: "Understand", body: "Read the explanation, the exam clue, and the memory aid while it matters most." },
  { title: "Repeat smarter", body: "Bastion schedules reviews and targets weak topics automatically." },
];

function ProductPreview() {
  const choices = [
    { letter: "A", text: "RADIUS", state: "neutral" },
    { letter: "B", text: "TACACS+", state: "correct" },
    { letter: "C", text: "LDAP", state: "neutral" },
    { letter: "D", text: "Kerberos", state: "neutral" },
  ] as const;
  return (
    <div className="relative mx-auto w-full max-w-lg" aria-label="Example practice question" role="img">
      <div aria-hidden className="brand-gradient absolute -inset-6 rounded-[2rem] opacity-25 blur-3xl" />
      <div aria-hidden className="relative rounded-3xl border bg-card p-5 shadow-2xl shadow-primary/10 sm:p-6">
        <div className="mb-4 flex items-center justify-between text-xs text-muted-foreground">
          <span className="font-medium text-foreground">Question 7 of 20</span>
          <span className="rounded-md bg-secondary px-2 py-0.5">4.0 Operations</span>
        </div>
        <div className="mb-4 flex gap-1">
          {Array.from({ length: 12 }, (_, i) => (
            <span key={i} className={`h-1.5 flex-1 rounded-full ${i < 6 ? (i === 3 ? "bg-danger" : "bg-success") : i === 6 ? "bg-primary" : "bg-primary/15"}`} />
          ))}
        </div>
        <p className="text-[15px] leading-relaxed font-medium">
          A network team must authorize and log every command administrators run on routers, with the full session payload encrypted. Which
          protocol BEST fits?
        </p>
        <div className="mt-4 space-y-2">
          {choices.map((c) => (
            <div
              key={c.letter}
              className={`flex items-center gap-3 rounded-xl border-2 px-3 py-2.5 text-sm ${c.state === "correct" ? "border-success bg-success-soft" : "opacity-60"}`}
            >
              <span
                className={`grid size-6 place-items-center rounded-full text-xs font-semibold ${c.state === "correct" ? "bg-success text-success-foreground" : "bg-secondary"}`}
              >
                {c.state === "correct" ? <Check className="size-3.5" strokeWidth={3} /> : c.letter}
              </span>
              {c.text}
            </div>
          ))}
        </div>
        <div className="mt-4 rounded-xl border border-warning/40 bg-warning-soft p-3 text-sm">
          <p className="flex items-center gap-1.5 font-semibold">
            <Lightbulb className="size-4" /> Exam Clue
          </p>
          <p className="mt-1 text-foreground/80">Device administration + command authorization + full encryption = TACACS+.</p>
        </div>
      </div>
    </div>
  );
}

export default function LandingPage() {
  return (
    <div className="min-h-dvh overflow-x-hidden">
      <header className="sticky top-0 z-40 border-b border-transparent bg-background/70 backdrop-blur-lg">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
          <Brand />
          <nav className="flex items-center gap-1 sm:gap-2" aria-label="Site">
            <a href="#features" className="hidden rounded-lg px-3 py-2 text-sm text-muted-foreground hover:text-foreground md:block">
              Features
            </a>
            <a href="#how" className="hidden rounded-lg px-3 py-2 text-sm text-muted-foreground hover:text-foreground md:block">
              How it works
            </a>
            <ThemeToggle persist={false} />
            <Button variant="ghost" asChild>
              <Link href="/login">Sign in</Link>
            </Button>
            <Button asChild className="hidden sm:inline-flex">
              <Link href="/signup">Start studying</Link>
            </Button>
          </nav>
        </div>
      </header>

      <main>
        <section className="relative">
          <div aria-hidden className="bg-grid absolute inset-0 [mask-image:radial-gradient(ellipse_at_top,black,transparent_65%)]" />
          <div className="relative mx-auto grid max-w-6xl items-center gap-12 px-4 pt-12 pb-20 sm:px-6 md:pt-20 lg:grid-cols-[1.1fr_1fr]">
            <div>
              <p className="inline-flex items-center gap-2 rounded-full border bg-card px-3 py-1 text-xs font-medium text-muted-foreground">
                <span className="size-1.5 rounded-full bg-success" aria-hidden /> Built for CompTIA Security+ SY0-701
              </p>
              <h1 className="mt-5 text-4xl leading-[1.05] font-semibold tracking-tight text-balance sm:text-5xl lg:text-6xl">
                Master Security+ <span className="brand-text">one question at a time</span>
              </h1>
              <p className="mt-5 max-w-xl text-lg text-muted-foreground">
                Practice smarter, identify your weak areas, and focus your study where it matters.
              </p>
              <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                <Button size="lg" variant="brand" asChild>
                  <Link href="/signup">
                    Start studying <ArrowRight />
                  </Link>
                </Button>
                <Button size="lg" variant="outline" asChild>
                  <Link href="/login">Sign in</Link>
                </Button>
              </div>
              <ul className="mt-8 flex flex-wrap gap-x-6 gap-y-2 text-sm text-muted-foreground">
                {["All 5 domains", "Scenario questions", "Works on mobile"].map((t) => (
                  <li key={t} className="flex items-center gap-1.5">
                    <CircleCheck className="size-4 text-success" aria-hidden /> {t}
                  </li>
                ))}
              </ul>
            </div>
            <ProductPreview />
          </div>
        </section>

        <section id="features" className="border-t bg-card/40 py-20">
          <div className="mx-auto max-w-6xl px-4 sm:px-6">
            <div className="max-w-2xl">
              <h2 className="text-3xl font-semibold tracking-tight">Everything you need to pass, nothing you don&apos;t</h2>
              <p className="mt-3 text-muted-foreground">A focused study loop designed around how certification exams actually test you.</p>
            </div>
            <ul className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {FEATURES.map((f) => (
                <li key={f.title} className="rounded-2xl border bg-card p-6 shadow-sm transition-shadow hover:shadow-md">
                  <div className="grid size-11 place-items-center rounded-xl bg-accent text-primary">
                    <f.icon className="size-5" aria-hidden />
                  </div>
                  <h3 className="mt-4 font-semibold">{f.title}</h3>
                  <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{f.body}</p>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section id="how" className="py-20">
          <div className="mx-auto grid max-w-6xl gap-12 px-4 sm:px-6 lg:grid-cols-2">
            <div>
              <h2 className="text-3xl font-semibold tracking-tight">A study loop that compounds</h2>
              <ol className="mt-8 space-y-6">
                {STEPS.map((s, i) => (
                  <li key={s.title} className="flex gap-4">
                    <span className="grid size-9 shrink-0 place-items-center rounded-full brand-gradient text-sm font-semibold text-white">
                      {i + 1}
                    </span>
                    <div>
                      <h3 className="font-semibold">{s.title}</h3>
                      <p className="mt-1 text-sm text-muted-foreground">{s.body}</p>
                    </div>
                  </li>
                ))}
              </ol>
            </div>
            <div className="rounded-3xl border bg-card p-6 shadow-sm">
              <h3 className="font-semibold">Organized around the five SY0-701 domains</h3>
              <ul className="mt-5 space-y-4">
                {DOMAINS.map((d) => (
                  <li key={d.id}>
                    <div className="flex items-center justify-between gap-3 text-sm">
                      <span className="flex items-center gap-2">
                        <DomainDot domainId={d.id} />
                        <span className="text-muted-foreground">{d.code}</span> {d.name}
                      </span>
                      <span className="font-medium tabular-nums">{d.weight}%</span>
                    </div>
                    <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-primary/10">
                      <div className="h-full rounded-full bg-primary" style={{ width: `${(d.weight / 28) * 100}%` }} />
                    </div>
                  </li>
                ))}
              </ul>
              <p className="mt-5 text-xs text-muted-foreground">Approximate exam weighting per the published exam objectives.</p>
            </div>
          </div>
        </section>

        <section className="px-4 pb-20 sm:px-6">
          <div className="relative mx-auto max-w-6xl overflow-hidden rounded-3xl bg-[oklch(0.2_0.05_275)] px-6 py-14 text-center text-white sm:px-12">
            <div aria-hidden className="brand-gradient absolute -top-24 left-1/2 size-80 -translate-x-1/2 rounded-full opacity-40 blur-3xl" />
            <h2 className="relative text-3xl font-semibold tracking-tight text-balance">Your next ten questions could be your breakthrough.</h2>
            <p className="relative mx-auto mt-3 max-w-xl text-white/75">Start free. Your first session takes about five minutes.</p>
            <div className="relative mt-8 flex justify-center gap-3">
              <Button size="lg" variant="brand" asChild>
                <Link href="/signup">
                  Start studying <ArrowRight />
                </Link>
              </Button>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t py-8">
        <div className="mx-auto flex max-w-6xl flex-col gap-3 px-4 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <Brand />
          <p className="max-w-xl text-xs">
            Bastion is an independent study tool with original practice content. It is not affiliated with or endorsed by CompTIA. CompTIA and
            Security+ are trademarks of CompTIA, Inc.
          </p>
        </div>
      </footer>
    </div>
  );
}
