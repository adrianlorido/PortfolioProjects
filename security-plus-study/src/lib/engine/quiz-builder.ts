import { MAX_SESSION_QUESTIONS } from "@/lib/config/study";
import { rankTopics } from "@/lib/analytics/weak-topics";
import type { CatalogEntry, QuizConfig, ReviewState, TopicStat } from "@/lib/types";
import { type Rng, shuffle, weightedSample } from "./random";
import { isDue, isInMissedPool, reviewPriority } from "./spaced-repetition";

export interface QuizBuildContext {
  catalog: readonly CatalogEntry[];
  states: ReadonlyMap<string, ReviewState>;
  bookmarks: ReadonlySet<string>;
  topicStats: readonly TopicStat[];
  now: Date;
  rng: Rng;
}

const DAY_MS = 86_400_000;
/** Topics scoring at or above this blended accuracy are not considered weak. */
const STRONG_TOPIC_SCORE = 0.85;

export function filterCatalog(catalog: readonly CatalogEntry[], config: QuizConfig): CatalogEntry[] {
  const domains = config.domainIds?.length ? new Set(config.domainIds) : null;
  const topics = config.topicIds?.length ? new Set(config.topicIds) : null;
  const difficulties = config.difficulties?.length ? new Set(config.difficulties) : null;
  return catalog.filter(
    (q) =>
      (!domains || domains.has(q.domainId)) &&
      (!topics || q.topics.some((t) => topics.has(t))) &&
      (!difficulties || difficulties.has(q.difficulty)),
  );
}

/** Hard Mode strongly favors scenario-based and hard questions. */
export function hardModeWeight(q: CatalogEntry): number {
  const scenario = q.isScenario ? 4 : 1;
  const difficulty = q.difficulty === "hard" ? 3 : q.difficulty === "medium" ? 1.5 : 0.35;
  return scenario * difficulty;
}

/** Default weighting for mixed practice: nudge toward due, unseen and shaky questions. */
function studyWeight(q: CatalogEntry, ctx: QuizBuildContext): number {
  const state = ctx.states.get(q.id);
  if (!state) return 1.5;
  if (isDue(state, ctx.now)) return 2 + (4 - state.mastery) * 0.25;
  return state.mastery >= 4 ? 0.35 : 1 - state.mastery * 0.15;
}

/**
 * Priority for the "weakest topics" mode:
 *   1. topic accuracy (dominant), 2. repeated misses, 3. time since last seen.
 */
export function weakTopicPriority(
  q: CatalogEntry,
  topicWeakness: ReadonlyMap<string, number>,
  state: ReviewState | undefined,
  now: Date,
): number {
  const topicScore = Math.max(0, ...q.topics.map((t) => topicWeakness.get(t) ?? 0));
  const missScore = Math.min(1, (state?.timesIncorrect ?? 0) / 3);
  const daysSince = state ? (now.getTime() - new Date(state.lastAnsweredAt).getTime()) / DAY_MS : Infinity;
  const staleness = Math.min(1, daysSince / 14);
  return 0.55 * topicScore + 0.3 * missScore + 0.15 * staleness;
}

function clampCount(count: number): number {
  return Math.max(1, Math.min(MAX_SESSION_QUESTIONS, Math.floor(count)));
}

/** Build an ordered list of question ids for a study session. Pure and deterministic given an rng. */
export function buildQuiz(config: QuizConfig, ctx: QuizBuildContext): string[] {
  const count = clampCount(config.count);

  if (config.questionIds?.length) {
    const available = new Set(ctx.catalog.map((q) => q.id));
    const ordered = [...new Set(config.questionIds)].filter((id) => available.has(id));
    return ordered.slice(0, count);
  }

  const filtered = filterCatalog(ctx.catalog, config);
  const pool = config.pool ?? "all";
  const weight = (q: CatalogEntry) => (config.hardMode ? hardModeWeight(q) : 1) * studyWeight(q, ctx);

  switch (pool) {
    case "unanswered": {
      const unseen = filtered.filter((q) => !ctx.states.has(q.id));
      return pickWeighted(unseen, config.hardMode ? hardModeWeight : () => 1, count, ctx.rng);
    }
    case "bookmarked": {
      const marked = filtered.filter((q) => ctx.bookmarks.has(q.id));
      return pickWeighted(marked, config.hardMode ? hardModeWeight : () => 1, count, ctx.rng);
    }
    case "due": {
      const due = filtered
        .map((q) => ({ q, state: ctx.states.get(q.id) }))
        .filter((x): x is { q: CatalogEntry; state: ReviewState } => !!x.state && isDue(x.state, ctx.now))
        .sort((a, b) => reviewPriority(b.state, ctx.now) - reviewPriority(a.state, ctx.now));
      return shuffle(due.slice(0, count).map((x) => x.q.id), ctx.rng);
    }
    case "missed":
      return buildMissed(filtered, config, ctx, count);
    case "weak":
      return buildWeak(filtered, config, ctx, count);
    default:
      return pickWeighted(filtered, weight, count, ctx.rng);
  }
}

function pickWeighted(items: readonly CatalogEntry[], weight: (q: CatalogEntry) => number, count: number, rng: Rng): string[] {
  return weightedSample(items, weight, count, rng).map((q) => q.id);
}

function buildMissed(filtered: readonly CatalogEntry[], config: QuizConfig, ctx: QuizBuildContext, count: number): string[] {
  const missed = filtered
    .map((q) => ({ q, state: ctx.states.get(q.id) }))
    .filter((x): x is { q: CatalogEntry; state: ReviewState } => !!x.state && isInMissedPool(x.state, ctx.now));

  switch (config.missedOrder) {
    case "oldest":
      return missed
        .sort((a, b) => (a.state.lastMissedAt ?? "").localeCompare(b.state.lastMissedAt ?? ""))
        .slice(0, count)
        .map((x) => x.q.id);
    case "most":
      return missed
        .sort((a, b) => b.state.timesIncorrect - a.state.timesIncorrect || a.state.mastery - b.state.mastery)
        .slice(0, count)
        .map((x) => x.q.id);
    default:
      // Questions the learner is recovering on (higher mastery) appear less often.
      return weightedSample(missed, (x) => (5 - x.state.mastery) * (x.state.lastResult ? 1 : 2), count, ctx.rng).map((x) => x.q.id);
  }
}

function buildWeak(filtered: readonly CatalogEntry[], config: QuizConfig, ctx: QuizBuildContext, count: number): string[] {
  const ranked = rankTopics(ctx.topicStats, { minAttempts: 1 });
  // Only genuinely weak topics qualify; if everything is strong, use the bottom three.
  const weak = ranked.filter((t) => t.score < STRONG_TOPIC_SCORE);
  const weakest = (weak.length ? weak : ranked.slice(0, 3)).slice(0, 6);
  const topicWeakness = new Map(weakest.map((t) => [t.topicId, 1 - t.score]));

  const candidates = weakest.length ? filtered.filter((q) => q.topics.some((t) => topicWeakness.has(t))) : [];
  const scored = candidates.map((q) => ({
    q,
    priority: weakTopicPriority(q, topicWeakness, ctx.states.get(q.id), ctx.now) * (config.hardMode ? Math.sqrt(hardModeWeight(q)) : 1),
  }));
  // Exponential weighting keeps high-priority questions dominant while preserving variety.
  const picked = weightedSample(scored, (x) => Math.exp(4 * x.priority), count, ctx.rng).map((x) => x.q.id);

  if (picked.length >= count) return picked;
  // Not enough weak-topic questions: top up with the lowest-mastery questions.
  const chosen = new Set(picked);
  const fillers = filtered
    .filter((q) => !chosen.has(q.id))
    .sort((a, b) => (ctx.states.get(a.id)?.mastery ?? 0) - (ctx.states.get(b.id)?.mastery ?? 0));
  const fill = weightedSample(fillers, (q) => 5 - (ctx.states.get(q.id)?.mastery ?? 0), count - picked.length, ctx.rng);
  return [...picked, ...fill.map((q) => q.id)];
}

/**
 * The dashboard's "Continue Studying" session: due reviews first, then weak
 * topics, then new material, shuffled together.
 */
export function buildDailySession(count: number, ctx: QuizBuildContext, config: Partial<QuizConfig> = {}): string[] {
  const total = clampCount(count);
  const filtered = filterCatalog(ctx.catalog, { count: total, ...config });
  const chosen = new Set<string>();
  const take = (ids: string[]) => {
    for (const id of ids) {
      if (chosen.size >= total) break;
      chosen.add(id);
    }
  };

  const dueTarget = Math.ceil(total * 0.5);
  const due = buildQuiz({ count: dueTarget, pool: "due" }, { ...ctx, catalog: filtered });
  take(due);

  const weakTarget = Math.min(total, chosen.size + Math.ceil(total * 0.3));
  if (ctx.topicStats.length) {
    const weak = buildQuiz({ count: total, pool: "weak" }, { ...ctx, catalog: filtered.filter((q) => !chosen.has(q.id)) });
    for (const id of weak) {
      if (chosen.size >= weakTarget) break;
      chosen.add(id);
    }
  }

  const unseen = buildQuiz({ count: total, pool: "unanswered" }, { ...ctx, catalog: filtered.filter((q) => !chosen.has(q.id)) });
  take(unseen);
  if (chosen.size < total) {
    take(buildQuiz({ count: total, pool: "all" }, { ...ctx, catalog: filtered.filter((q) => !chosen.has(q.id)) }));
  }
  return shuffle([...chosen], ctx.rng);
}
