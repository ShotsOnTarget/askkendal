import { describe, expect, it, vi } from "vitest";
import {
  JudgeError,
  TypeSafeJudge,
  buildDocumentQuestions,
  choice,
  createJudgeFromEnv,
  judgeDocument,
  judgmentKey,
  noul,
  ruleBasedJudgment,
  score,
  stableStringify,
  withCache,
  type CachedJudgment,
  type JudgmentCache,
} from "../src";

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
}

describe("TypeSafeJudge", () => {
  it("sends the documented request shape and returns typed answers", async () => {
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      expect(body.model).toBe("jev-latest");
      expect(body.state).toEqual({ text: "Road closed on Highgate" });
      expect(body.questions.urgent).toEqual({
        type: "noul",
        instructions: "Is it urgent?",
        criteria: { true: "yes", false: "no" },
      });
      expect(body.questions.team.criteria).toEqual({ roads: "Roads", other: "Other" });
      expect(body.questions.level.criteria).toEqual(["low", "high"]);
      expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer test-key");
      return jsonResponse({
        model: "jev-1.13.0",
        answers: {
          urgent: { type: "noul", noul: 0.8 },
          team: { type: "choice", choice: "roads", probabilities: { roads: 0.9, other: 0.1 }, confidence: 0.85 },
          level: { type: "score", score: 0.7, legend: { "0": "low", "1": "high" }, probabilities: { "0": 0.3, "1": 0.7 }, confidence: 0.5 },
        },
        usage: { input_tokens: 120, output_tokens: 9 },
      });
    });
    const judge = new TypeSafeJudge({ apiKey: "test-key", fetchImpl: fetchImpl as typeof fetch });
    const result = await judge.ask({
      purpose: "test",
      state: { text: "Road closed on Highgate" },
      questions: {
        urgent: noul("Is it urgent?", { true: "yes", false: "no" }),
        team: choice("Which team?", { roads: "Roads", other: "Other" }),
        level: score("How much?", ["low", "high"]),
      },
    });
    expect(result.answers.urgent.noul).toBe(0.8);
    expect(result.answers.team.choice).toBe("roads");
    expect(result.answers.level.score).toBe(0.7);
    expect(result.usage).toEqual({ inputTokens: 120, outputTokens: 9 });
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("retries on 429 and 529, then succeeds", async () => {
    const responses = [
      jsonResponse({ error: "slow down" }, 429),
      jsonResponse({ error: "busy" }, 529),
      jsonResponse({ model: "jev", answers: { q: { type: "noul", noul: 0.2 } } }),
    ];
    const fetchImpl = vi.fn(async () => responses.shift()!);
    const judge = new TypeSafeJudge({ apiKey: "k", fetchImpl: fetchImpl as typeof fetch, sleep: async () => {} });
    const result = await judge.ask({ purpose: "t", state: "x", questions: { q: noul("?") } });
    expect(result.answers.q.noul).toBe(0.2);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("fails clearly on 401 without retrying", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ error: "bad key" }, 401));
    const judge = new TypeSafeJudge({ apiKey: "k", fetchImpl: fetchImpl as typeof fetch, sleep: async () => {} });
    await expect(judge.ask({ purpose: "t", state: "x", questions: { q: noul("?") } })).rejects.toThrow(/TYPESAFE_API_KEY/);
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("rejects a response that is missing an answer", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ model: "jev", answers: {} }));
    const judge = new TypeSafeJudge({ apiKey: "k", fetchImpl: fetchImpl as typeof fetch });
    await expect(judge.ask({ purpose: "t", state: "x", questions: { q: noul("?") } })).rejects.toBeInstanceOf(JudgeError);
  });
});

describe("cache", () => {
  it("hashes equal requests identically regardless of key order", () => {
    expect(stableStringify({ b: 1, a: [2, { d: 3, c: 4 }] })).toBe('{"a":[2,{"c":4,"d":3}],"b":1}');
    expect(judgmentKey("p", "m", { x: 1, y: 2 }, {})).toBe(judgmentKey("p", "m", { y: 2, x: 1 }, {}));
  });

  it("answers repeat requests from the cache", async () => {
    const store = new Map<string, CachedJudgment>();
    const cache: JudgmentCache = {
      get: async (k) => store.get(k) ?? null,
      set: async (k, v) => void store.set(k, v),
    };
    const inner = {
      provider: "fake",
      model: "m",
      ask: vi.fn(async () => ({
        answers: { q: { type: "noul" as const, noul: 0.9 } },
        model: "m",
        usage: { inputTokens: 10, outputTokens: 1 },
        cached: false,
      })),
    };
    const judge = withCache(inner as any, cache);
    const req = { purpose: "t", state: { a: 1 }, questions: { q: noul("?") } };
    const first = await judge.ask(req);
    const second = await judge.ask(req);
    expect(first.cached).toBe(false);
    expect(second.cached).toBe(true);
    expect(second.answers.q.noul).toBe(0.9);
    expect(second.usage.inputTokens).toBe(0);
    expect(inner.ask).toHaveBeenCalledOnce();
  });
});

describe("civic judgments", () => {
  it("adds a location question only when there is a real choice", () => {
    expect("location" in buildDocumentQuestions([])).toBe(false);
    expect("location" in buildDocumentQuestions([{ name: "Highgate", kind: "street" }])).toBe(false);
    const qs = buildDocumentQuestions([
      { name: "Highgate", kind: "street" },
      { name: "Stricklandgate", kind: "street" },
    ]) as any;
    expect(Object.keys(qs.location.criteria)).toEqual(["place_0", "place_1", "none"]);
  });

  it("maps Jev answers onto document fields", async () => {
    const judge = {
      provider: "fake",
      model: "m",
      ask: async () => ({
        model: "jev-1",
        cached: false,
        usage: { inputTokens: 1, outputTokens: 1 },
        answers: {
          theme: { type: "choice", choice: "transport", probabilities: { transport: 0.9 }, confidence: 0.8 },
          kendal: { type: "score", score: 2.9, legend: {}, probabilities: {}, confidence: 0.9 },
          decision: { type: "noul", noul: 0.7 },
          private: { type: "noul", noul: 0.05 },
          urgency: { type: "score", score: 2.2, legend: {}, probabilities: {}, confidence: 0.6 },
          location: { type: "choice", choice: "place_1", probabilities: { place_1: 0.8 }, confidence: 0.7 },
        },
      }),
    };
    const out = await judgeDocument(
      judge as any,
      { title: "Works on Stricklandgate", source: "council-news", published: null, text: "..." },
      [
        { name: "Highgate", kind: "street" },
        { name: "Stricklandgate", kind: "street" },
      ],
    );
    expect(out.theme).toBe("transport");
    expect(out.locationIndex).toBe(1);
    expect(out.urgencyLabel).toBe("Noticeable");
    expect(out.namesPrivate).toBe(0.05);
  });

  it("falls back to keyword rules", () => {
    const out = ruleBasedJudgment(
      { title: "Flood defences in Kendal", source: "x", published: null, text: "River work" },
      [],
    );
    expect(out.theme).toBe("environment");
    expect(out.kendalRelevance).toBe(3);
    expect(out.namesPrivate).toBeNull();
  });
});

describe("config", () => {
  it("reports why no judge is available", () => {
    expect(createJudgeFromEnv({ JUDGE_PROVIDER: "typesafe" }).reason).toMatch(/TYPESAFE_API_KEY/);
    expect(createJudgeFromEnv({ JUDGE_PROVIDER: "none", TYPESAFE_API_KEY: "k" }).judge).toBeNull();
    expect(createJudgeFromEnv({ TYPESAFE_API_KEY: "k" }).judge?.model).toBe("jev-latest");
  });

  it("names the bad variable", () => {
    expect(() => createJudgeFromEnv({ JUDGE_PROVIDER: "gpt" })).toThrow(/JUDGE_PROVIDER/);
  });
});
