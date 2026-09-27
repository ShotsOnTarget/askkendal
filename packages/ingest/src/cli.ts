/**
 * Ingest public council information.
 *
 *   pnpm ingest                         all sources
 *   pnpm ingest --source council-news   one or more (comma-separated)
 *   pnpm ingest --limit 20              at most 20 new documents per source
 *   pnpm ingest --refetch               re-download documents already stored
 *   pnpm ingest --rejudge               ask Jev about documents that were classified by keyword rules
 *   pnpm ingest --rejudge-all           re-judge every document (after a gazetteer rebuild); the cache keeps it cheap
 *
 * Sources: council-news, town-council, moderngov, forward-plan, planning, ea-flood
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { createJudgeFromEnv } from "@askkendal/ai";
import { closeDb, getDb } from "@askkendal/db";
import { loadRootEnv } from "@askkendal/db/env";
import type { GazetteerEntry } from "./geocode";
import { Pipeline } from "./pipeline";
import { councilNews } from "./sources/council-news";
import { forwardPlan, moderngov, planning } from "./sources/moderngov";
import { townCouncil } from "./sources/town-council";
import type { SourceAdapter } from "./types";

loadRootEnv();

const ADAPTERS: Record<string, SourceAdapter> = {
  "council-news": councilNews,
  "town-council": townCouncil,
  moderngov,
  "forward-plan": forwardPlan,
  planning,
};
const ALL = [...Object.keys(ADAPTERS), "ea-flood"];

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const flag = (name: string) => process.argv.includes(`--${name}`);

const selected = (arg("source") ?? ALL.join(",")).split(",").map((s) => s.trim()).filter(Boolean);
const unknown = selected.filter((s) => !ALL.includes(s));
if (unknown.length) {
  console.error(`Unknown source(s): ${unknown.join(", ")}. Choose from: ${ALL.join(", ")}`);
  process.exit(1);
}

let gazetteer: GazetteerEntry[] = [];
try {
  const path = createRequire(import.meta.url).resolve("@askkendal/voxel/gazetteer");
  gazetteer = JSON.parse(readFileSync(path, "utf8"));
} catch {
  console.warn("No gazetteer found (run pnpm voxel:build first). Documents will not be placed on the map.");
}

const { judge, reason, config } = createJudgeFromEnv();
const db = getDb();
const pipeline = new Pipeline({
  db,
  judge,
  judgeReason: reason,
  dailyTokenCap: config.JUDGE_DAILY_TOKEN_CAP,
  gazetteer,
  refetch: flag("refetch"),
  limit: arg("limit") ? Number(arg("limit")) : undefined,
});

try {
  await pipeline.init();
  if (flag("rejudge") || flag("rejudge-all")) await pipeline.rejudge(flag("rejudge-all"));
  else {
    for (const key of selected) {
      if (key === "ea-flood") await pipeline.snapshotRivers();
      else await pipeline.runSource(ADAPTERS[key]);
    }
  }
} finally {
  await closeDb();
}
