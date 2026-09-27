/**
 * Environment Agency real-time flood monitoring API (Open Government Licence).
 * Browser-safe apart from `fetch`; used live by the web app and for snapshots by the CLI.
 */

const API = "https://environment.data.gov.uk/flood-monitoring";
export const KENDAL_CENTRE = { lat: 54.328, lon: -2.746 };

export interface RiverStation {
  id: string;
  label: string;
  river: string | null;
  lat: number;
  lon: number;
  value: number | null;
  measuredAt: string | null;
  typicalLow: number | null;
  typicalHigh: number | null;
  maxOnRecord: number | null;
  maxOnRecordAt: string | null;
  /** 0 at the bottom of the typical range, 1 at the top. Null when unknown. */
  relative: number | null;
  status: "low" | "normal" | "high" | "unknown";
}

export interface FloodWarning {
  id: string;
  severity: string;
  severityLevel: number;
  area: string;
  message: string;
  raisedAt: string | null;
}

export interface RiverStatus {
  fetchedAt: string;
  stations: RiverStation[];
  warnings: FloodWarning[];
  attribution: string;
}

interface EaStationListItem {
  notation: string;
  label: string | string[];
  riverName?: string;
  lat: number | number[];
  long: number | number[];
}

interface EaStationDetail {
  items: {
    notation: string;
    label: string;
    riverName?: string;
    lat: number;
    long: number;
    stageScale?: {
      typicalRangeHigh?: number;
      typicalRangeLow?: number;
      maxOnRecord?: { value: number; dateTime: string };
    };
    measures?: EaMeasure | EaMeasure[];
  };
}

interface EaMeasure {
  parameter: string;
  qualifier?: string;
  latestReading?: { value: number; dateTime: string } | string;
}

const first = <T>(v: T | T[]): T => (Array.isArray(v) ? v[0] : v);

async function getJson<T>(url: string, fetchImpl: typeof fetch): Promise<T> {
  const res = await fetchImpl(url, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`Environment Agency API: HTTP ${res.status} for ${url}`);
  return (await res.json()) as T;
}

export function classify(value: number | null, low: number | null, high: number | null) {
  if (value === null || low === null || high === null || high <= low) {
    return { relative: null, status: "unknown" as const };
  }
  const relative = (value - low) / (high - low);
  return { relative, status: value < low ? ("low" as const) : value > high ? ("high" as const) : ("normal" as const) };
}

/** River gauges within 5 km of Kendal, with the latest reading and typical range, plus active flood warnings. */
export async function fetchRiverStatus(fetchImpl: typeof fetch = fetch): Promise<RiverStatus> {
  const { lat, lon } = KENDAL_CENTRE;
  const list = await getJson<{ items: EaStationListItem[] }>(
    `${API}/id/stations?lat=${lat}&long=${lon}&dist=5&parameter=level`,
    fetchImpl,
  );
  const details = await Promise.all(
    list.items.map((s) =>
      getJson<EaStationDetail>(`${API}/id/stations/${s.notation}`, fetchImpl).catch(() => null),
    ),
  );
  const stations: RiverStation[] = [];
  for (const d of details) {
    if (!d) continue;
    const s = d.items;
    const measures = s.measures ? (Array.isArray(s.measures) ? s.measures : [s.measures]) : [];
    const level = measures.find((m) => m.parameter === "level" && (m.qualifier ?? "Stage") === "Stage");
    const reading = level && typeof level.latestReading === "object" ? level.latestReading : null;
    if (!reading) continue;
    const low = s.stageScale?.typicalRangeLow ?? null;
    const high = s.stageScale?.typicalRangeHigh ?? null;
    stations.push({
      id: s.notation,
      label: String(first(s.label)),
      river: s.riverName ?? null,
      lat: first(s.lat),
      lon: first(s.long),
      value: reading.value,
      measuredAt: reading.dateTime,
      typicalLow: low,
      typicalHigh: high,
      maxOnRecord: s.stageScale?.maxOnRecord?.value ?? null,
      maxOnRecordAt: s.stageScale?.maxOnRecord?.dateTime ?? null,
      ...classify(reading.value, low, high),
    });
  }
  stations.sort((a, b) => (a.river === "River Kent" ? -1 : 0) - (b.river === "River Kent" ? -1 : 0) || a.label.localeCompare(b.label));

  const floods = await getJson<{ items: any[] }>(`${API}/id/floods?lat=${lat}&long=${lon}&dist=10`, fetchImpl).catch(
    () => ({ items: [] }),
  );
  const warnings: FloodWarning[] = floods.items.map((f) => ({
    id: String(f.floodAreaID ?? f["@id"]),
    severity: String(f.severity ?? ""),
    severityLevel: Number(f.severityLevel ?? 4),
    area: String(f.description ?? f.eaAreaName ?? ""),
    message: String(f.message ?? ""),
    raisedAt: f.timeRaised ?? null,
  }));

  return {
    fetchedAt: new Date().toISOString(),
    stations,
    warnings,
    attribution: "Environment Agency flood and river level data from the real-time data API (Beta), Open Government Licence.",
  };
}
