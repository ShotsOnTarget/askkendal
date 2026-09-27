import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { BBOX } from "./constants";

export interface LatLon {
  lat: number;
  lon: number;
}

export interface OsmMember {
  type: "node" | "way" | "relation";
  ref: number;
  role: string;
  geometry?: LatLon[];
}

export interface OsmElement {
  type: "node" | "way" | "relation";
  id: number;
  tags?: Record<string, string>;
  lat?: number;
  lon?: number;
  geometry?: LatLon[];
  members?: OsmMember[];
  bounds?: { minlat: number; minlon: number; maxlat: number; maxlon: number };
}

export interface OsmData {
  elements: OsmElement[];
  timestamp: string | null;
}

const ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
];

/** Everything the voxel town, labels and gazetteer need, in one request. */
export function overpassQuery(): string {
  const b = `${BBOX.south},${BBOX.west},${BBOX.north},${BBOX.east}`;
  return `[out:json][timeout:240][bbox:${b}];
(
  nwr["building"];
  way["highway"];
  way["railway"~"^(rail|light_rail|narrow_gauge)$"];
  nwr["natural"~"^(water|wood|scrub|grassland|heath|wetland|fell)$"];
  nwr["waterway"];
  nwr["landuse"~"^(grass|meadow|recreation_ground|village_green|farmland|forest|allotments|cemetery|orchard|greenfield|plant_nursery|reservoir|basin)$"];
  nwr["leisure"~"^(park|pitch|golf_course|garden|playground|nature_reserve|common|recreation_ground|dog_park|sports_centre)$"];
  nwr["amenity"~"^(townhall|hospital|library|college|university|school|theatre|arts_centre|bus_station|community_centre|place_of_worship|parking|marketplace|police|fire_station)$"];
  nwr["historic"~"^(castle|monument|memorial)$"];
  nwr["railway"="station"];
  nwr["tourism"~"^(museum|gallery|attraction)$"];
  nwr["shop"="mall"];
  nwr["man_made"="bridge"]["name"];
  nwr["place"~"^(suburb|neighbourhood|quarter|hamlet|village)$"];
);
out geom;`;
}

/** Fetch OSM data from Overpass, caching the raw response on disk. */
export async function fetchOsm(cacheFile: string, refresh = false): Promise<OsmData> {
  if (!refresh && existsSync(cacheFile)) {
    const raw = JSON.parse(readFileSync(cacheFile, "utf8"));
    return { elements: raw.elements, timestamp: raw.osm3s?.timestamp_osm_base ?? null };
  }
  const body = new URLSearchParams({ data: overpassQuery() });
  let lastError = "";
  for (const url of ENDPOINTS) {
    try {
      console.log(`Downloading OpenStreetMap data from ${new URL(url).host} ...`);
      const res = await fetch(url, {
        method: "POST",
        body,
        headers: { "User-Agent": "AskKendal voxel build (civic project, Kendal)" },
        signal: AbortSignal.timeout(300_000),
      });
      if (!res.ok) {
        lastError = `${url}: HTTP ${res.status}`;
        continue;
      }
      const text = await res.text();
      const raw = JSON.parse(text);
      mkdirSync(dirname(cacheFile), { recursive: true });
      writeFileSync(cacheFile, text);
      console.log(`  ${raw.elements.length} elements, ${(text.length / 1e6).toFixed(1)} MB cached`);
      return { elements: raw.elements, timestamp: raw.osm3s?.timestamp_osm_base ?? null };
    } catch (err) {
      lastError = `${url}: ${(err as Error).message}`;
    }
  }
  throw new Error(`Could not download OpenStreetMap data. Last error: ${lastError}`);
}

const same = (a: LatLon, b: LatLon) => a.lat === b.lat && a.lon === b.lon;

/** Join a multipolygon's member ways into closed rings. Unclosable chains are closed by force. */
export function assembleRings(members: OsmMember[]): LatLon[][] {
  const pieces = members
    .filter((m) => m.type === "way" && m.geometry && m.geometry.length > 1 && (m.role === "outer" || m.role === "inner" || m.role === ""))
    .map((m) => [...(m.geometry as LatLon[])]);
  const rings: LatLon[][] = [];
  while (pieces.length) {
    let ring = pieces.shift() as LatLon[];
    let guard = 0;
    while (!same(ring[0], ring[ring.length - 1]) && guard++ < 10_000) {
      const end = ring[ring.length - 1];
      const idx = pieces.findIndex((p) => same(p[0], end) || same(p[p.length - 1], end));
      if (idx < 0) break;
      const next = pieces.splice(idx, 1)[0];
      if (!same(next[0], end)) next.reverse();
      ring = ring.concat(next.slice(1));
    }
    if (ring.length >= 3) rings.push(ring);
  }
  return rings;
}

export function isClosed(g: LatLon[] | undefined): boolean {
  return !!g && g.length >= 4 && same(g[0], g[g.length - 1]);
}
