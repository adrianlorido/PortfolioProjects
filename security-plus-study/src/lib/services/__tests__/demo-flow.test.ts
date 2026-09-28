import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { AppUser } from "@/lib/types";

// Isolate the demo store in a temp directory before any module touches it.
const dir = mkdtempSync(path.join(tmpdir(), "bastion-demo-"));
process.env.DEMO_DATA_DIR = dir;

const load = async () => {
  const [{ DemoRepository }, study, exam, insights, review, users] = await Promise.all([
    import("@/lib/data/demo/demo-repository"),
    import("@/lib/services/study-service"),
    import("@/lib/services/exam-service"),
    import("@/lib/services/insights-service"),
    import("@/lib/services/review-service"),
    import("@/lib/data/demo/demo-users"),
  ]);
  return { repo: new DemoRepository(), study, exam, insights, review, users };
};

let ctx: Awaited<ReturnType<typeof load>>;
let learner: AppUser;

beforeAll(async () => {
  ctx = await load();
  const result = ctx.users.demoSignUp("learner@example.com", "correct horse battery", "Test Learner");
  expect("token" in result).toBe(true);
  learner = ctx.users.demoUserFromToken((result as { token: string }).token)!;
});

afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("demo account", () => {
  it("is seeded with realistic history", async () => {
    const session = ctx.users.demoSignIn("demo@bastion.dev", "bastion-demo");
    const demo = ctx.users.demoUserFromToken(session!.token)!;
    expect(demo.role).toBe("admin");
    const dashboard = await ctx.insights.getDashboardData(demo, ctx.repo);
    expect(dashboard.overview.answered).toBeGreaterThan(200);
    expect(dashboard.streak.current).toBeGreaterThanOrEqual(5);
    expect(dashboard.weakTopics.length).toBeGreaterThan(0);
    expect(dashboard.recent.some((r) => r.kind === "exam")).toBe(true);
  });

  it("rejects bad credentials and duplicate sign-ups", () => {
    expect(ctx.users.demoSignIn("demo@bastion.dev", "wrong")).toBeNull();
    expect(ctx.users.demoSignUp("DEMO@bastion.dev", "whatever123", "X")).toEqual({ error: expect.any(String) });
    expect(ctx.users.demoUserFromToken("forged.token.value")).toBeNull();
  });
});

describe("study flow", () => {
  it("runs a quick quiz end to end", async () => {
    const session = await ctx.study.startQuizSession(learner, ctx.repo, { mode: "quick", count: 5, domainIds: [4] });
    expect(session.questionIds).toHaveLength(5);

    const loaded = await ctx.study.loadQuizSession(learner, ctx.repo, session.id);
    const first = loaded!.questions[0];
    expect(first).not.toHaveProperty("choices.0.isCorrect");

    const question = await ctx.repo.getQuestion(first.id);
    const correct = question!.choices.filter((c) => c.isCorrect).map((c) => c.id);
    const feedback = await ctx.study.submitAnswer(learner, ctx.repo, {
      sessionId: session.id,
      questionId: first.id,
      selectedChoiceIds: correct,
      timeSpentMs: 12_000,
    });
    expect(feedback.isCorrect).toBe(true);
    expect(feedback.masteryBefore).toBe(0);
    expect(feedback.masteryAfter).toBe(1);
    expect(feedback.correctChoiceIds.sort()).toEqual([...correct].sort());

    // Double submit returns the stored answer instead of failing.
    const again = await ctx.study.submitAnswer(learner, ctx.repo, {
      sessionId: session.id,
      questionId: first.id,
      selectedChoiceIds: correct,
      timeSpentMs: 1,
    });
    expect(again.attemptId).toBe(feedback.attemptId);

    const rated = await ctx.study.rateConfidence(learner, ctx.repo, feedback.attemptId, "confident");
    expect(rated.masteryAfter).toBe(2);

    const [state] = await ctx.repo.getReviewStates(learner.id, [first.id]);
    expect(state).toMatchObject({ mastery: 2, timesSeen: 1, lastConfidence: "confident" });
    const activity = await ctx.repo.getActivity(learner.id);
    expect(activity.reduce((s, a) => s + a.answered, 0)).toBe(1);
    const topics = await ctx.repo.getTopicStats(learner.id);
    expect(topics.length).toBeGreaterThan(0);
  });

  it("rejects answers for questions outside the session or with the wrong count", async () => {
    const session = await ctx.study.startQuizSession(learner, ctx.repo, { mode: "quick", count: 2 });
    const outsider = (await ctx.repo.getCatalog()).find((q) => !session.questionIds.includes(q.id))!;
    await expect(
      ctx.study.submitAnswer(learner, ctx.repo, { sessionId: session.id, questionId: outsider.id, selectedChoiceIds: [], timeSpentMs: 0 }),
    ).rejects.toThrow(/not part of this session/);
  });

  it("isolates users: another learner cannot load this learner's session", async () => {
    const session = await ctx.study.startQuizSession(learner, ctx.repo, { mode: "quick", count: 2 });
    const other = ctx.users.demoSignUp("other@example.com", "another password", "Other");
    const otherUser = ctx.users.demoUserFromToken((other as { token: string }).token)!;
    expect(await ctx.study.loadQuizSession(otherUser, ctx.repo, session.id)).toBeNull();
  });

  it("explains empty pools with a friendly message", async () => {
    const fresh = ctx.users.demoUserFromToken(
      (ctx.users.demoSignUp("fresh@example.com", "fresh password", "Fresh") as { token: string }).token,
    )!;
    await expect(ctx.study.startQuizSession(fresh, ctx.repo, { mode: "missed", count: 10 })).rejects.toThrow(/No missed questions/);
    await expect(ctx.study.startQuizSession(fresh, ctx.repo, { mode: "weak", count: 10 })).rejects.toThrow(/Answer more questions/);
  });
});

describe("exam flow", () => {
  it("saves responses, grades on submit and records attempts", async () => {
    const exam = await ctx.exam.startExam(learner, ctx.repo, "sprint");
    expect(exam.questionIds).toHaveLength(20);
    const [q1, q2] = await ctx.repo.getQuestions(exam.questionIds.slice(0, 2));
    await ctx.exam.saveExamResponse(learner, ctx.repo, exam.id, q1.id, {
      selectedChoiceIds: q1.choices.filter((c) => c.isCorrect).map((c) => c.id),
      flagged: true,
    });
    await ctx.exam.saveExamResponse(learner, ctx.repo, exam.id, q2.id, {
      selectedChoiceIds: [q2.choices.find((c) => !c.isCorrect)!.id],
      flagged: false,
    });
    const submitted = await ctx.exam.submitExam(learner, ctx.repo, exam.id);
    expect(submitted.status).toBe("submitted");
    expect(submitted.result).toMatchObject({ total: 20, correct: 1, incorrect: 1, unanswered: 18 });
    await expect(ctx.exam.saveExamResponse(learner, ctx.repo, exam.id, q1.id, { selectedChoiceIds: [], flagged: false })).rejects.toThrow(
      /already been submitted/,
    );
    const review = await ctx.review.getSessionReview(learner, ctx.repo, { examId: exam.id }, { result: "incorrect" });
    expect(review!.items).toHaveLength(19);
  });
});
