import "server-only";
import { documents, getDb, judgments, sources } from "@askkendal/db";
import { KENDAL_MAP_THRESHOLD } from "@askkendal/ingest/publicity";
import { and, count, desc, eq, gte, isNotNull, sql, type SQL } from "drizzle-orm";
import type { DataStatus, MapDecision } from "./types";

/** Every page degrades gracefully: a missing database becomes a notice, not a crash. */
async function safely<T>(fallback: T, fn: () => Promise<T>): Promise<{ data: T; status: DataStatus }> {
  try {
    return { data: await fn(), status: { ok: true } };
  } catch (err) {
    const cause = (err as { cause?: Error }).cause;
    const message = cause?.message ?? (err as Error).message;
    console.error("[askkendal] database query failed:", message);
    return {
      data: fallback,
      status: { ok: false, message: "The council information database is not reachable right now." },
    };
  }
}

const mapColumns = {
  id: documents.id,
  title: documents.title,
  url: documents.url,
  publishedAt: documents.publishedAt,
  sourceKey: documents.sourceKey,
  theme: documents.theme,
  urgency: documents.urgency,
  urgencyLabel: documents.urgencyLabel,
  isDecision: documents.isDecision,
  locationName: documents.locationName,
  lat: documents.lat,
  lng: documents.lng,
  summary: documents.summary,
  judgeModel: documents.judgeModel,
};

type Row = { [K in keyof typeof mapColumns]: unknown };
function toMapDecision(r: Row): MapDecision {
  return { ...(r as unknown as MapDecision), publishedAt: r.publishedAt ? (r.publishedAt as Date).toISOString() : null };
}

const kendalPublic = and(eq(documents.isPublic, true), gte(documents.kendalRelevance, KENDAL_MAP_THRESHOLD));

/** Public items placed on the Kendal map. */
export function getMapDecisions() {
  return safely<MapDecision[]>([], async () => {
    const rows = await getDb()
      .select(mapColumns)
      .from(documents)
      .where(and(kendalPublic, isNotNull(documents.lat)))
      .orderBy(desc(documents.publishedAt))
      .limit(400);
    return rows.map(toMapDecision);
  });
}

/** Most recent public items about Kendal, for the advisor panel. */
export function getLatestKendal(limit = 6) {
  return safely<MapDecision[]>([], async () => {
    const rows = await getDb()
      .select(mapColumns)
      .from(documents)
      .where(kendalPublic)
      .orderBy(desc(documents.publishedAt))
      .limit(limit);
    return rows.map(toMapDecision);
  });
}

export type Scope = "kendal" | "area";

export interface SearchParams {
  q?: string;
  theme?: string;
  scope?: Scope;
  decisionsOnly?: boolean;
  page?: number;
}

export const PAGE_SIZE = 25;

/** Full-text search over public documents. No AI involved: this keeps working when the AI budget is spent. */
export function searchPublic(params: SearchParams) {
  return safely({ rows: [] as MapDecision[], total: 0 }, async () => {
    const db = getDb();
    const where: SQL[] = [eq(documents.isPublic, true)];
    where.push(
      params.scope === "area"
        ? gte(documents.kendalRelevance, 0.5)
        : gte(documents.kendalRelevance, KENDAL_MAP_THRESHOLD),
    );
    if (params.theme) where.push(eq(documents.theme, params.theme));
    if (params.decisionsOnly) where.push(gte(documents.isDecision, 0.6));
    const q = params.q?.trim();
    let rank: SQL | undefined;
    if (q) {
      const tsq = sql`websearch_to_tsquery('english', ${q})`;
      where.push(sql`${documents.search} @@ ${tsq}`);
      rank = sql`ts_rank(${documents.search}, ${tsq})`;
    }
    const cond = and(...where);
    const page = Math.max(1, params.page ?? 1);
    const [rows, [{ n }]] = await Promise.all([
      db
        .select(mapColumns)
        .from(documents)
        .where(cond)
        .orderBy(...(rank ? [desc(rank), desc(documents.publishedAt)] : [desc(documents.publishedAt)]))
        .limit(PAGE_SIZE)
        .offset((page - 1) * PAGE_SIZE),
      db.select({ n: count() }).from(documents).where(cond),
    ]);
    return { rows: rows.map(toMapDecision), total: Number(n) };
  });
}

// --- Council door -----------------------------------------------------------------------------

export interface CouncilDocFilter {
  q?: string;
  source?: string;
  visibility?: "public" | "council";
  page?: number;
}

export function councilDocuments(f: CouncilDocFilter) {
  return safely({ rows: [] as Array<typeof documents.$inferSelect>, total: 0 }, async () => {
    const db = getDb();
    const where: SQL[] = [];
    if (f.source) where.push(eq(documents.sourceKey, f.source));
    if (f.visibility === "public") where.push(eq(documents.isPublic, true));
    if (f.visibility === "council") where.push(eq(documents.isPublic, false));
    if (f.q?.trim()) where.push(sql`${documents.search} @@ websearch_to_tsquery('english', ${f.q.trim()})`);
    const cond = where.length ? and(...where) : undefined;
    const page = Math.max(1, f.page ?? 1);
    const [rows, [{ n }]] = await Promise.all([
      db
        .select()
        .from(documents)
        .where(cond)
        .orderBy(desc(documents.urgency), desc(documents.publishedAt))
        .limit(PAGE_SIZE)
        .offset((page - 1) * PAGE_SIZE),
      db.select({ n: count() }).from(documents).where(cond),
    ]);
    return { rows, total: Number(n) };
  });
}

export function councilSources() {
  return safely([] as Array<typeof sources.$inferSelect>, async () => getDb().select().from(sources).orderBy(sources.key));
}

export function judgmentUsage(days = 14) {
  return safely(
    { byDay: [] as Array<{ day: string; requests: number; tokens: number }>, totals: { requests: 0, tokens: 0 }, judged: 0, rules: 0 },
    async () => {
      const db = getDb();
      const since = new Date(Date.now() - days * 86400_000);
      const byDay = await db
        .select({
          day: sql<string>`to_char(date_trunc('day', ${judgments.createdAt}), 'YYYY-MM-DD')`,
          requests: count(),
          tokens: sql<number>`coalesce(sum(${judgments.inputTokens} + ${judgments.outputTokens}), 0)::int`,
        })
        .from(judgments)
        .where(gte(judgments.createdAt, since))
        .groupBy(sql`1`)
        .orderBy(sql`1 desc`);
      const [totals] = await db
        .select({
          requests: count(),
          tokens: sql<number>`coalesce(sum(${judgments.inputTokens} + ${judgments.outputTokens}), 0)::int`,
        })
        .from(judgments);
      const [{ judged }] = await db
        .select({ judged: count() })
        .from(documents)
        .where(sql`${documents.judgeModel} is not null and ${documents.judgeModel} <> 'rules'`);
      const [{ rules }] = await db.select({ rules: count() }).from(documents).where(eq(documents.judgeModel, "rules"));
      return {
        byDay: byDay.map((d) => ({ ...d, requests: Number(d.requests), tokens: Number(d.tokens) })),
        totals: { requests: Number(totals.requests), tokens: Number(totals.tokens) },
        judged: Number(judged),
        rules: Number(rules),
      };
    },
  );
}
