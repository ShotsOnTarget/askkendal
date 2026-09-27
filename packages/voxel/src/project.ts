import { BBOX, ORIGIN } from "./constants";

const RAD = Math.PI / 180;
const phi = ORIGIN.lat * RAD;
/** Metres per degree at Kendal's latitude. Accurate to well under a metre over a few kilometres. */
export const M_PER_DEG_LAT = 111_132.954 - 559.822 * Math.cos(2 * phi) + 1.175 * Math.cos(4 * phi);
export const M_PER_DEG_LON = 111_412.84 * Math.cos(phi) - 93.5 * Math.cos(3 * phi);

/** Latitude/longitude to world metres (x east, z south). */
export function toWorld(lat: number, lon: number): { x: number; z: number } {
  return { x: (lon - ORIGIN.lon) * M_PER_DEG_LON, z: -(lat - ORIGIN.lat) * M_PER_DEG_LAT };
}

export function toLatLon(x: number, z: number): { lat: number; lon: number } {
  return { lat: ORIGIN.lat - z / M_PER_DEG_LAT, lon: ORIGIN.lon + x / M_PER_DEG_LON };
}

/** World position of the grid's north-west corner. */
export const GRID_MIN = toWorld(BBOX.north, BBOX.west);
const GRID_MAX = toWorld(BBOX.south, BBOX.east);

export function gridSize(cell: number): { width: number; height: number } {
  return {
    width: Math.ceil((GRID_MAX.x - GRID_MIN.x) / cell),
    height: Math.ceil((GRID_MAX.z - GRID_MIN.z) / cell),
  };
}

/** World metres to fractional grid coordinates. */
export function worldToGrid(x: number, z: number, cell: number): { gx: number; gz: number } {
  return { gx: (x - GRID_MIN.x) / cell, gz: (z - GRID_MIN.z) / cell };
}
