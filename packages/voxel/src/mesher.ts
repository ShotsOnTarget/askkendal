import { CLASS, COLORS, HEIGHT, POS_SCALE, SHADE } from "./constants";

/**
 * Greedy mesher for the 2.5D voxel grid. Pure and browser-safe: it runs in a Web Worker
 * in the viewer and in Node for `pnpm voxel:stats`.
 *
 * Every cell has one class and therefore one top height, so the scene is a height field:
 * - top faces: same-class cells merge into the largest rectangles we can find;
 * - walls: only where a neighbour is lower, merged along each row;
 * - water top faces go into a separate mesh so the river layer can raise or lower it.
 * Colours are baked per face (fixed light), so the material needs no lighting.
 */

/** Returned by `get` for cells outside the map: the edge gets an earth "skirt". */
export const OUTSIDE = -1;

export interface MeshInput {
  /** Metres per cell. */
  cell: number;
  /** Chunk origin, in global grid cells. */
  x0: number;
  z0: number;
  /** Chunk size in cells (smaller at the far edges of the map). */
  sx: number;
  sz: number;
  /** Class at a global cell, or OUTSIDE. Must answer for the chunk and a one-cell border. */
  get(x: number, z: number): number;
}

export interface MeshBuffers {
  /** xyz per vertex, chunk-local, units of 1/POS_SCALE metre. */
  positions: Int16Array;
  /** rgb per vertex, sRGB bytes. */
  colors: Uint8Array;
  indices: Uint16Array | Uint32Array;
  quads: number;
}

export interface ChunkMesh {
  land: MeshBuffers;
  water: MeshBuffers;
}

class QuadBuilder {
  private pos: Int16Array;
  private col: Uint8Array;
  quads = 0;

  constructor(capacity = 256) {
    this.pos = new Int16Array(capacity * 12);
    this.col = new Uint8Array(capacity * 12);
  }

  private grow() {
    const pos = new Int16Array(this.pos.length * 2);
    pos.set(this.pos);
    this.pos = pos;
    const col = new Uint8Array(this.col.length * 2);
    col.set(this.col);
    this.col = col;
  }

  /** Four corners in metres, counter-clockwise seen from the front. */
  push(v: readonly number[], r: number, g: number, b: number) {
    if ((this.quads + 1) * 12 > this.pos.length) this.grow();
    const o = this.quads * 12;
    for (let i = 0; i < 12; i++) this.pos[o + i] = Math.round(v[i] * POS_SCALE);
    for (let i = 0; i < 4; i++) {
      this.col[o + i * 3] = r;
      this.col[o + i * 3 + 1] = g;
      this.col[o + i * 3 + 2] = b;
    }
    this.quads++;
  }

  finish(): MeshBuffers {
    const verts = this.quads * 4;
    const indices = verts > 65535 ? new Uint32Array(this.quads * 6) : new Uint16Array(this.quads * 6);
    for (let q = 0; q < this.quads; q++) {
      const b = q * 4;
      const o = q * 6;
      indices[o] = b;
      indices[o + 1] = b + 1;
      indices[o + 2] = b + 2;
      indices[o + 3] = b;
      indices[o + 4] = b + 2;
      indices[o + 5] = b + 3;
    }
    return {
      positions: this.pos.slice(0, this.quads * 12),
      colors: this.col.slice(0, this.quads * 12),
      indices,
      quads: this.quads,
    };
  }
}

export function topHeight(c: number): number {
  if (c === CLASS.BUILDING) return HEIGHT.building;
  if (c === CLASS.WATER) return HEIGHT.waterFloor;
  return HEIGHT.land;
}

// Wall colour ids: 0..4 = side colour of that class, 10 = earth.
const EARTH = 10;

function wallColor(id: number): readonly [number, number, number] {
  return id === EARTH ? COLORS.earth : COLORS.side[id];
}

/**
 * Wall segments on the side of cell class `c` that faces neighbour class `cn`.
 * Writes up to two segments into `out` as [bottom, top, colourId] triples and returns the count.
 */
function wallSegments(c: number, cn: number, out: number[]): number {
  if (cn === OUTSIDE) {
    // Map edge: earth down to the skirt, plus the building wall above ground.
    if (c === CLASS.WATER) {
      out[0] = HEIGHT.skirt; out[1] = HEIGHT.waterFloor; out[2] = EARTH;
      out[3] = HEIGHT.waterFloor; out[4] = HEIGHT.waterSurface; out[5] = CLASS.WATER;
      return 2;
    }
    out[0] = HEIGHT.skirt; out[1] = HEIGHT.land; out[2] = EARTH;
    if (c === CLASS.BUILDING) {
      out[3] = HEIGHT.land; out[4] = HEIGHT.building; out[5] = CLASS.BUILDING;
      return 2;
    }
    return 1;
  }
  if (c === CLASS.WATER) return 0;
  const top = topHeight(c);
  const bottom = topHeight(cn);
  if (bottom >= top) return 0;
  out[0] = bottom; out[1] = top; out[2] = c;
  return 1;
}

function segKey(b: number, t: number, colour: number): number {
  return colour * 1e8 + (Math.round(b * 20) + 1000) * 1e4 + (Math.round(t * 20) + 1000);
}

export function meshChunk(input: MeshInput): ChunkMesh {
  const { cell, x0, z0, sx, sz, get } = input;
  const land = new QuadBuilder(512);
  const water = new QuadBuilder(64);

  // Local copy of the chunk's classes.
  const cls = new Int8Array(sx * sz);
  for (let z = 0; z < sz; z++) for (let x = 0; x < sx; x++) cls[z * sx + x] = get(x0 + x, z0 + z);

  // --- Top faces: greedy rectangles per class -------------------------------------------
  const done = new Uint8Array(sx * sz);
  for (let z = 0; z < sz; z++) {
    for (let x = 0; x < sx; x++) {
      const i = z * sx + x;
      if (done[i]) continue;
      const c = cls[i];
      let w = 1;
      while (x + w < sx && !done[i + w] && cls[i + w] === c) w++;
      let h = 1;
      grow: while (z + h < sz) {
        const row = (z + h) * sx + x;
        for (let k = 0; k < w; k++) if (done[row + k] || cls[row + k] !== c) break grow;
        h++;
      }
      for (let dz = 0; dz < h; dz++) done.fill(1, (z + dz) * sx + x, (z + dz) * sx + x + w);

      const xa = x * cell;
      const xb = (x + w) * cell;
      const za = z * cell;
      const zb = (z + h) * cell;
      const [r, g, b] = COLORS.top[c];
      if (c === CLASS.WATER) {
        water.push([xa, 0, za, xa, 0, zb, xb, 0, zb, xb, 0, za], r, g, b);
      } else {
        const y = topHeight(c);
        land.push([xa, y, za, xa, y, zb, xb, y, zb, xb, y, za], r * SHADE.top, g * SHADE.top, b * SHADE.top);
      }
    }
  }

  // --- Walls: one pass per direction, runs of identical segments merged ----------------
  const seg: number[] = [0, 0, 0, 0, 0, 0];
  const maxRun = Math.max(sx, sz);
  const keys = [new Float64Array(maxRun), new Float64Array(maxRun)];
  const segs = [new Float64Array(maxRun * 3), new Float64Array(maxRun * 3)];

  const dirs = [
    { dx: 1, dz: 0, shade: SHADE.px },
    { dx: -1, dz: 0, shade: SHADE.nx },
    { dx: 0, dz: 1, shade: SHADE.pz },
    { dx: 0, dz: -1, shade: SHADE.nz },
  ] as const;

  for (const d of dirs) {
    const alongZ = d.dx !== 0; // walls facing ±x run along z
    const outer = alongZ ? sx : sz;
    const inner = alongZ ? sz : sx;
    for (let o = 0; o < outer; o++) {
      keys[0].fill(0, 0, inner);
      keys[1].fill(0, 0, inner);
      for (let k = 0; k < inner; k++) {
        const x = alongZ ? o : k;
        const z = alongZ ? k : o;
        const c = cls[z * sx + x];
        const cn = get(x0 + x + d.dx, z0 + z + d.dz);
        const n = wallSegments(c, cn, seg);
        for (let s = 0; s < n; s++) {
          keys[s][k] = segKey(seg[s * 3], seg[s * 3 + 1], seg[s * 3 + 2]);
          segs[s][k * 3] = seg[s * 3];
          segs[s][k * 3 + 1] = seg[s * 3 + 1];
          segs[s][k * 3 + 2] = seg[s * 3 + 2];
        }
      }
      for (let layer = 0; layer < 2; layer++) {
        const kk = keys[layer];
        let j = 0;
        while (j < inner) {
          const key = kk[j];
          if (key === 0) {
            j++;
            continue;
          }
          let e = j + 1;
          while (e < inner && kk[e] === key) e++;
          const ya = segs[layer][j * 3];
          const yb = segs[layer][j * 3 + 1];
          const [cr, cg, cb] = wallColor(segs[layer][j * 3 + 2]);
          const r = cr * d.shade;
          const g = cg * d.shade;
          const b = cb * d.shade;
          const a = j * cell;
          const bEnd = e * cell;
          if (d.dx === 1) {
            const X = (o + 1) * cell;
            land.push([X, ya, a, X, yb, a, X, yb, bEnd, X, ya, bEnd], r, g, b);
          } else if (d.dx === -1) {
            const X = o * cell;
            land.push([X, ya, a, X, ya, bEnd, X, yb, bEnd, X, yb, a], r, g, b);
          } else if (d.dz === 1) {
            const Z = (o + 1) * cell;
            land.push([a, ya, Z, bEnd, ya, Z, bEnd, yb, Z, a, yb, Z], r, g, b);
          } else {
            const Z = o * cell;
            land.push([a, ya, Z, a, yb, Z, bEnd, yb, Z, bEnd, ya, Z], r, g, b);
          }
          j = e;
        }
      }
    }
  }

  return { land: land.finish(), water: water.finish() };
}

/** Bytes a chunk mesh occupies on the GPU. */
export function meshBytes(m: ChunkMesh): number {
  const b = (x: MeshBuffers) => x.positions.byteLength + x.colors.byteLength + x.indices.byteLength;
  return b(m.land) + b(m.water);
}
