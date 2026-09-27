/**
 * Binary grid files. Browser-safe: gzip is applied by the build and undone in the
 * browser with DecompressionStream, so no host has to be configured to compress.
 *
 * Layout (before gzip):
 *   0  "AKV1"          magic
 *   4  u8  version (1)
 *   5  u8  kind        0 = class grid (u8 values), 1 = feature grid (u32 values)
 *   6  u8  cell size in metres
 *   7  u8  reserved
 *   8  u32 x0          grid origin of this file, in cells
 *   12 u32 z0
 *   16 u32 width
 *   20 u32 height
 *   24 ...             run-length encoded values, row-major, runs may cross rows
 * Runs: class grids store (u8 value, varint length); feature grids store (varint value, varint length).
 */

export const MAGIC = "AKV1";
export const HEADER_BYTES = 24;

export interface GridHeader {
  kind: 0 | 1;
  cell: number;
  x0: number;
  z0: number;
  width: number;
  height: number;
}

export interface DecodedGrid<T extends Uint8Array | Uint32Array> extends GridHeader {
  data: T;
}

class ByteWriter {
  private buf = new Uint8Array(1 << 16);
  length = 0;
  private ensure(n: number) {
    if (this.length + n <= this.buf.length) return;
    let size = this.buf.length * 2;
    while (size < this.length + n) size *= 2;
    const next = new Uint8Array(size);
    next.set(this.buf.subarray(0, this.length));
    this.buf = next;
  }
  byte(v: number) {
    this.ensure(1);
    this.buf[this.length++] = v;
  }
  u32(v: number) {
    this.ensure(4);
    new DataView(this.buf.buffer).setUint32(this.length, v, true);
    this.length += 4;
  }
  varint(v: number) {
    while (v >= 0x80) {
      this.byte((v & 0x7f) | 0x80);
      v = Math.floor(v / 128);
    }
    this.byte(v);
  }
  bytes(): Uint8Array {
    return this.buf.slice(0, this.length);
  }
}

function writeHeader(w: ByteWriter, h: GridHeader) {
  for (const ch of MAGIC) w.byte(ch.charCodeAt(0));
  w.byte(1);
  w.byte(h.kind);
  w.byte(h.cell);
  w.byte(0);
  w.u32(h.x0);
  w.u32(h.z0);
  w.u32(h.width);
  w.u32(h.height);
}

/** Encode a class grid (one byte per cell). */
export function encodeClassGrid(h: Omit<GridHeader, "kind">, data: Uint8Array): Uint8Array {
  if (data.length !== h.width * h.height) throw new Error("grid size mismatch");
  const w = new ByteWriter();
  writeHeader(w, { ...h, kind: 0 });
  let i = 0;
  while (i < data.length) {
    const v = data[i];
    let j = i + 1;
    while (j < data.length && data[j] === v) j++;
    w.byte(v);
    w.varint(j - i);
    i = j;
  }
  return w.bytes();
}

/** Encode a feature-id grid (u32 per cell, 0 = no feature). */
export function encodeFeatureGrid(h: Omit<GridHeader, "kind">, data: Uint32Array): Uint8Array {
  if (data.length !== h.width * h.height) throw new Error("grid size mismatch");
  const w = new ByteWriter();
  writeHeader(w, { ...h, kind: 1 });
  let i = 0;
  while (i < data.length) {
    const v = data[i];
    let j = i + 1;
    while (j < data.length && data[j] === v) j++;
    w.varint(v);
    w.varint(j - i);
    i = j;
  }
  return w.bytes();
}

export function decodeHeader(bytes: Uint8Array): GridHeader {
  const magic = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]);
  if (magic !== MAGIC) throw new Error(`not a voxel grid file (magic ${magic})`);
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return {
    kind: bytes[5] as 0 | 1,
    cell: bytes[6],
    x0: dv.getUint32(8, true),
    z0: dv.getUint32(12, true),
    width: dv.getUint32(16, true),
    height: dv.getUint32(20, true),
  };
}

export function decodeGrid(bytes: Uint8Array): DecodedGrid<Uint8Array> | DecodedGrid<Uint32Array> {
  const h = decodeHeader(bytes);
  const total = h.width * h.height;
  const data = h.kind === 0 ? new Uint8Array(total) : new Uint32Array(total);
  let p = HEADER_BYTES;
  const readVarint = () => {
    let result = 0;
    let mul = 1;
    for (;;) {
      const b = bytes[p++];
      result += (b & 0x7f) * mul;
      if (b < 0x80) return result;
      mul *= 128;
    }
  };
  let i = 0;
  while (i < total) {
    const v = h.kind === 0 ? bytes[p++] : readVarint();
    const run = readVarint();
    if (run <= 0 || i + run > total) throw new Error("corrupt run-length data");
    data.fill(v, i, i + run);
    i += run;
  }
  return { ...h, data } as DecodedGrid<Uint8Array> | DecodedGrid<Uint32Array>;
}

/** Browser/Node: gunzip with the Streams API (Node 18+ and all current browsers). */
export async function gunzip(bytes: Uint8Array | ArrayBuffer): Promise<Uint8Array> {
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Manifest written by the build and read by the viewer. */
export interface VoxelManifest {
  version: 1;
  builtAt: string;
  osmTimestamp: string | null;
  attribution: string;
  origin: { lat: number; lon: number };
  bbox: { south: number; west: number; north: number; east: number };
  gridMin: { x: number; z: number };
  detail: { cell: number; width: number; height: number; region: number; chunk: number; regions: Array<[number, number]> };
  lod: { cell: number; width: number; height: number; chunk: number; file: string };
  heights: { building: number; waterFloor: number; waterSurface: number; waterMin: number; waterMax: number; skirt: number };
}

export interface VoxelLabel {
  /** Name shown. */
  n: string;
  /** World metres. */
  x: number;
  z: number;
  k: "road" | "landmark" | "water" | "place";
  /** Lower shows first and at wider zoom. */
  p: number;
}

export interface FeatureInfo {
  /** b building, r road, w water, g green space */
  t: "b" | "r" | "w" | "g";
  n?: string;
  /** Street: addr:street, or the nearest named road for buildings. */
  s?: string;
  /** OpenStreetMap id, e.g. "w12345". */
  o: string;
}
