import { describe, expect, it } from "vitest";

import { makeCatalog, makeEntry, makeState, makeTopicStat } from "@/lib/test-utils";
import type { ReviewState } from "@/lib/types";
import { buildDailySession, buildQuiz, filterCatalog, hardModeWeight, type QuizBuildContext } from "../quiz-builder";
import { createRng } from "../random";

const NOW = new Date("2026-03-01T12:00:00.000Z");
const DAY = 86_400_000;

function ctx(overrides: Partial<QuizBuildContext> = {}): QuizBuildContext {
  return {
    catalog: makeCatalog(10),
    states: new Map(),
    bookmarks: new Set(),
    topicStats: [],
    now: NOW,
    rng: createRng(42),
    ...overrides,
  };
}

describe("filterCatalog", () => {
  it("filters by domain, topic and difficulty", () => {
    const catalog = [
      makeEntry("a", { domainId: 1, topics: ["pki"], difficulty: "easy" }),
      makeEntry("b", { domainId: 2, topics: ["malware"], difficulty: "hard" }),
      makeEntry("c", { domainId: 2, topics: ["pki", "malware"], difficulty: "hard" }),
    ];
    expect(filterCatalog(catalog, { count: 5, domainIds: [2] }).map((q) => q.id)).toEqual(["b", "c"]);
    expect(filterCatalog(catalog, { count: 5, topicIds: ["pki"] }).map((q) => q.id)).toEqual(["a", "c"]);
    expect(filterCatalog(catalog, { count: 5, difficulties: ["easy"] }).map((q) => q.id)).toEqual(["a"]);
  });
});

describe("buildQuiz", () => {
  it("returns the requested number of unique questions", () => {
    const ids = buildQuiz({ count: 20 }, ctx());
    expect(ids).toHaveLength(20);
    expect(new Set(ids).size).toBe(20);
  });

  it("is deterministic for a given seed and varies across seeds", () => {
    const a = buildQuiz({ count: 10 }, ctx({ rng: createRng(1) }));
    const b = buildQuiz({ count: 10 }, ctx({ rng: createRng(1) }));
    const c = buildQuiz({ count: 10 }, ctx({ rng: createRng(2) }));
    expect(a).toEqual(b);
    expect(a).not.toEqual(c);
  });

  it("returns fewer questions when the pool is small", () => {
    expect(buildQuiz({ count: 50, domainIds: [3] }, ctx())).toHaveLength(10);
  });

  it("only returns unanswered questions for the unanswered pool", () => {
    const states = new Map<string, ReviewState>(
      makeCatalog(10)
        .slice(0, 45)
        .map((q) => [q.id, makeState(q.id)]),
    );
    const ids = buildQuiz({ count: 20, pool: "unanswered" }, ctx({ states }));
    expect(ids.length).toBe(5);
    ids.forEach((id) => expect(states.has(id)).toBe(false));
  });

  it("only returns bookmarked questions for the bookmarked pool", () => {
    const bookmarks = new Set(["d1-q1", "d4-q3"]);
    expect(buildQuiz({ count: 10, pool: "bookmarked" }, ctx({ bookmarks })).sort()).toEqual(["d1-q1", "d4-q3"]);
  });

  it("returns only due questions for the due pool", () => {
    const states = new Map<string, ReviewState>([
      ["d1-q1", makeState("d1-q1", { dueAt: new Date(NOW.getTime() - DAY).toISOString() })],
      ["d1-q2", makeState("d1-q2", { dueAt: new Date(NOW.getTime() + DAY).toISOString() })],
    ]);
    expect(buildQuiz({ count: 10, pool: "due" }, ctx({ states }))).toEqual(["d1-q1"]);
  });

  it("keeps explicit question lists in order and drops unknown ids", () => {
    expect(buildQuiz({ count: 10, questionIds: ["d2-q1", "nope", "d1-q0", "d2-q1"] }, ctx())).toEqual(["d2-q1", "d1-q0"]);
  });

  describe("missed questions", () => {
    const states = new Map<string, ReviewState>([
      ["d1-q1", makeState("d1-q1", { timesIncorrect: 1, lastMissedAt: "2026-02-10T00:00:00Z" })],
      ["d1-q2", makeState("d1-q2", { timesIncorrect: 5, lastMissedAt: "2026-02-20T00:00:00Z" })],
      ["d1-q3", makeState("d1-q3", { timesIncorrect: 2, lastMissedAt: "2026-01-01T00:00:00Z" })],
      ["d1-q4", makeState("d1-q4", { timesIncorrect: 0, lastResult: true, lastMissedAt: null })],
      [
        "d1-q5",
        makeState("d1-q5", {
          timesIncorrect: 3,
          mastery: 4,
          lastResult: true,
          dueAt: new Date(NOW.getTime() + 10 * DAY).toISOString(),
        }),
      ],
    ]);

    it("orders by oldest miss", () => {
      expect(buildQuiz({ count: 10, pool: "missed", missedOrder: "oldest" }, ctx({ states }))).toEqual(["d1-q3", "d1-q1", "d1-q2"]);
    });

    it("orders by most missed", () => {
      expect(buildQuiz({ count: 10, pool: "missed", missedOrder: "most" }, ctx({ states }))).toEqual(["d1-q2", "d1-q3", "d1-q1"]);
    });

    it("excludes never-missed and re-mastered (not yet due) questions", () => {
      const ids = buildQuiz({ count: 10, pool: "missed" }, ctx({ states }));
      expect(ids.sort()).toEqual(["d1-q1", "d1-q2", "d1-q3"]);
    });
  });

  describe("weakest topics", () => {
    it("draws predominantly from the weakest topics", () => {
      const topicStats = [
        makeTopicStat("topic-2-0", 10, 3),
        makeTopicStat("topic-1-0", 10, 10),
        makeTopicStat("topic-3-0", 10, 9),
      ];
      const ids = buildQuiz({ count: 4, pool: "weak" }, ctx({ topicStats }));
      const catalog = makeCatalog(10);
      const topicOf = (id: string) => catalog.find((q) => q.id === id)!.topics[0];
      expect(ids.filter((id) => topicOf(id) === "topic-2-0").length).toBeGreaterThanOrEqual(3);
    });

    it("falls back to low-mastery questions when there are no topic stats", () => {
      expect(buildQuiz({ count: 5, pool: "weak" }, ctx())).toHaveLength(5);
    });
  });

  it("hard mode strongly favors scenario and hard questions", () => {
    const catalog = [
      ...Array.from({ length: 30 }, (_, i) => makeEntry(`easy-${i}`, { difficulty: "easy" })),
      ...Array.from({ length: 30 }, (_, i) => makeEntry(`hard-${i}`, { difficulty: "hard", isScenario: true })),
    ];
    expect(hardModeWeight(catalog[40])).toBeGreaterThan(hardModeWeight(catalog[0]) * 10);
    const ids = buildQuiz({ count: 20, hardMode: true }, ctx({ catalog }));
    expect(ids.filter((id) => id.startsWith("hard")).length).toBeGreaterThanOrEqual(17);
  });
});

describe("buildDailySession", () => {
  it("prioritizes due reviews and fills with new questions", () => {
    const due = ["d1-q0", "d2-q0", "d3-q0"];
    const states = new Map<string, ReviewState>(
      due.map((id) => [id, makeState(id, { dueAt: new Date(NOW.getTime() - DAY).toISOString() })]),
    );
    const ids = buildDailySession(10, ctx({ states }));
    expect(ids).toHaveLength(10);
    expect(new Set(ids).size).toBe(10);
    due.forEach((id) => expect(ids).toContain(id));
  });
});
