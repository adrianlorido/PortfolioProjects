# Bastion — Security+ SY0-701 study platform

Bastion is a full-stack study app for the CompTIA Security+ **SY0-701** exam. Learners answer original practice questions, get detailed explanations, and let the app decide what to study next: weak topics are detected automatically, missed and guessed questions come back on a spaced-repetition schedule, and timed practice exams produce a domain-by-domain report.

> Bastion is an independent study tool with **original** practice content. It is not affiliated with or endorsed by CompTIA. CompTIA and Security+ are trademarks of CompTIA, Inc.

## Features

| Area | What you get |
| --- | --- |
| **Dashboard** | Streak, answered count and accuracy; a "Continue studying" card (recommended session size, weakest domain, reviews due, daily-goal ring); six performance tiles; per-domain accuracy, coverage and mastery; weakest topics with one-click practice; recent sessions and exams. |
| **Study modes** | Quick quiz (5–50 questions; all domains, selected domains, selected topics, weak areas, unanswered, missed, bookmarked; difficulty filter; **Hard Mode**), domain practice, weakest-topics quiz, missed questions (random / oldest / most-missed), bookmarks, spaced review, retry-missed. |
| **Quiz interface** | Large readable question card, single and multiple-response ("Select TWO") items, progress segments, optional timer, instant Correct/Incorrect, correct answer, explanation, *why each wrong option is wrong*, concept tested, **Exam Clue**, **Remember This**, confidence rating, bookmarks, personal notes and issue reports. Full keyboard support. |
| **Exam simulator** | Configurable presets (full 90/90, half, sprint), blueprint-weighted domain mix, server-authoritative timer with auto-submit, flagging, navigator, autosave, no feedback until submit, then a report with estimated scaled score, pass/fail, domain breakdown, weakest topics and retry buttons. |
| **Review** | Every answered question with your answer, the correct answer and the explanation. Filter by incorrect/correct, guessed, bookmarked, domain, topic and difficulty; scope to a single session or exam. |
| **Analytics** | Accuracy over time (7-day and all-time), questions per day vs. goal, accuracy by domain and by difficulty, a 26-week activity calendar, mastery distribution, exam history and a sortable topic table. Every chart has a table view. |
| **Spaced repetition** | Five mastery levels (New → Mastered), confidence-aware scheduling, configurable intervals. |
| **Search** | Full-text search across question text, explanations, answers, topics and acronyms (e.g. "PKI", "OCSP"). |
| **Admin** | Question bank with search and filters, editor with live preview, duplicate/delete, JSON import with validation and error reporting, learner issue reports. |
| **Accounts** | Supabase Auth (sign up, sign in, sign out, password reset) with row-level security, or a zero-config **demo mode**. |
| **Settings** | Theme, daily goal, default quiz size and difficulty, explanation timing, confidence ratings, timer, profile, reset progress. |

The bundled bank contains **159 original questions** across all five domains (terminology, conceptual and scenario items; "BEST", "MOST likely" and "FIRST" questions; multiple-response items), each with per-option explanations, an exam clue and a memory tip.

## Tech stack

- **Next.js 16** (App Router, Server Components, Server Actions, `proxy.ts`), **React 19**, **TypeScript**
- **Tailwind CSS 4** + **shadcn/ui** components (Radix primitives) + **Lucide** icons
- **Supabase** (PostgreSQL, Auth, Row Level Security) via `@supabase/ssr`
- **Recharts** for charts, **Zod** for input validation, **Vitest** for tests

## Quick start (demo mode, no setup)

```bash
cd security-plus-study
npm install
npm run dev
```

Open http://localhost:3000, click **Sign in → Continue with demo account**. The demo account (`demo@bastion.dev` / `bastion-demo`) has about four weeks of generated study history and admin access, so every screen has data. You can also sign up for fresh local accounts.

Demo data lives in `./.demo-data/store.json` (git-ignored). Reset it any time with `npm run demo:reset`.

## Prerequisites

- Node.js **20.12+** (22 LTS recommended) and npm
- For production: a Supabase project (free tier works)
- Optional: the [Supabase CLI](https://supabase.com/docs/guides/cli) for local Supabase, and `psql` for running the database tests

## Installation

```bash
git clone <your fork>
cd security-plus-study
npm install
cp .env.example .env.local   # then fill in the values below
```

## Environment variables

| Variable | Required | Purpose |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | for Supabase | Project URL (Settings → API). |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` *or* `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | for Supabase | Public client key. Safe to expose; RLS protects the data. |
| `NEXT_PUBLIC_SITE_URL` | recommended | Public app URL used in auth emails (e.g. `https://bastion.example.com`). |
| `SUPABASE_SERVICE_ROLE_KEY` | CLI import only | Used **only** by `npm run questions:import`. The web app never reads it. Never prefix with `NEXT_PUBLIC_`. |
| `DEMO_AUTH_SECRET` | optional | Signs demo session cookies (auto-generated if empty). |
| `DEMO_DATA_DIR` | optional | Demo store location (default `./.demo-data`). |

If both Supabase variables are set the app uses Supabase; otherwise it runs in demo mode. Nothing else changes.

## Supabase configuration

1. **Create a project** at https://supabase.com and copy the URL and anon/publishable key into `.env.local`.
2. **Create the schema.** In the dashboard SQL editor, run `supabase/migrations/20260928000000_initial_schema.sql`. (Or, with the CLI: `supabase link --project-ref <ref>` then `supabase db push`.)
3. **Load the question bank.** Run `supabase/seed.sql` in the SQL editor (it is idempotent, so re-running updates questions in place). Alternatively use the JSON import described below.
4. **Configure Auth** (Authentication → URL Configuration):
   - Site URL: your app URL (e.g. `http://localhost:3000`)
   - Redirect URLs: add `http://localhost:3000/auth/callback` and your production equivalent.
   - Email confirmation can stay on; new users are asked to confirm before signing in.
5. **Make yourself an admin** after signing up once:
   ```sql
   update public.profiles set role = 'admin' where email = 'you@example.com';
   ```
   Admins see **Question Bank** in the navigation. The `role` column cannot be changed by users themselves (column-level grants).

### Local Supabase (optional)

```bash
supabase start          # uses supabase/config.toml, applies migrations and seed.sql
supabase status         # copy the API URL and anon key into .env.local
```

## Database setup and schema

`supabase/migrations/20260928000000_initial_schema.sql` creates:

| Table | Purpose |
| --- | --- |
| `profiles`, `user_settings` | One row per auth user (created by trigger). Role, display name, study preferences, timezone. |
| `domains`, `topics` | The five SY0-701 domains and a topic taxonomy (with search keywords). |
| `questions`, `question_choices`, `question_topics` | The bank. Choices carry `is_correct` and a per-option explanation; topics are many-to-many. `questions.search_vector` is a generated full-text column. |
| `quiz_sessions` | Study sessions with the ordered question list and running counters. |
| `exam_sessions`, `exam_responses` | Practice exams, autosaved answers/flags, and the final result JSON. |
| `attempts` | Every graded answer (selected choices, correctness, confidence, time, pre-attempt review state). |
| `review_schedule` | Per-user, per-question mastery and next review date (spaced repetition). |
| `topic_mastery` | Per-user topic counters and recency-weighted accuracy (weak-topic detection). |
| `study_activity` | Per-user daily totals in the learner's timezone (streaks, charts). |
| `bookmarks`, `question_notes`, `question_reports` | Saved questions, personal notes, issue reports. |

Plus a `question_catalog` view (security invoker) and these functions: `record_attempts`, `finalize_exam`, `update_attempt_confidence`, `upsert_questions`, `search_questions`, `list_review_items`, `bank_stats`, `find_existing_stems`, `reset_my_progress`, `is_admin`.

**Security model**

- RLS is enabled on every table. User-owned rows are restricted to `user_id = auth.uid()`; `user_id` defaults to `auth.uid()` so the browser never supplies it.
- Attempts can only reference the caller's own sessions; exam responses lock once an exam is submitted.
- The question bank is readable by signed-in users (drafts: admins only) and writable only by admins.
- Multi-table writes run in `SECURITY INVOKER` functions, so they are atomic **and** still subject to RLS.
- Every Server Action re-verifies the session (`getClaims()` JWT verification) and validates input with Zod.

## Running locally

```bash
npm run dev            # http://localhost:3000
npm test               # unit + integration tests (Vitest)
npm run lint           # ESLint
npm run typecheck      # TypeScript
npm run test:db        # schema, RLS and repository contract tests (needs psql; see Testing)
```

## Building for production

```bash
npm run build
npm start
```

Deploys cleanly to Vercel or any Node host. Set the environment variables in your host. Demo mode also works in production but stores data on the server's filesystem; on read-only or serverless hosts set `DEMO_DATA_DIR=/tmp/bastion` (data is then ephemeral) or configure Supabase.

## Adding questions

There are three ways, all using the same validator (`src/lib/questions/import-schema.ts`):

1. **Admin editor** — *Question Bank → New question*. Choice IDs are preserved on edit so learner history stays intact.
2. **JSON import in the app** — *Question Bank → Import*. Paste or upload a file, click **Validate** to see every error and warning by row and field, then import. Rows with errors can be skipped.
3. **CLI bulk import** (great for hundreds of externally generated questions):
   ```bash
   npm run questions:validate -- path/to/questions.json     # dry run, exits non-zero on errors
   npm run questions:import -- path/to/questions.json       # needs SUPABASE_SERVICE_ROLE_KEY
   ```

To grow the bundled bank, add JSON files to `data/questions/`, run `npm run questions:validate`, then `npm run db:seed-sql` to regenerate `supabase/seed.sql`. Demo mode picks up edits to the bundled bank automatically.

### Question JSON format

A file is either an array of questions or `{ "indexBase": 0 | 1, "questions": [ ... ] }`.

```json
{
  "question": "A SOC analyst needs to correlate firewall, VPN and domain controller logs to detect a brute-force attack. Which tool BEST supports this?",
  "choices": ["SIEM", "Vulnerability scanner", "Protocol analyzer", "Hardware security module"],
  "correctAnswers": [0],
  "domain": "Security Operations",
  "topics": ["SIEM", "Logging & Monitoring"],
  "difficulty": "medium",
  "explanation": "A SIEM aggregates logs from many sources and correlates related events.",
  "incorrectAnswerExplanations": [null, "Scanners find vulnerabilities.", "Captures packets on one segment.", "Stores cryptographic keys."],
  "examClue": "Correlate events from many log sources = SIEM.",
  "memoryTip": "SIEM connects the dots."
}
```

| Field | Rules |
| --- | --- |
| `question` | Required, ≤ 2,000 chars. |
| `choices` | 2–8 unique strings (or `{ "text", "explanation", "correct" }` objects). |
| `correctAnswers` | 0-based indexes by default (1-based with `"indexBase": 1`) or letters (`"B"`). Two or more makes it a multiple-response question ("Select TWO"). |
| `domain` | `1`–`5`, `"4.0"`, or the domain name (short forms like "Security Operations" work). |
| `topics` | 1–10 names. Known topics are normalized (e.g. "TACACS+" → `tacacs`); new ones are created. |
| `difficulty` | `easy`, `medium` or `hard`. |
| `explanation` | Required. |
| Optional | `id` (UUID — re-importing the same id updates in place), `incorrectAnswerExplanations` (array aligned with choices or `{ "A": "...", "2": "..." }`), `examClue`, `memoryTip`, `scenario` (inferred if omitted), `status` (`published`/`draft`), `questionType`/`numberOfCorrectAnswers` (checked for consistency). |

A template is served at `/question-import-example.json`.

## Application architecture

```
src/
  app/                      Routes (App Router)
    page.tsx                Landing page
    (auth)/                 login, signup, forgot-password, reset-password
    (app)/                  Authenticated shell: dashboard, study, exam, review, bookmarks,
                            analytics, search, questions/[id], settings, admin/*
    (focus)/                Distraction-free quiz and exam runners
    auth/callback, auth/expired   Route handlers
  proxy.ts                  Session refresh + optimistic route guarding (Next 16 "proxy")
  components/               UI only: ui/ (shadcn), layout/, quiz/, exam/, dashboard/, analytics/, admin/ …
  hooks/use-hotkeys.ts      Keyboard shortcuts that pause while typing
  lib/
    types.ts                Domain model
    config/                 domains, topics, exam presets, study settings  ← tune rules here
    engine/                 Pure logic: grading, scoring, spaced repetition, quiz & exam builders
    analytics/              Pure logic: streaks, weak topics, performance stats, dates
    questions/              Import validation, editor validation, seed builder, transforms
    data/
      repository.ts         Storage contract
      demo/                 File-backed demo adapter (+ generated study history)
      supabase/             Supabase adapter + row mappers
    auth/session.ts         Current user (verified), requireUser/requireAdmin
    services/               Use cases that combine engines + repository
    actions/                Server Actions: auth, study, exam, library, settings, admin
data/questions/             Bundled question bank (import format)
supabase/                   Migration, generated seed, CLI config, local SQL tests
scripts/                    Validate/import questions, generate seed SQL, DB tests
```

**Request flow.** Pages are Server Components that call `requireUser()`, then a service (e.g. `getDashboardData`) which reads through the `Repository`. Mutations go through Server Actions, which re-verify the user, validate input with Zod, and call a service. Engines are pure functions with no I/O, which keeps them easy to test and swap.

**Answers never reach the browser early.** Quiz and exam pages receive `QuizQuestion` objects (text and choice ids only). Correctness, explanations and clues are returned by `submitAnswerAction` after grading on the server, or after an exam is submitted.

**Spaced repetition** (`src/lib/engine/spaced-repetition.ts`, configurable via `DEFAULT_SR_CONFIG`):

| Outcome | Mastery change | Next review |
| --- | --- | --- |
| Incorrect | −2 (minimum Learning) | 10 minutes |
| Incorrect + confident | reset to Learning | immediately (misconception) |
| Correct + guessed | no promotion (Strong/Mastered drop one level) | 1 day |
| Correct + unsure | +1, capped at Strong | level interval |
| Correct (no rating) | +1 | level interval |
| Correct + confident | +1 (New jumps to Familiar) | level interval |

Level intervals: Learning 1 day, Familiar 4 days, Strong 8 days, Mastered 21 days, then ×2 (×2.5 when confident) per repeat, capped at 120 days. Confidence can be given after grading; the schedule is recomputed from the pre-attempt state stored on the attempt.

**Weak-topic detection** blends smoothed overall accuracy with a recency-weighted accuracy (EWMA), so improving on a topic moves it off the list. The weakest-topics quiz prioritizes (1) low topic accuracy, (2) repeated misses and (3) questions not seen recently.

**Exam scoring.** Questions are allocated across domains by blueprint weight (largest-remainder method), unanswered questions count as incorrect, multiple-response items are all-or-nothing, and the scaled score is a linear estimate on the configured 100–900 scale (real exam scaling is not public). Everything lives in `src/lib/config/exam.ts`.

**Demo adapter.** `DemoRepository` implements the same contract as `SupabaseRepository` using an in-memory store persisted to JSON. Switching to Supabase requires only environment variables.

## Testing

- `npm test` — 90+ Vitest tests: grading and multiple-answer scoring, exam scoring and blueprint allocation, quiz generation for every mode (including Hard Mode and weak-topic prioritization), spaced repetition and mastery, streaks and analytics, import validation, the bundled bank's integrity, and an end-to-end service flow on the demo adapter (user isolation, double-submit, confidence re-scheduling, exam submission).
- `npm run test:db` — applies the migration and seed to a throwaway database on any PostgreSQL 15+ server (a small stub stands in for Supabase's `auth` schema), asserts RLS isolation between users, admin-only writes, role-escalation prevention and every RPC, then runs a **contract test** that drives the real `SupabaseRepository` against those SQL functions. Uses standard `PGHOST`/`PGPORT`/`PGUSER`/`PGPASSWORD` variables.

### Continuous integration

`.github/workflows/security-plus-study.yml` (at the repository root) runs on changes under `security-plus-study/`:

- **checks** — lint, typecheck (`next typegen` + `tsc`), Vitest, question-bank validation, a check that `supabase/seed.sql` was regenerated after bank edits, and a production build in demo mode.
- **database** — `npm run test:db` against a PostgreSQL 16 service container.

## Keyboard shortcuts

| Key | Quiz | Exam |
| --- | --- | --- |
| `1`–`9` | Select answer | Select answer |
| `Enter` | Submit / next question | Next question |
| `B` | Bookmark | — |
| `E` | Toggle explanation | — |
| `G` / `U` / `C` | Confidence: guessed / unsure / confident | — |
| `F` / `N` | — | Flag / open navigator |
| `←` / `→` | Previous / next | Previous / next |
| `?` | Shortcut help | Shortcut help |
| `/` | Focus search (app pages) | |

Shortcuts are ignored while typing in notes or any text field, and while a dialog is open.

## Accessibility

Semantic landmarks and headings, a skip link, labelled controls, `radio`/`checkbox` roles on answer options, live regions for results and timers, visible focus rings, reduced-motion support, and correct/incorrect states that always pair color with an icon and text. Charts use a colorblind-validated palette and each has a table view.

## Known limitations

- Answer keys are readable by any signed-in user through the Supabase API (RLS allows reading published questions). The app itself never sends answers to the browser before grading, but a determined user could query them directly. For stricter protection, revoke column privileges on `question_choices.is_correct`/`explanation` and move grading into a `SECURITY DEFINER` function.
- The scaled exam score is a linear estimate, not CompTIA's scoring algorithm.
- Demo mode stores data on the server's filesystem and is intended for local evaluation, not multi-instance production.
- The question bank read path loads catalog metadata per request; for very large banks (tens of thousands of questions) consider caching `question_catalog` or moving quiz selection into SQL.
- No offline mode or native mobile app (the web app is responsive and works well on phones).
