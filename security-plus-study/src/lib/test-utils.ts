import type { CatalogEntry, DomainId, Question, ReviewState, TopicStat } from "@/lib/types";

export function makeState(questionId: string, overrides: Partial<ReviewState> = {}): ReviewState {
  return {
    questionId,
    mastery: 1,
    timesSeen: 1,
    timesCorrect: 0,
    timesIncorrect: 1,
    correctStreak: 0,
    intervalDays: 0,
    dueAt: "2026-01-01T00:00:00.000Z",
    lastAnsweredAt: "2026-01-01T00:00:00.000Z",
    lastResult: false,
    lastConfidence: null,
    lastMissedAt: "2026-01-01T00:00:00.000Z",
    lastAttemptId: null,
    ...overrides,
  };
}

export function makeEntry(id: string, overrides: Partial<CatalogEntry> = {}): CatalogEntry {
  return {
    id,
    domainId: 1,
    topics: ["pki"],
    difficulty: "medium",
    questionType: "single",
    isScenario: false,
    ...overrides,
  };
}

export function makeCatalog(perDomain: number): CatalogEntry[] {
  const out: CatalogEntry[] = [];
  for (const d of [1, 2, 3, 4, 5] as DomainId[]) {
    for (let i = 0; i < perDomain; i++) {
      out.push(makeEntry(`d${d}-q${i}`, { domainId: d, topics: [`topic-${d}-${i % 3}`] }));
    }
  }
  return out;
}

export function makeTopicStat(topicId: string, attempts: number, correct: number, recentAccuracy?: number): TopicStat {
  return {
    topicId,
    attempts,
    correct,
    recentAccuracy: recentAccuracy ?? (attempts ? correct / attempts : 0),
    lastAttemptAt: "2026-01-01T00:00:00.000Z",
  };
}

export function makeQuestion(id: string, overrides: Partial<Question> = {}): Question {
  return {
    id,
    stem: `Question ${id}?`,
    choices: [
      { id: `${id}-a`, text: "A", isCorrect: true, explanation: null },
      { id: `${id}-b`, text: "B", isCorrect: false, explanation: "Wrong" },
      { id: `${id}-c`, text: "C", isCorrect: false, explanation: "Wrong" },
      { id: `${id}-d`, text: "D", isCorrect: false, explanation: "Wrong" },
    ],
    domainId: 1,
    topics: ["pki"],
    difficulty: "medium",
    questionType: "single",
    correctCount: 1,
    explanation: "Because.",
    examClue: "",
    memoryTip: "",
    isScenario: false,
    status: "published",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}
