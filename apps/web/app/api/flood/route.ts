import { fetchRiverStatus, type RiverStatus } from "@askkendal/ingest/river";

// Environment Agency readings update every 15 minutes; one upstream fetch per 5 minutes serves everyone.
let cache: { at: number; data: RiverStatus } | null = null;
let inflight: Promise<RiverStatus> | null = null;
const TTL = 5 * 60_000;

export async function GET() {
  try {
    if (!cache || Date.now() - cache.at > TTL) {
      inflight ??= fetchRiverStatus().finally(() => (inflight = null));
      cache = { at: Date.now(), data: await inflight };
    }
    return Response.json(cache.data, { headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600" } });
  } catch (err) {
    if (cache) return Response.json(cache.data, { headers: { "X-AskKendal-Stale": "1" } });
    return Response.json({ error: "River data is unavailable.", detail: (err as Error).message }, { status: 502 });
  }
}
