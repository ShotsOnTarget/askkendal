import { gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { CLASS, HEIGHT, POS_SCALE } from "../src/constants";
import { decodeGrid, encodeClassGrid, encodeFeatureGrid, gunzip } from "../src/format";
import { downsampleLod } from "../src/lod";
import { meshChunk, OUTSIDE } from "../src/mesher";
import { toLatLon, toWorld } from "../src/project";
import { fillRings, strokePath } from "../src/raster";

function gridGetter(rows: string[]) {
  // G ground, g grass, r road, w water, B building, . outside the map
  const map: Record<string, number> = { G: 0, g: 1, r: 2, w: 3, B: 4, ".": OUTSIDE };
  return (x: number, z: number) => {
    const row = rows[z];
    if (!row || x < 0 || x >= row.length) return CLASS.GROUND;
    return map[row[x]];
  };
}

describe("grid files", () => {
  it("round-trips class and feature grids through RLE and gzip", async () => {
    const data = new Uint8Array(100 * 30);
    data.fill(CLASS.GRASS, 200, 900);
    data.fill(CLASS.BUILDING, 1500, 1510);
    const header = { cell: 2, x0: 512, z0: 1024, width: 100, height: 30 };
    const bytes = encodeClassGrid(header, data);
    expect(bytes.length).toBeLessThan(60);
    const back = decodeGrid(await gunzip(gzipSync(bytes)));
    expect(back).toMatchObject({ ...header, kind: 0 });
    expect(Array.from(back.data)).toEqual(Array.from(data));

    const feats = new Uint32Array(100 * 30);
    feats.fill(123456, 10, 20);
    feats.fill(7, 2000, 2999);
    const fb = decodeGrid(encodeFeatureGrid(header, feats));
    expect(fb.kind).toBe(1);
    expect(Array.from(fb.data)).toEqual(Array.from(feats));
  });
});

describe("rasteriser", () => {
  it("fills a square and leaves a hole for an inner ring", () => {
    const set = new Set<number>();
    const outer: Array<[number, number]> = [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]];
    const inner: Array<[number, number]> = [[4, 4], [6, 4], [6, 6], [4, 6], [4, 4]];
    const n = fillRings([outer, inner], 20, 20, (i) => set.add(i));
    expect(n).toBe(100 - 4);
    expect(set.has(5 * 20 + 5)).toBe(false);
    expect(set.has(1 * 20 + 1)).toBe(true);
  });

  it("strokes a connected line", () => {
    const set = new Set<number>();
    strokePath([[0.5, 0.5], [9.5, 9.5]], 0.5, 10, 10, (i) => set.add(i));
    for (let k = 0; k < 10; k++) expect(set.has(k * 10 + k)).toBe(true);
  });
});

describe("mesher", () => {
  it("builds one top face and four walls for a lone building", () => {
    const m = meshChunk({ cell: 2, x0: 0, z0: 0, sx: 3, sz: 3, get: gridGetter(["GGG", "GBG", "GGG"]) });
    // Ground top faces: the ring of 8 ground cells merges into 4 rectangles, plus 1 roof.
    expect(m.land.quads).toBe(4 + 1 + 4);
    expect(m.water.quads).toBe(0);
    const ys = new Set<number>();
    for (let i = 1; i < m.land.positions.length; i += 3) ys.add(m.land.positions[i] / POS_SCALE);
    expect(ys).toEqual(new Set([0, HEIGHT.building]));
  });

  it("merges a row of buildings into one roof and one long wall per side", () => {
    const m = meshChunk({ cell: 2, x0: 0, z0: 0, sx: 4, sz: 1, get: gridGetter(["BBBB"]) });
    expect(m.land.quads).toBe(1 + 4);
  });

  it("puts water in its own mesh and cuts banks down to the river floor", () => {
    const m = meshChunk({ cell: 2, x0: 0, z0: 0, sx: 3, sz: 1, get: gridGetter(["GwG"]) });
    expect(m.water.quads).toBe(1);
    const ys = new Set<number>();
    for (let i = 1; i < m.land.positions.length; i += 3) ys.add(m.land.positions[i] / POS_SCALE);
    expect(ys.has(HEIGHT.waterFloor)).toBe(true);
  });

  it("adds an earth skirt at the edge of the map", () => {
    // Cell x=1 is ground; its west neighbour is outside the map.
    const edge = meshChunk({ cell: 2, x0: 1, z0: 0, sx: 1, sz: 1, get: gridGetter([".G"]) });
    expect(edge.land.quads).toBe(2); // top face + one skirt wall
    const ys = new Set<number>();
    for (let i = 1; i < edge.land.positions.length; i += 3) ys.add(edge.land.positions[i] / POS_SCALE);
    expect(ys.has(HEIGHT.skirt)).toBe(true);
  });

  it("uses 32-bit indices only when needed", () => {
    const m = meshChunk({ cell: 2, x0: 0, z0: 0, sx: 2, sz: 2, get: gridGetter(["BG", "GB"]) });
    expect(m.land.indices).toBeInstanceOf(Uint16Array);
  });
});

describe("LOD and projection", () => {
  it("keeps buildings and roads visible when downsampling", () => {
    const src = new Uint8Array(16 * 4);
    for (let x = 0; x < 16; x++) src[x] = CLASS.ROAD; // one row of road in each 4x4 block: too thin alone
    for (let z = 1; z < 4; z++) src.fill(CLASS.BUILDING, z * 16 + 8, z * 16 + 12); // 12 of 16 cells
    const lod = downsampleLod(src, 16, 4, 4);
    expect(lod.width).toBe(4);
    expect(Array.from(lod.data)).toEqual([CLASS.GROUND, CLASS.GROUND, CLASS.BUILDING, CLASS.GROUND]);
  });

  it("projects to metres and back", () => {
    const w = toWorld(54.3286, -2.7466);
    const back = toLatLon(w.x, w.z);
    expect(back.lat).toBeCloseTo(54.3286, 6);
    expect(back.lon).toBeCloseTo(-2.7466, 6);
    const north = toWorld(54.3386, -2.7466);
    expect(w.z - north.z).toBeGreaterThan(1100);
    expect(w.z - north.z).toBeLessThan(1125);
  });
});
