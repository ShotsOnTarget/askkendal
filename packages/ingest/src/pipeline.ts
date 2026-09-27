import {
  judgeDocument,
  ruleBasedJudgment,
  withCache,
  type DocumentJudgment,
  type Judge,
  type LocationCandidate,
} from "@askkendal/ai";
import { documents, riverReadings, sources, type DB } from "@askkendal/db";
import { and, eq, isNull, or } from "drizzle-orm";
import { Geocoder, type GazetteerEntry } from "./geocode";
import { createDbJudgmentCache, tokensUsedToday } from "./judge-cache";
import { isPublicDocument, KENDAL_MAP_THRESHOLD } from "./publicity";
import { fetchRiverStatus } from "./sources/ea-flood";
import { contentHash, summarise } from "./text";
import type { RawDocument, SourceAdapter } from "./types";

export interface PipelineOptions {
  db: DB;
  judge: Judge | null;
  judgeReason?: string;
  dailyTokenCap: number;
  gazetteer: GazetteerEntry[];
  refetch?: boolean;
  limit?: number;
  concurrency?: number;
  log?: (msg: string) => void;
}

interface Stats {
  added: number;
  updated: number;
  unchanged: number;
  judged: number;
  rules: number;
  located: number;
  tokens: number;
}

/**
 * Turns raw documents into judged rows: Jev (through the Postgres cache) when available and
 * within today's token cap, keyword rules otherwise. Rule-judged rows can be re-judged later.
 */
export class Pipeline {
  private readonly db: DB;
  private readonly judge: Judge | null;
  private readonly geocoder: Geocoder;
  private readonly log: (msg: string) => void;
  private budgetLeft = Infinity;
  private budgetWarned = false;

  constructor(private readonly opts: PipelineOptions) {
    this.db = opts.db;
    this.judge = opts.judge ? withCache(opts.judge, createDbJudgmentCache(opts.db)) : null;
    this.geocoder = new Geocoder(opts.gazetteer);
    this.log = opts.log ?? console.log;
  }

  async init() {
    if (this.opts.dailyTokenCap > 0) {
      this.budgetLeft = this.opts.dailyTokenCap - (await tokensUsedToday(this.db));
    }
    if (!this.judge) this.log(`Jev is off (${this.opts.judgeReason ?? "no judge"}); using keyword rules.`);
    else this.log(`Jev is on (${this.opts.judge!.model}); ${Number.isFinite(this.budgetLeft) ? `${this.budgetLeft.toLocaleString()} tokens left today` : "no daily cap"}.`);
  }

  async runSource(adapter: SourceAdapter): Promise<void> {
    this.log(`\n== ${adapter.name}`);
    const existing = await this.db
      .select({ externalId: documents.externalId })
      .from(documents)
      .where(eq(documents.sourceKey, adapter.key));
    const known = new Set(existing.map((r) => r.externalId));
    const result = await adapter.run({
      known,
      refetch: !!this.opts.refetch,
      limit: this.opts.limit ?? 500,
      log: this.log,
    });
    this.log(`  status: ${result.status}${result.httpStatus ? ` (HTTP ${result.httpStatus})` : ""}${result.message ? ` — ${result.message}` : ""}`);

    const stats = await this.processDocuments(adapter.key, result.documents);
    await this.db
      .insert(sources)
      .values({
        key: adapter.key,
        name: adapter.name,
        baseUrl: adapter.baseUrl,
        status: result.status,
        lastRunAt: new Date(),
        lastHttpStatus: result.httpStatus ?? null,
        lastMessage: result.message ?? null,
        documentsSeen: known.size + stats.added,
      })
      .onConflictDoUpdate({
        target: sources.key,
        set: {
          name: adapter.name,
          baseUrl: adapter.baseUrl,
          status: result.status,
          lastRunAt: new Date(),
          lastHttpStatus: result.httpStatus ?? null,
          lastMessage: result.message ?? null,
          documentsSeen: known.size + stats.added,
        },
      });
    if (result.documents.length) {
      this.log(
        `  ${stats.added} added, ${stats.updated} updated, ${stats.unchanged} unchanged; ` +
          `${stats.judged} judged by Jev, ${stats.rules} by rules; ${stats.located} placed on the map; ${stats.tokens.toLocaleString()} tokens`,
      );
    }
  }

  private async processDocuments(sourceKey: string, docs: RawDocument[]): Promise<Stats> {
    const stats: Stats = { added: 0, updated: 0, unchanged: 0, judged: 0, rules: 0, located: 0, tokens: 0 };
    const queue = [...docs];
    const worker = async () => {
      for (let doc = queue.shift(); doc; doc = queue.shift()) {
        try {
          await this.processOne(sourceKey, doc, stats);
        } catch (err) {
          const cause = (err as { cause?: Error }).cause;
          this.log(`  failed on "${doc.title}": ${cause?.message ?? (err as Error).message}`);
        }
      }
    };
    await Promise.all(Array.from({ length: this.opts.concurrency ?? 4 }, worker));
    return stats;
  }

  private async processOne(sourceKey: string, doc: RawDocument, stats: Stats) {
    const hash = contentHash(doc.title, doc.body);
    const prior = await this.db.query.documents.findFirst({
      where: and(eq(documents.sourceKey, sourceKey), eq(documents.externalId, doc.externalId)),
    });
    if (prior && prior.contentHash === hash && prior.judgeModel && prior.judgeModel !== "rules") {
      stats.unchanged++;
      return;
    }
    const judged = await this.judgeOne(sourceKey, doc);
    if (judged.j.model === "rules") stats.rules++;
    else stats.judged++;
    stats.tokens += judged.j.usage.inputTokens + judged.j.usage.outputTokens;
    if (judged.place) stats.located++;

    const values = {
      sourceKey,
      externalId: doc.externalId,
      title: doc.title,
      url: doc.url,
      publishedAt: doc.publishedAt,
      docType: doc.docType,
      body: doc.body,
      summary: summarise(doc.body),
      contentHash: hash,
      ...judgementColumns(sourceKey, doc.docType, judged.j, judged.place),
      updatedAt: new Date(),
    };
    await this.db
      .insert(documents)
      .values(values)
      .onConflictDoUpdate({ target: [documents.sourceKey, documents.externalId], set: values });
    if (prior) stats.updated++;
    else stats.added++;
  }

  private async judgeOne(sourceKey: string, doc: { title: string; body: string; publishedAt: Date | null }) {
    const candidates = this.geocoder.candidates(doc.title, doc.body);
    const locCandidates: LocationCandidate[] = candidates.map((c) => ({ name: c.name, kind: c.kind }));
    const state = {
      title: doc.title,
      source: sourceKey === "town-council" ? "Kendal Town Council" : "Westmorland and Furness Council",
      published: doc.publishedAt ? doc.publishedAt.toISOString().slice(0, 10) : null,
      text: doc.body,
    };
    let j: DocumentJudgment | null = null;
    if (this.judge && this.budgetLeft > 0) {
      try {
        j = await judgeDocument(this.judge, state, locCandidates);
        this.budgetLeft -= j.usage.inputTokens + j.usage.outputTokens;
      } catch (err) {
        this.log(`  Jev failed for "${doc.title}": ${(err as Error).message}. Using rules.`);
      }
    } else if (this.judge && !this.budgetWarned) {
      this.budgetWarned = true;
      this.log("  Daily Jev token cap reached; remaining documents use keyword rules (re-judge tomorrow with --rejudge).");
    }
    j ??= ruleBasedJudgment(state, locCandidates);
    const place =
      j.locationIndex !== null && j.kendalRelevance >= KENDAL_MAP_THRESHOLD ? candidates[j.locationIndex] ?? null : null;
    return { j, place };
  }

  /**
   * Re-judge stored documents. By default only those classified by rules (after adding a key or on a
   * new day's budget). With `all`, every document: useful after the gazetteer changes. Unchanged
   * questions are answered from the cache, so only documents whose questions changed cost tokens.
   */
  async rejudge(all = false): Promise<void> {
    const rows = await this.db
      .select()
      .from(documents)
      .where(all ? undefined : or(isNull(documents.judgeModel), eq(documents.judgeModel, "rules")));
    this.log(`\n== Re-judging ${rows.length} documents`);
    let n = 0;
    for (const row of rows) {
      const judged = await this.judgeOne(row.sourceKey, row);
      if (judged.j.model === "rules") continue;
      await this.db
        .update(documents)
        .set({ ...judgementColumns(row.sourceKey, row.docType, judged.j, judged.place), updatedAt: new Date() })
        .where(eq(documents.id, row.id));
      n++;
    }
    this.log(`  ${n} documents re-judged by Jev.`);
  }

  /** Store the latest river readings so a level history builds up over time. */
  async snapshotRivers(): Promise<void> {
    this.log("\n== Environment Agency river levels");
    try {
      const status = await fetchRiverStatus();
      const rows = status.stations
        .filter((s) => s.value !== null && s.measuredAt)
        .map((s) => ({ station: s.id, label: s.label, river: s.river, value: s.value!, measuredAt: new Date(s.measuredAt!) }));
      if (rows.length) await this.db.insert(riverReadings).values(rows).onConflictDoNothing();
      await this.db
        .insert(sources)
        .values({
          key: "ea-flood",
          name: "Environment Agency river levels",
          baseUrl: "https://environment.data.gov.uk/flood-monitoring",
          status: "ok",
          lastRunAt: new Date(),
          lastHttpStatus: 200,
          lastMessage: `${rows.length} gauges, ${status.warnings.length} active flood warnings`,
          documentsSeen: 0,
        })
        .onConflictDoUpdate({
          target: sources.key,
          set: { status: "ok", lastRunAt: new Date(), lastHttpStatus: 200, lastMessage: `${rows.length} gauges, ${status.warnings.length} active flood warnings` },
        });
      this.log(`  ${rows.length} gauge readings stored; ${status.warnings.length} active flood warnings.`);
    } catch (err) {
      this.log(`  failed: ${(err as Error).message}`);
    }
  }
}

function judgementColumns(
  sourceKey: string,
  docType: string,
  j: DocumentJudgment,
  place: { name: string; lat: number; lon: number } | null,
) {
  return {
    theme: j.theme,
    themeConfidence: j.themeConfidence,
    kendalRelevance: j.kendalRelevance,
    isDecision: j.isDecision,
    namesPrivate: j.namesPrivate,
    urgency: j.urgency,
    urgencyLabel: j.urgencyLabel,
    locationName: place?.name ?? null,
    lat: place?.lat ?? null,
    lng: place?.lon ?? null,
    judgedAt: new Date(),
    judgeModel: j.model,
    isPublic: isPublicDocument(sourceKey, docType, j.namesPrivate),
  };
}

