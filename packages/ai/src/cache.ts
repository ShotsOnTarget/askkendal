import { createHash } from "node:crypto";
import type { Judge, JudgeRequest, JudgeResult, Question } from "./types";

export interface CachedJudgment {
  model: string;
  answers: unknown;
  inputTokens: number;
  outputTokens: number;
}

/** Storage for judgments. The app implements this with Postgres; tests use a Map. */
export interface JudgmentCache {
  get(key: string): Promise<CachedJudgment | null>;
  set(
    key: string,
    entry: CachedJudgment & { provider: string; purpose: string; request: unknown },
  ): Promise<void>;
}

/** JSON with object keys sorted, so equal requests always hash the same. */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(",")}}`;
}

export function judgmentKey(provider: string, model: string, state: unknown, questions: unknown): string {
  return createHash("sha256").update(stableStringify({ provider, model, state, questions })).digest("hex");
}

/** Wrap a judge so identical requests are answered from the cache and never paid for twice. */
export function withCache(judge: Judge, cache: JudgmentCache): Judge {
  return {
    provider: judge.provider,
    model: judge.model,
    async ask<Qs extends Record<string, Question>>(req: JudgeRequest<Qs>): Promise<JudgeResult<Qs>> {
      const key = judgmentKey(judge.provider, judge.model, req.state, req.questions);
      const hit = await cache.get(key);
      if (hit) {
        return {
          answers: hit.answers as JudgeResult<Qs>["answers"],
          model: hit.model,
          usage: { inputTokens: 0, outputTokens: 0 },
          cached: true,
        };
      }
      const result = await judge.ask(req);
      await cache.set(key, {
        provider: judge.provider,
        purpose: req.purpose,
        model: result.model,
        request: { state: req.state, questions: req.questions },
        answers: result.answers,
        inputTokens: result.usage.inputTokens,
        outputTokens: result.usage.outputTokens,
      });
      return result;
    },
  };
}
