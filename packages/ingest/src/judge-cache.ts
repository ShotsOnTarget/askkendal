import type { JudgmentCache } from "@askkendal/ai";
import { judgments, type DB } from "@askkendal/db";
import { eq, gte, sql } from "drizzle-orm";

/** Judgment cache and usage ledger in Postgres. */
export function createDbJudgmentCache(db: DB): JudgmentCache {
  return {
    async get(key) {
      const row = await db.query.judgments.findFirst({ where: eq(judgments.key, key) });
      return row
        ? { model: row.model, answers: row.answers, inputTokens: row.inputTokens, outputTokens: row.outputTokens }
        : null;
    },
    async set(key, e) {
      await db
        .insert(judgments)
        .values({
          key,
          provider: e.provider,
          model: e.model,
          purpose: e.purpose,
          request: e.request,
          answers: e.answers,
          inputTokens: e.inputTokens,
          outputTokens: e.outputTokens,
        })
        .onConflictDoNothing();
    },
  };
}

/** Tokens spent on judgments since midnight UTC. */
export async function tokensUsedToday(db: DB): Promise<number> {
  const start = new Date();
  start.setUTCHours(0, 0, 0, 0);
  const [row] = await db
    .select({ total: sql<number>`coalesce(sum(${judgments.inputTokens} + ${judgments.outputTokens}), 0)::int` })
    .from(judgments)
    .where(gte(judgments.createdAt, start));
  return Number(row?.total ?? 0);
}
