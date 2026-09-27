/// <reference lib="webworker" />
/**
 * Voxel worker: downloads grid files, meshes chunks, and answers picking queries,
 * so the main thread only uploads finished buffers to the GPU.
 */
import { CHUNK, CLASS, HEIGHT } from "@askkendal/voxel/constants";
import { decodeGrid, gunzip, type FeatureInfo, type VoxelManifest } from "@askkendal/voxel/format";
import { meshChunk, OUTSIDE, type MeshBuffers } from "@askkendal/voxel/mesher";

export type Level = "d" | "l";

export type WorkerRequest =
  | { type: "init"; base: string; manifest: VoxelManifest }
  | { type: "mesh"; req: number; level: Level; cx: number; cz: number }
  | { type: "pick"; req: number; o: [number, number, number]; d: [number, number, number] }
  | { type: "water"; y: number };

export interface PickResult {
  hit: boolean;
  x?: number;
  y?: number;
  z?: number;
  cls?: number;
  feature?: FeatureInfo | null;
}

export type WorkerResponse =
  | { type: "mesh"; req: number; level: Level; cx: number; cz: number; land: MeshBuffers; water: MeshBuffers }
  | { type: "pick"; req: number; result: PickResult }
  | { type: "error"; req: number; message: string };

const ctx = self as unknown as DedicatedWorkerGlobalScope;

let base = "";
let manifest: VoxelManifest | null = null;
let waterY: number = HEIGHT.waterSurface;

const regionPromises = new Map<string, Promise<void>>();
const regions = new Map<string, { data: Uint8Array; w: number }>();
let lod: { data: Uint8Array; w: number; h: number } | null = null;
let lodPromise: Promise<void> | null = null;
const featurePromises = new Map<string, Promise<{ grid: Uint32Array; w: number; table: Record<string, FeatureInfo> } | null>>();

async function fetchBytes(path: string): Promise<Uint8Array> {
  const res = await fetch(`${base}/${path}`);
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
  return gunzip(await res.arrayBuffer());
}

function loadRegion(rx: number, rz: number): Promise<void> {
  const key = `${rx}_${rz}`;
  let p = regionPromises.get(key);
  if (!p) {
    p = fetchBytes(`d/r${key}.bin`).then((bytes) => {
      const g = decodeGrid(bytes);
      regions.set(key, { data: g.data as Uint8Array, w: g.width });
    });
    p.catch(() => regionPromises.delete(key));
    regionPromises.set(key, p);
  }
  return p;
}

function loadLod(): Promise<void> {
  if (!lodPromise) {
    lodPromise = fetchBytes(manifest!.lod.file).then((bytes) => {
      const g = decodeGrid(bytes);
      lod = { data: g.data as Uint8Array, w: g.width, h: g.height };
    });
    lodPromise.catch(() => (lodPromise = null));
  }
  return lodPromise;
}

function detailGet(x: number, z: number): number {
  const m = manifest!.detail;
  if (x < 0 || z < 0 || x >= m.width || z >= m.height) return OUTSIDE;
  const rx = Math.floor(x / m.region);
  const rz = Math.floor(z / m.region);
  const r = regions.get(`${rx}_${rz}`);
  if (!r) return CLASS.GROUND;
  return r.data[(z - rz * m.region) * r.w + (x - rx * m.region)];
}

function lodGet(x: number, z: number): number {
  if (!lod || x < 0 || z < 0 || x >= lod.w || z >= lod.h) return OUTSIDE;
  return lod.data[z * lod.w + x];
}

async function meshDetail(cx: number, cz: number) {
  const m = manifest!.detail;
  const x0 = cx * CHUNK;
  const z0 = cz * CHUNK;
  const sx = Math.min(CHUNK, m.width - x0);
  const sz = Math.min(CHUNK, m.height - z0);
  // Regions covering the chunk plus a one-cell border, so walls at region edges are right.
  const rx0 = Math.floor(Math.max(0, x0 - 1) / m.region);
  const rx1 = Math.floor(Math.min(m.width - 1, x0 + sx) / m.region);
  const rz0 = Math.floor(Math.max(0, z0 - 1) / m.region);
  const rz1 = Math.floor(Math.min(m.height - 1, z0 + sz) / m.region);
  const loads: Promise<void>[] = [];
  for (let rz = rz0; rz <= rz1; rz++) for (let rx = rx0; rx <= rx1; rx++) loads.push(loadRegion(rx, rz));
  await Promise.all(loads);
  return meshChunk({ cell: m.cell, x0, z0, sx, sz, get: detailGet });
}

async function meshLod(cx: number, cz: number) {
  await loadLod();
  const x0 = cx * CHUNK;
  const z0 = cz * CHUNK;
  return meshChunk({
    cell: manifest!.lod.cell,
    x0,
    z0,
    sx: Math.min(CHUNK, lod!.w - x0),
    sz: Math.min(CHUNK, lod!.h - z0),
    get: lodGet,
  });
}

function heightOf(cls: number): number {
  if (cls === CLASS.BUILDING) return HEIGHT.building;
  if (cls === CLASS.WATER) return waterY;
  return HEIGHT.land;
}

/** Class at a detail cell, falling back to the low-detail grid where a region is not loaded yet. */
function sampleClass(ix: number, iz: number): number {
  const m = manifest!.detail;
  if (ix < 0 || iz < 0 || ix >= m.width || iz >= m.height) return OUTSIDE;
  const r = regions.get(`${Math.floor(ix / m.region)}_${Math.floor(iz / m.region)}`);
  if (r) return r.data[(iz % m.region) * r.w + (ix % m.region)];
  const f = manifest!.lod.cell / m.cell;
  return lod ? lodGet(Math.floor(ix / f), Math.floor(iz / f)) : CLASS.GROUND;
}

interface Hit {
  ix: number;
  iz: number;
  cls: number;
  x: number;
  y: number;
  z: number;
}

/** Walk the height field along the ray (2D DDA over detail cells). Rays are steep, so this is a handful of steps. */
function pick(o: [number, number, number], d: [number, number, number]): Hit | null {
  const m = manifest!;
  const cell = m.detail.cell;
  if (d[1] >= 0) return null;
  const t0 = Math.max(0, (HEIGHT.building + 0.01 - o[1]) / d[1]);
  const t1 = (HEIGHT.waterFloor - 0.5 - o[1]) / d[1];
  const px = (o[0] + d[0] * t0 - m.gridMin.x) / cell;
  const pz = (o[2] + d[2] * t0 - m.gridMin.z) / cell;
  let ix = Math.floor(px);
  let iz = Math.floor(pz);
  const dx = d[0] / cell;
  const dz = d[2] / cell;
  const stepX = Math.sign(dx);
  const stepZ = Math.sign(dz);
  const tDeltaX = dx !== 0 ? Math.abs(1 / dx) : Infinity;
  const tDeltaZ = dz !== 0 ? Math.abs(1 / dz) : Infinity;
  let tMaxX = dx > 0 ? (ix + 1 - px) / dx : dx < 0 ? (px - ix) / -dx : Infinity;
  let tMaxZ = dz > 0 ? (iz + 1 - pz) / dz : dz < 0 ? (pz - iz) / -dz : Infinity;
  for (let step = 0; step < 512; step++) {
    const tExit = Math.min(t0 + Math.min(tMaxX, tMaxZ), t1);
    const cls = sampleClass(ix, iz);
    if (cls !== OUTSIDE) {
      const h = heightOf(cls);
      if (o[1] + d[1] * tExit <= h) {
        return { ix, iz, cls, x: m.gridMin.x + (ix + 0.5) * cell, y: h, z: m.gridMin.z + (iz + 0.5) * cell };
      }
    }
    if (tExit >= t1) break;
    if (tMaxX < tMaxZ) {
      ix += stepX;
      tMaxX += tDeltaX;
    } else {
      iz += stepZ;
      tMaxZ += tDeltaZ;
    }
  }
  return null;
}

async function featureAt(ix: number, iz: number): Promise<FeatureInfo | null> {
  const m = manifest!.detail;
  const rx = Math.floor(ix / m.region);
  const rz = Math.floor(iz / m.region);
  const key = `${rx}_${rz}`;
  let p = featurePromises.get(key);
  if (!p) {
    p = Promise.all([
      fetchBytes(`f/r${key}.bin`),
      fetch(`${base}/f/r${key}.json`).then((r) => (r.ok ? r.json() : {})),
    ])
      .then(([bytes, table]) => {
        const g = decodeGrid(bytes);
        return { grid: g.data as Uint32Array, w: g.width, table: table as Record<string, FeatureInfo> };
      })
      .catch(() => null);
    featurePromises.set(key, p);
  }
  const f = await p;
  if (!f) return null;
  const id = f.grid[(iz - rz * m.region) * f.w + (ix - rx * m.region)];
  return id ? (f.table[id] ?? null) : null;
}

function transfer(m: { land: MeshBuffers; water: MeshBuffers }): Transferable[] {
  return [m.land, m.water].flatMap((b) => [b.positions.buffer, b.colors.buffer, b.indices.buffer]) as Transferable[];
}

ctx.onmessage = async (ev: MessageEvent<WorkerRequest>) => {
  const msg = ev.data;
  try {
    if (msg.type === "init") {
      base = msg.base;
      manifest = msg.manifest;
      void loadLod();
      return;
    }
    if (msg.type === "water") {
      waterY = msg.y;
      return;
    }
    if (msg.type === "mesh") {
      const mesh = msg.level === "d" ? await meshDetail(msg.cx, msg.cz) : await meshLod(msg.cx, msg.cz);
      const out: WorkerResponse = { type: "mesh", req: msg.req, level: msg.level, cx: msg.cx, cz: msg.cz, ...mesh };
      ctx.postMessage(out, transfer(mesh));
      return;
    }
    if (msg.type === "pick") {
      const h = pick(msg.o, msg.d);
      let result: PickResult = { hit: false };
      if (h) {
        const regionLoaded = regions.has(`${Math.floor(h.ix / manifest!.detail.region)}_${Math.floor(h.iz / manifest!.detail.region)}`);
        result = { hit: true, x: h.x, y: h.y, z: h.z, cls: h.cls, feature: regionLoaded ? await featureAt(h.ix, h.iz) : null };
      }
      ctx.postMessage({ type: "pick", req: msg.req, result } satisfies WorkerResponse);
    }
  } catch (err) {
    const req = "req" in msg ? msg.req : -1;
    ctx.postMessage({ type: "error", req, message: (err as Error).message } satisfies WorkerResponse);
  }
};
