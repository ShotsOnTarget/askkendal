/**
 * Build the voxel Kendal from OpenStreetMap.
 *
 *   pnpm voxel:build            use the cached OSM download if present
 *   pnpm voxel:build --refresh  download fresh OSM data
 *
 * Writes to apps/web/public/voxel/ (served as static files) and packages/voxel/data/gazetteer.json.
 */
import { gzipSync } from "node:zlib";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { BBOX, CHUNK, CLASS, DETAIL_CELL, HEIGHT, LOD_CELL, LOD_FACTOR, ORIGIN, REGION } from "./constants";
import { encodeClassGrid, encodeFeatureGrid, type FeatureInfo, type VoxelLabel, type VoxelManifest } from "./format";
import { downsampleLod } from "./lod";
import { assembleRings, fetchOsm, isClosed, type LatLon, type OsmElement } from "./osm";
import { GRID_MIN, gridSize, toWorld } from "./project";
import { fillRings, pathLength, pathMidpoint, ringCentroid, strokePath, type Pt } from "./raster";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../../..");
const OUT = resolve(root, "apps/web/public/voxel");
const GAZETTEER = resolve(here, "../data/gazetteer.json");
const CACHE = resolve(here, "../.cache/kendal-osm.json");

const refresh = process.argv.includes("--refresh");
const osm = await fetchOsm(CACHE, refresh);

const { width: W, height: H } = gridSize(DETAIL_CELL);
console.log(`Grid ${W} x ${H} cells of ${DETAIL_CELL} m (${((W * H) / 1e6).toFixed(1)} M cells)`);

const classes = new Uint8Array(W * H); // CLASS.GROUND = 0
const features = new Uint32Array(W * H);
const roadNames = new Uint32Array(W * H);
const table: FeatureInfo[] = [{ t: "g", o: "" }]; // index 0 = no feature

const toGrid = (p: LatLon): Pt => {
  const w = toWorld(p.lat, p.lon);
  return [(w.x - GRID_MIN.x) / DETAIL_CELL, (w.z - GRID_MIN.z) / DETAIL_CELL];
};
const osmId = (e: OsmElement) => `${e.type[0]}${e.id}`;

function polygonRings(e: OsmElement): Pt[][] | null {
  if (e.type === "way" && isClosed(e.geometry)) return [e.geometry!.map(toGrid)];
  if (e.type === "relation" && e.tags?.type === "multipolygon" && e.members) {
    const rings = assembleRings(e.members);
    return rings.length ? rings.map((r) => r.map(toGrid)) : null;
  }
  return null;
}

function addFeature(info: FeatureInfo): number {
  table.push(info);
  return table.length - 1;
}

// --- Classify elements ---------------------------------------------------------------------
const GRASS_LANDUSE = /^(grass|meadow|recreation_ground|village_green|farmland|forest|allotments|cemetery|orchard|greenfield|plant_nursery)$/;
const GRASS_LEISURE = /^(park|pitch|golf_course|garden|playground|nature_reserve|common|recreation_ground|dog_park)$/;
const GRASS_NATURAL = /^(wood|scrub|grassland|heath|wetland|fell)$/;
const ROAD_WIDTH: Record<string, number> = {
  motorway: 14, trunk: 12, primary: 11, secondary: 10, tertiary: 9, unclassified: 7, residential: 7,
  living_street: 6, road: 6, service: 4, pedestrian: 5, busway: 6, construction: 6,
  motorway_link: 8, trunk_link: 8, primary_link: 8, secondary_link: 7, tertiary_link: 7,
};
const PATH_WIDTH: Record<string, number> = { footway: 2, path: 2, cycleway: 2, bridleway: 2, steps: 2, track: 3 };
const WATERWAY_WIDTH: Record<string, number> = { river: 14, canal: 8, stream: 3, brook: 3, drain: 2, ditch: 2 };

const grass: OsmElement[] = [];
const waterAreas: OsmElement[] = [];
const waterLines: OsmElement[] = [];
const paths: OsmElement[] = [];
const roads: OsmElement[] = [];
const buildings: OsmElement[] = [];

for (const e of osm.elements) {
  const t = e.tags ?? {};
  if (e.type === "node") continue;
  const tunnel = t.tunnel === "yes" || t.tunnel === "culvert";
  if (t.building && t.building !== "no") buildings.push(e);
  else if (t.natural === "water" || t.waterway === "riverbank" || t.landuse === "reservoir" || t.landuse === "basin") waterAreas.push(e);
  else if (t.waterway && WATERWAY_WIDTH[t.waterway] && e.type === "way" && !tunnel) waterLines.push(e);
  else if (t.highway && e.type === "way" && !tunnel) {
    if (PATH_WIDTH[t.highway]) paths.push(e);
    else if (ROAD_WIDTH[t.highway]) roads.push(e);
  } else if (t.railway && /^(rail|light_rail|narrow_gauge)$/.test(t.railway) && e.type === "way" && !tunnel) roads.push(e);
  else if (GRASS_LANDUSE.test(t.landuse ?? "") || GRASS_LEISURE.test(t.leisure ?? "") || GRASS_NATURAL.test(t.natural ?? "")) grass.push(e);
}

// --- Rasterise in paint order: grass, water, paths, roads, buildings ----------------------------
for (const e of grass) {
  const rings = polygonRings(e);
  if (!rings) continue;
  const name = e.tags?.name;
  const fid = name ? addFeature({ t: "g", n: name, o: osmId(e) }) : 0;
  fillRings(rings, W, H, (i) => {
    classes[i] = CLASS.GRASS;
    features[i] = fid;
  });
}

for (const e of waterAreas) {
  const rings = polygonRings(e);
  if (!rings) continue;
  const name = e.tags?.name;
  const fid = name ? addFeature({ t: "w", n: name, o: osmId(e) }) : 0;
  fillRings(rings, W, H, (i) => {
    classes[i] = CLASS.WATER;
    if (fid || !features[i]) features[i] = fid;
  });
}
for (const e of waterLines) {
  const name = e.tags?.name;
  const fid = name ? addFeature({ t: "w", n: name, o: osmId(e) }) : 0;
  const half = WATERWAY_WIDTH[e.tags!.waterway] / DETAIL_CELL / 2;
  strokePath(e.geometry!.map(toGrid), half, W, H, (i) => {
    classes[i] = CLASS.WATER;
    features[i] = fid;
  });
}

for (const e of paths) {
  const half = PATH_WIDTH[e.tags!.highway] / DETAIL_CELL / 2;
  strokePath(e.geometry!.map(toGrid), half, W, H, (i) => {
    classes[i] = CLASS.GROUND;
    features[i] = 0;
  });
}

for (const e of roads) {
  const t = e.tags!;
  const width = t.railway ? 4 : ROAD_WIDTH[t.highway];
  const name = t.name;
  const fid = name ? addFeature({ t: "r", n: name, o: osmId(e) }) : 0;
  const paint = (i: number) => {
    classes[i] = CLASS.ROAD;
    features[i] = fid;
    if (fid) roadNames[i] = fid;
  };
  if (t.area === "yes" && isClosed(e.geometry)) fillRings([e.geometry!.map(toGrid)], W, H, paint);
  else strokePath(e.geometry!.map(toGrid), width / DETAIL_CELL / 2, W, H, paint);
}

const buildingCentroids: Array<[number, Pt]> = [];
for (const e of buildings) {
  const rings = polygonRings(e);
  if (!rings) continue;
  const t = e.tags!;
  const fid = addFeature({
    t: "b",
    ...(t.name || t["addr:housename"] ? { n: t.name ?? t["addr:housename"] } : {}),
    ...(t["addr:street"] ? { s: t["addr:street"] } : {}),
    o: osmId(e),
  });
  const n = fillRings(rings, W, H, (i) => {
    classes[i] = CLASS.BUILDING;
    features[i] = fid;
  });
  const c = ringCentroid(rings[0]);
  if (n === 0) {
    // Smaller than a cell: keep it as one block rather than losing it.
    const i = Math.floor(c[0]);
    const j = Math.floor(c[1]);
    if (i >= 0 && j >= 0 && i < W && j < H) {
      classes[j * W + i] = CLASS.BUILDING;
      features[j * W + i] = fid;
    }
  }
  buildingCentroids.push([fid, c]);
}

// Buildings without an address get the nearest named road within ~50 m.
let streetsFound = 0;
for (const [fid, [cx, cy]] of buildingCentroids) {
  if (table[fid].s) continue;
  const ci = Math.floor(cx);
  const cj = Math.floor(cy);
  let best = 0;
  let bestD = Infinity;
  for (let r = 1; r <= 25 && !best; r++) {
    for (let dj = -r; dj <= r; dj++) {
      for (let di = -r; di <= r; di++) {
        if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue;
        const i = ci + di;
        const j = cj + dj;
        if (i < 0 || j < 0 || i >= W || j >= H) continue;
        const rid = roadNames[j * W + i];
        if (rid) {
          const d = di * di + dj * dj;
          if (d < bestD) {
            bestD = d;
            best = rid;
          }
        }
      }
    }
  }
  if (best) {
    table[fid].s = table[best].n;
    streetsFound++;
  }
}
console.log(
  `Features: ${buildings.length} buildings (${streetsFound} matched to a nearby street), ${roads.length} roads/rail, ` +
    `${paths.length} paths, ${waterAreas.length + waterLines.length} water, ${grass.length} green areas`,
);

// --- Write outputs -------------------------------------------------------------------------------
rmSync(OUT, { recursive: true, force: true });
mkdirSync(resolve(OUT, "d"), { recursive: true });
mkdirSync(resolve(OUT, "f"), { recursive: true });

const gz = (b: Uint8Array) => gzipSync(b, { level: 9 });
let detailBytes = 0;
let featureBytes = 0;
const regions: Array<[number, number]> = [];
const RX = Math.ceil(W / REGION);
const RZ = Math.ceil(H / REGION);
for (let rz = 0; rz < RZ; rz++) {
  for (let rx = 0; rx < RX; rx++) {
    const x0 = rx * REGION;
    const z0 = rz * REGION;
    const w = Math.min(REGION, W - x0);
    const h = Math.min(REGION, H - z0);
    const cls = new Uint8Array(w * h);
    const feat = new Uint32Array(w * h);
    const used = new Set<number>();
    for (let z = 0; z < h; z++) {
      cls.set(classes.subarray((z0 + z) * W + x0, (z0 + z) * W + x0 + w), z * w);
      feat.set(features.subarray((z0 + z) * W + x0, (z0 + z) * W + x0 + w), z * w);
    }
    for (const f of feat) if (f) used.add(f);
    const header = { cell: DETAIL_CELL, x0, z0, width: w, height: h };
    const classFile = gz(encodeClassGrid(header, cls));
    const featFile = gz(encodeFeatureGrid(header, feat));
    const featTable: Record<number, FeatureInfo> = {};
    for (const f of used) featTable[f] = table[f];
    const featJson = JSON.stringify(featTable);
    writeFileSync(resolve(OUT, `d/r${rx}_${rz}.bin`), classFile);
    writeFileSync(resolve(OUT, `f/r${rx}_${rz}.bin`), featFile);
    writeFileSync(resolve(OUT, `f/r${rx}_${rz}.json`), featJson);
    detailBytes += classFile.length;
    featureBytes += featFile.length + gzipSync(featJson).length;
    regions.push([rx, rz]);
  }
}

const lod = downsampleLod(classes, W, H, LOD_FACTOR);
const lodFile = gz(encodeClassGrid({ cell: LOD_CELL, x0: 0, z0: 0, width: lod.width, height: lod.height }, lod.data));
writeFileSync(resolve(OUT, "lod.bin"), lodFile);

// --- Labels and gazetteer --------------------------------------------------------------------
type Place = { name: string; kind: string; lat: number; lon: number; length?: number };
const centreOf = (e: OsmElement): LatLon | null => {
  if (e.type === "node" && e.lat !== undefined) return { lat: e.lat, lon: e.lon! };
  if (e.bounds) return { lat: (e.bounds.minlat + e.bounds.maxlat) / 2, lon: (e.bounds.minlon + e.bounds.maxlon) / 2 };
  if (e.geometry?.length) {
    const g = e.geometry;
    return { lat: g.reduce((s, p) => s + p.lat, 0) / g.length, lon: g.reduce((s, p) => s + p.lon, 0) / g.length };
  }
  return null;
};
const midpointOf = (g: LatLon[]): LatLon => {
  const pts = g.map((p) => [p.lon, p.lat] as Pt);
  const [lon, lat] = pathMidpoint(pts);
  return { lat, lon };
};

const streets = new Map<string, Place & { type: string; total: number }>();
const ROAD_RANK: Record<string, number> = { trunk: 1, primary: 1, secondary: 2, tertiary: 3, unclassified: 4, residential: 4, living_street: 5, pedestrian: 4 };
for (const e of osm.elements) {
  const t = e.tags;
  if (e.type !== "way" || !t?.highway || !t.name || !e.geometry) continue;
  const len = pathLength(e.geometry.map((p) => [p.lon * 65000, p.lat * 111250] as Pt));
  const prev = streets.get(t.name);
  const mid = midpointOf(e.geometry);
  if (!prev) streets.set(t.name, { name: t.name, kind: "street in Kendal", ...mid, length: len, total: len, type: t.highway });
  else {
    prev.total += len;
    if (len > (prev.length ?? 0)) Object.assign(prev, mid, { length: len });
    if ((ROAD_RANK[t.highway] ?? 9) < (ROAD_RANK[prev.type] ?? 9)) prev.type = t.highway;
  }
}

const landmarks: Place[] = [];
const LANDMARK_KIND: Array<[string, RegExp, string]> = [
  ["amenity", /^(townhall|hospital|library|college|university|theatre|arts_centre|bus_station|community_centre|police|fire_station|marketplace)$/, "public building"],
  ["amenity", /^school$/, "school"],
  ["amenity", /^place_of_worship$/, "church or place of worship"],
  ["amenity", /^parking$/, "car park"],
  ["historic", /^(castle|monument|memorial)$/, "historic site"],
  ["railway", /^station$/, "railway station"],
  ["tourism", /^(museum|gallery|attraction)$/, "museum or attraction"],
  ["shop", /^mall$/, "shopping centre"],
  ["man_made", /^bridge$/, "bridge"],
  ["leisure", /^(park|nature_reserve|recreation_ground|sports_centre|golf_course)$/, "park or leisure site"],
];
const places: Place[] = [];
for (const e of osm.elements) {
  const t = e.tags;
  if (!t?.name) continue;
  if (t.place) {
    const c = centreOf(e);
    if (c) places.push({ name: t.name, kind: "area of Kendal", ...c });
    continue;
  }
  const hit = LANDMARK_KIND.find(([k, re]) => t[k] && re.test(t[k]));
  if (hit) {
    const c = centreOf(e);
    if (c) landmarks.push({ name: t.name, kind: hit[2], ...c });
  } else if (t.building && t.building !== "no") {
    const c = centreOf(e);
    if (c) landmarks.push({ name: t.name, kind: "building", ...c });
  }
}
const rivers = new Map<string, Place>();
for (const e of osm.elements) {
  const t = e.tags;
  if (e.type === "way" && t?.waterway && t.name && e.geometry) {
    const len = pathLength(e.geometry.map((p) => [p.lon * 65000, p.lat * 111250] as Pt));
    const prev = rivers.get(t.name);
    if (!prev || len > (prev.length ?? 0)) rivers.set(t.name, { name: t.name, kind: "river or beck", ...midpointOf(e.geometry), length: len });
  }
}

const inBox = (p: LatLon) => p.lat >= BBOX.south && p.lat <= BBOX.north && p.lon >= BBOX.west && p.lon <= BBOX.east;
const labels: VoxelLabel[] = [];
const pushLabel = (p: Place, k: VoxelLabel["k"], prio: number) => {
  if (!inBox(p)) return;
  const w = toWorld(p.lat, p.lon);
  labels.push({ n: p.name, x: Math.round(w.x), z: Math.round(w.z), k, p: prio });
};
for (const s of streets.values()) {
  const rank = ROAD_RANK[s.type] ?? 9;
  if (rank <= 3) pushLabel(s, "road", rank + 1);
  else if (rank <= 5 && s.total > 350) pushLabel(s, "road", 5);
}
const seenLandmark = new Set<string>();
for (const l of landmarks) {
  if (seenLandmark.has(l.name) || /car park|school|place of worship|building/.test(l.kind)) continue;
  seenLandmark.add(l.name);
  pushLabel(l, "landmark", 2);
}
for (const p of places) pushLabel(p, "place", 1);
for (const r of rivers.values()) if (/^River /.test(r.name)) pushLabel(r, "water", 1);
labels.sort((a, b) => a.p - b.p);
writeFileSync(resolve(OUT, "labels.json"), JSON.stringify(labels));

// Gazetteer for placing documents on the map. Short or generic names are left out.
const GENERIC = new Set(["Kendal", "Main Street", "Back Lane", "Church Street", "The Green", "Station Road"]);
const gazetteer = new Map<string, Place>();
const addPlace = (p: Place) => {
  if (p.name.length < 5 || GENERIC.has(p.name) || !inBox(p) || gazetteer.has(p.name)) return;
  gazetteer.set(p.name, { name: p.name, kind: p.kind, lat: +p.lat.toFixed(6), lon: +p.lon.toFixed(6) });
};
landmarks.forEach(addPlace);
[...streets.values()].forEach(addPlace);
places.forEach(addPlace);
[...rivers.values()].forEach(addPlace);
mkdirSync(dirname(GAZETTEER), { recursive: true });
writeFileSync(GAZETTEER, JSON.stringify([...gazetteer.values()], null, 0));

const manifest: VoxelManifest = {
  version: 1,
  builtAt: new Date().toISOString(),
  osmTimestamp: osm.timestamp,
  attribution: "© OpenStreetMap contributors (ODbL)",
  origin: { lat: ORIGIN.lat, lon: ORIGIN.lon },
  bbox: { ...BBOX },
  gridMin: { x: GRID_MIN.x, z: GRID_MIN.z },
  detail: { cell: DETAIL_CELL, width: W, height: H, region: REGION, chunk: CHUNK, regions },
  lod: { cell: LOD_CELL, width: lod.width, height: lod.height, chunk: CHUNK, file: "lod.bin" },
  heights: {
    building: HEIGHT.building,
    waterFloor: HEIGHT.waterFloor,
    waterSurface: HEIGHT.waterSurface,
    waterMin: HEIGHT.waterMin,
    waterMax: HEIGHT.waterMax,
    skirt: HEIGHT.skirt,
  },
};
writeFileSync(resolve(OUT, "manifest.json"), JSON.stringify(manifest, null, 2));

const kb = (n: number) => `${(n / 1024).toFixed(0)} KB`;
console.log(`Wrote ${regions.length} regions: detail ${kb(detailBytes)}, LOD ${kb(lodFile.length)}, features (loaded on click) ${kb(featureBytes)}`);
console.log(`Labels: ${labels.length}. Gazetteer: ${gazetteer.size} places -> ${GAZETTEER}`);
