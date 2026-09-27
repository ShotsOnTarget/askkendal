import { getMapDecisions } from "@/lib/queries";

/** Public items placed on the Kendal map, as JSON. */
export async function GET() {
  const { data, status } = await getMapDecisions();
  if (!status.ok) return Response.json({ error: status.message }, { status: 503 });
  return Response.json(data, { headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600" } });
}
