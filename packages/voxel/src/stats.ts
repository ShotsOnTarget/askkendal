/**
 * Measure the built voxel town against the performance budget.
 *   pnpm voxel:stats   exits non-zero if a budget is exceeded (use in CI)
 */
import { gunzipSync } from "node:zlib";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { CHUNK } from "./constants";
import { decodeGrid, type VoxelManifest } from "./format";
import { meshBytes, meshChunk, OUTSIDE } from "./mesher";

// Budgets sit at roughly twice the Kendal build of September 2026 (0.33 MB, 146k LOD triangles,
// 85k triangles and 2 MB in the worst 1 km window), so a regression fails CI long before phones notice.
const BUDGET = {
  /** Everything the first view needs: manifest, labels, LOD, all detail regions. */
  payloadBytes: 1.5 * 1024 * 1024,
  /** Whole town at low detail: what a phone draws when zoomed out. */
  lodTriangles: 300_000,
  /** Worst 8 x 8 chunk window (about 1 km square) at full detail: a zoomed-in view. */
  windowTriangles: 250_000,
  /** GPU memory for that worst window. */
  windowGpuBytes: 16 * 1024 * 1024,
};

const here = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(here, "../../../apps/web/public/voxel");
const manifest = JSON.parse(readFileSync(resolve(OUT, "manifest.json"), "utf8")) as VoxelManifest;

const size = (p: string) => statSync(resolve(OUT, p)).size;
const detailFiles = readdirSync(resolve(OUT, "d"));
const payload =
  size("manifest.json") + size("labels.json") + size(manifest.lod.file) + detailFiles.reduce((s, f) => s + size(`d/${f}`), 0);

// Assemble the full detail grid.
const { width: W, height: H, region } = manifest.detail;
const detail = new Uint8Array(W * H);
for (const f of detailFiles) {
  const g = decodeGrid(gunzipSync(readFileSync(resolve(OUT, "d", f))));
  for (let z = 0; z < g.height; z++) detail.set((g.data as Uint8Array).subarray(z * g.width, (z + 1) * g.width), (g.z0 + z) * W + g.x0);
}
const lodGrid = decodeGrid(gunzipSync(readFileSync(resolve(OUT, manifest.lod.file))));

function meshAll(grid: Uint8Array, w: number, h: number, cell: number) {
  const get = (x: number, z: number) => (x < 0 || z < 0 || x >= w || z >= h ? OUTSIDE : grid[z * w + x]);
  const cx = Math.ceil(w / CHUNK);
  const cz = Math.ceil(h / CHUNK);
  const tris = new Float64Array(cx * cz);
  const bytes = new Float64Array(cx * cz);
  const t0 = performance.now();
  for (let j = 0; j < cz; j++) {
    for (let i = 0; i < cx; i++) {
      const m = meshChunk({
        cell,
        x0: i * CHUNK,
        z0: j * CHUNK,
        sx: Math.min(CHUNK, w - i * CHUNK),
        sz: Math.min(CHUNK, h - j * CHUNK),
        get,
      });
      tris[j * cx + i] = (m.land.quads + m.water.quads) * 2;
      bytes[j * cx + i] = meshBytes(m);
    }
  }
  return { cx, cz, tris, bytes, ms: performance.now() - t0 };
}

const d = meshAll(detail, W, H, manifest.detail.cell);
const l = meshAll(lodGrid.data as Uint8Array, lodGrid.width, lodGrid.height, manifest.lod.cell);

const sum = (a: Float64Array) => a.reduce((s, v) => s + v, 0);
let worst = { tris: 0, bytes: 0, at: "" };
const WIN = 8;
for (let j = 0; j + WIN <= d.cz; j++) {
  for (let i = 0; i + WIN <= d.cx; i++) {
    let t = 0;
    let b = 0;
    for (let dj = 0; dj < WIN; dj++) for (let di = 0; di < WIN; di++) {
      t += d.tris[(j + dj) * d.cx + i + di];
      b += d.bytes[(j + dj) * d.cx + i + di];
    }
    if (t > worst.tris) worst = { tris: t, bytes: b, at: `chunks ${i},${j}` };
  }
}

const fmt = (n: number) => n.toLocaleString("en-GB");
const mb = (n: number) => `${(n / 1024 / 1024).toFixed(2)} MB`;
const rows: Array<[string, string, string, boolean]> = [
  ["Payload (first view, gzipped)", mb(payload), mb(BUDGET.payloadBytes), payload <= BUDGET.payloadBytes],
  ["LOD triangles (whole town)", fmt(sum(l.tris)), fmt(BUDGET.lodTriangles), sum(l.tris) <= BUDGET.lodTriangles],
  [`Worst 1 km window triangles (${worst.at})`, fmt(worst.tris), fmt(BUDGET.windowTriangles), worst.tris <= BUDGET.windowTriangles],
  ["Worst 1 km window GPU memory", mb(worst.bytes), mb(BUDGET.windowGpuBytes), worst.bytes <= BUDGET.windowGpuBytes],
];
console.log(`Detail: ${d.cx * d.cz} chunks, ${fmt(sum(d.tris))} triangles in total, max ${fmt(Math.max(...d.tris))} per chunk, meshed in ${d.ms.toFixed(0)} ms`);
console.log(`LOD:    ${l.cx * l.cz} chunks, ${fmt(sum(l.tris))} triangles, meshed in ${l.ms.toFixed(0)} ms`);
console.log(`Regions: ${detailFiles.length} files of ${region} x ${region} cells\n`);
for (const [name, value, budget, ok] of rows) console.log(`${ok ? "PASS" : "FAIL"}  ${name.padEnd(46)} ${value.padStart(12)}  budget ${budget}`);
if (rows.some((r) => !r[3])) {
  console.error("\nOver budget.");
  process.exit(1);
}
