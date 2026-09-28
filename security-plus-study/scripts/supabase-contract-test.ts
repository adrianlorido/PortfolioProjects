/**
 * Contract test: runs the real SupabaseRepository's RPC-backed methods against
 * PostgreSQL (with the local auth stub), acting as a signed-in user under RLS.
 * A tiny psql-backed stand-in for supabase-js `rpc()` replaces PostgREST, so
 * this verifies that TypeScript payloads match the SQL function signatures.
 *
 * Run via `npm run test:db` (expects a database already migrated + seeded;
 * DB name in CONTRACT_DB).
 */
import { execFileSync } from "node:child_process";
import assert from "node:assert/strict";

import type { SupabaseClient } from "@supabase/supabase-js";

import { SupabaseRepository } from "../src/lib/data/supabase/supabase-repository";
import { scheduleReview } from "../src/lib/engine/spaced-repetition";
import { scoreExam } from "../src/lib/engine/scoring";
import { validateQuestion } from "../src/lib/questions/import-schema";
import type { AttemptWrite } from "../src/lib/types";

const DB = process.env.CONTRACT_DB;
if (!DB) throw new Error("CONTRACT_DB is required");

function psql(sql: string, sub?: string): string {
  const prelude = sub ? `set role authenticated; set request.jwt.claim.sub to '${sub}';` : "";
  return execFileSync("psql", ["-X", "-A", "-t", "-q", "-v", "ON_ERROR_STOP=1", "-v", "VERBOSITY=verbose", "-d", DB!, "-c", `${prelude} ${sql}`], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function literal(value: unknown): string {
  if (value === null || value === undefined) return "null";
  const text = Array.isArray(value) && value.every((v) => typeof v === "string") ? `{${value.map((v) => `"${String(v).replace(/"/g, '\\"')}"`).join(",")}}` : typeof value === "object" ? JSON.stringify(value) : String(value);
  return `'${text.replace(/'/g, "''")}'`;
}

/** Minimal supabase-js stand-in: only `rpc` is implemented. */
function fakeClient(sub: string): SupabaseClient {
  return {
    async rpc(fn: string, params: Record<string, unknown> = {}) {
      const meta = psql(`select proretset::text || ',' || format_type(prorettype, null) from pg_proc where proname = '${fn}' and pronamespace = 'public'::regnamespace`);
      const [retset, rettype] = meta.split(",");
      const args = Object.entries(params)
        .map(([k, v]) => `${k} => ${literal(v)}`)
        .join(", ");
      const call = `public.${fn}(${args})`;
      const sql =
        rettype === "void"
          ? `select 'null' from ${call}`
          : retset === "true"
            ? `select coalesce(jsonb_agg(to_jsonb(r)), '[]'::jsonb) from ${call} r`
            : `select to_jsonb(r) from ${call} r`;
      try {
        return { data: JSON.parse(psql(sql, sub) || "null"), error: null };
      } catch (e) {
        const stderr = String((e as { stderr?: string }).stderr ?? e);
        const code = /ERROR:\s+([0-9A-Z]{5}):/.exec(stderr)?.[1] ?? "XX000";
        return { data: null, error: { message: stderr.split("\n")[0], code, details: "", hint: "" } };
      }
    },
    from() {
      throw new Error("from() is not supported by the contract-test client");
    },
  } as unknown as SupabaseClient;
}

const ADMIN = "33333333-3333-4333-8333-333333333333";
const LEARNER = "44444444-4444-4444-8444-444444444444";
psql(`insert into auth.users (id, email) values ('${ADMIN}', 'admin@contract.test'), ('${LEARNER}', 'learner@contract.test') on conflict do nothing`);
psql(`update public.profiles set role = 'admin' where id = '${ADMIN}'`);

async function main() {
  const admin = new SupabaseRepository(fakeClient(ADMIN));
  const learner = new SupabaseRepository(fakeClient(LEARNER));

  // saveQuestions -> upsert_questions (payload from the shared import validator)
  const { input } = validateQuestion(
    {
      question: "Contract test: which TWO controls reduce credential stuffing risk?",
      choices: ["Multifactor authentication", "Breached-password screening", "Longer screen lock timeout", "Disk encryption"],
      correctAnswers: [0, 1],
      domain: "Security Operations",
      topics: ["Authentication", "Brand New Contract Topic"],
      difficulty: "hard",
      explanation: "MFA blocks reuse of stolen passwords and screening rejects known-breached ones.",
      examClue: "Stolen but valid passwords need a second factor.",
      memoryTip: "Leaked password + MFA = useless password.",
    },
    0,
  );
  assert.ok(input, "question validates");
  const [questionId] = await admin.saveQuestions([input!], ADMIN);
  assert.match(questionId, /^[0-9a-f-]{36}$/);
  assert.equal(psql(`select question_type || ':' || correct_count from public.questions where id = '${questionId}'`), "multiple:2");
  await assert.rejects(learner.saveQuestions([input!], LEARNER), /permission|admin/i, "students cannot write the bank");

  // getBankStats -> bank_stats
  const stats = await learner.getBankStats();
  assert.ok(stats.total >= 160 && stats.byDomain[4] > 0 && stats.byTopic["brand-new-contract-topic"] === 1, "bank stats map");

  // findExistingStems -> find_existing_stems (case/punctuation-insensitive)
  const found = await learner.findExistingStems(["CONTRACT TEST: which two controls reduce credential stuffing risk", "nope"]);
  assert.equal(found.length, 1);

  // recordAttempts -> record_attempts (state payload computed by the real scheduler)
  const correctChoices = psql(`select string_agg(id::text, ',' order by position) from public.question_choices where question_id = '${questionId}' and is_correct`).split(",");
  const now = new Date();
  const stateAfter = scheduleReview(null, questionId, { correct: true, confidence: null }, now);
  const write: AttemptWrite = {
    questionId,
    quizSessionId: null,
    examSessionId: null,
    selectedChoiceIds: correctChoices,
    isCorrect: true,
    confidence: null,
    timeSpentMs: 15_000,
    answeredAt: now.toISOString(),
    activityDate: now.toISOString().slice(0, 10),
    stateBefore: null,
    stateAfter,
  };
  const [attempt] = await learner.recordAttempts(LEARNER, [write]);
  assert.equal(attempt.userId, LEARNER);
  assert.deepEqual([...attempt.selectedChoiceIds].sort(), [...correctChoices].sort());
  assert.equal(psql(`select mastery || ':' || interval_days::int || ':' || (last_attempt_id = '${attempt.id}') from public.review_schedule where user_id = '${LEARNER}' and question_id = '${questionId}'`), "1:1:true");
  assert.equal(psql(`select count(*) from public.topic_mastery where user_id = '${LEARNER}'`), "2");

  // applyConfidence -> update_attempt_confidence
  const rescheduled = scheduleReview(null, questionId, { correct: true, confidence: "confident" }, now);
  await learner.applyConfidence(LEARNER, attempt.id, "confident", rescheduled);
  assert.equal(psql(`select mastery || ':' || last_confidence from public.review_schedule where user_id = '${LEARNER}' and question_id = '${questionId}'`), "2:confident");

  // finalizeExam -> finalize_exam
  const examId = psql(
    `insert into public.exam_sessions (preset_id, title, question_ids, time_limit_seconds, expires_at) values ('sprint', 'Contract exam', array['${questionId}']::uuid[], 60, now() + interval '1 minute') returning id`,
    LEARNER,
  );
  const question = { id: questionId, choices: correctChoices.map((id) => ({ id, isCorrect: true, text: "", explanation: null })), domainId: 4 as const, topics: ["authentication"] };
  const result = scoreExam([{ ...question, stem: "", difficulty: "hard", questionType: "multiple", correctCount: 2, explanation: "", examClue: "", memoryTip: "", isScenario: false, status: "published", createdAt: "", updatedAt: "" }], { [questionId]: { selectedChoiceIds: correctChoices, flagged: false } }, 30);
  const examWrite = { ...write, answeredAt: new Date().toISOString(), stateBefore: { ...stateAfter, lastAttemptId: attempt.id }, stateAfter: scheduleReview({ ...stateAfter, lastAttemptId: attempt.id }, questionId, { correct: true, confidence: null }, new Date()) };
  await assert.rejects(learner.finalizeExam(LEARNER, examId, result, [examWrite]), /from\(\)/, "finalize then reloads via from()");
  assert.equal(psql(`select status || ':' || (result->>'correct') from public.exam_sessions where id = '${examId}'`), "submitted:1");
  assert.equal(psql(`select count(*) from public.attempts where exam_session_id = '${examId}'`), "1");

  // resetProgress -> reset_my_progress (only the caller's rows)
  await learner.resetProgress(LEARNER);
  assert.equal(psql(`select count(*) from public.attempts where user_id = '${LEARNER}'`), "0");

  console.log("SUPABASE CONTRACT TESTS PASSED");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
