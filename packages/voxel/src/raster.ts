/** Point in fractional grid coordinates (cells). */
export type Pt = readonly [number, number];

/**
 * Fill polygons (even-odd across all rings, so inner rings make holes) by sampling cell centres.
 * Calls `set` with the linear index of each covered cell and returns how many cells were set.
 */
export function fillRings(rings: Pt[][], width: number, height: number, set: (i: number) => void): number {
  let minY = Infinity;
  let maxY = -Infinity;
  for (const ring of rings) for (const [, y] of ring) {
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  const j0 = Math.max(0, Math.floor(minY));
  const j1 = Math.min(height - 1, Math.ceil(maxY));
  const xs: number[] = [];
  let count = 0;
  for (let j = j0; j <= j1; j++) {
    const yc = j + 0.5;
    xs.length = 0;
    for (const ring of rings) {
      const n = ring.length;
      for (let k = 0; k < n; k++) {
        const [x1, y1] = ring[k];
        const [x2, y2] = ring[(k + 1) % n];
        if ((y1 <= yc && y2 > yc) || (y2 <= yc && y1 > yc)) {
          xs.push(x1 + ((yc - y1) * (x2 - x1)) / (y2 - y1));
        }
      }
    }
    if (xs.length < 2) continue;
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const i0 = Math.max(0, Math.ceil(xs[k] - 0.5));
      const i1 = Math.min(width - 1, Math.floor(xs[k + 1] - 0.5));
      for (let i = i0; i <= i1; i++) {
        set(j * width + i);
        count++;
      }
    }
  }
  return count;
}

/** Stroke a polyline with a given half-width (in cells). Thin lines still get a connected 1-cell path. */
export function strokePath(pts: Pt[], halfWidth: number, width: number, height: number, set: (i: number) => void): void {
  const r = Math.max(halfWidth, 0.75);
  const r2 = r * r;
  for (let k = 0; k + 1 < pts.length; k++) {
    const [ax, ay] = pts[k];
    const [bx, by] = pts[k + 1];
    const i0 = Math.max(0, Math.floor(Math.min(ax, bx) - r));
    const i1 = Math.min(width - 1, Math.ceil(Math.max(ax, bx) + r));
    const j0 = Math.max(0, Math.floor(Math.min(ay, by) - r));
    const j1 = Math.min(height - 1, Math.ceil(Math.max(ay, by) + r));
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    for (let j = j0; j <= j1; j++) {
      const cy = j + 0.5;
      for (let i = i0; i <= i1; i++) {
        const cx = i + 0.5;
        let t = len2 > 0 ? ((cx - ax) * dx + (cy - ay) * dy) / len2 : 0;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const px = ax + t * dx - cx;
        const py = ay + t * dy - cy;
        if (px * px + py * py <= r2) set(j * width + i);
      }
    }
  }
}

/** Length of a polyline in the units of its points. */
export function pathLength(pts: Pt[]): number {
  let d = 0;
  for (let k = 0; k + 1 < pts.length; k++) d += Math.hypot(pts[k + 1][0] - pts[k][0], pts[k + 1][1] - pts[k][1]);
  return d;
}

/** Point halfway along a polyline. */
export function pathMidpoint(pts: Pt[]): Pt {
  const half = pathLength(pts) / 2;
  let acc = 0;
  for (let k = 0; k + 1 < pts.length; k++) {
    const seg = Math.hypot(pts[k + 1][0] - pts[k][0], pts[k + 1][1] - pts[k][1]);
    if (acc + seg >= half && seg > 0) {
      const t = (half - acc) / seg;
      return [pts[k][0] + t * (pts[k + 1][0] - pts[k][0]), pts[k][1] + t * (pts[k + 1][1] - pts[k][1])];
    }
    acc += seg;
  }
  return pts[Math.floor(pts.length / 2)];
}

/** Vertex average of a ring: good enough to place a label or geocode a building. */
export function ringCentroid(ring: Pt[]): Pt {
  let x = 0;
  let y = 0;
  const n = ring.length;
  for (const [px, py] of ring) {
    x += px;
    y += py;
  }
  return [x / n, y / n];
}
