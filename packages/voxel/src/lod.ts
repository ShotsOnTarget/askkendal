import { CLASS } from "./constants";

/**
 * Downsample the detail grid by `factor` for the zoomed-out view.
 * Thin things (roads, buildings) need fewer cells to survive than area classes.
 */
export function downsampleLod(
  src: Uint8Array,
  width: number,
  height: number,
  factor: number,
): { data: Uint8Array; width: number; height: number } {
  const w = Math.ceil(width / factor);
  const h = Math.ceil(height / factor);
  const out = new Uint8Array(w * h);
  const counts = new Uint16Array(5);
  const block = factor * factor;
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      counts.fill(0);
      for (let dz = 0; dz < factor; dz++) {
        const z = j * factor + dz;
        if (z >= height) break;
        for (let dx = 0; dx < factor; dx++) {
          const x = i * factor + dx;
          if (x >= width) break;
          counts[src[z * width + x]]++;
        }
      }
      let c: number;
      if (counts[CLASS.BUILDING] >= block * 0.35) c = CLASS.BUILDING;
      else if (counts[CLASS.WATER] >= block * 0.4) c = CLASS.WATER;
      else if (counts[CLASS.ROAD] >= block * 0.3) c = CLASS.ROAD;
      else c = counts[CLASS.GRASS] > counts[CLASS.GROUND] ? CLASS.GRASS : CLASS.GROUND;
      out[j * w + i] = c;
    }
  }
  return { data: out, width: w, height: h };
}
