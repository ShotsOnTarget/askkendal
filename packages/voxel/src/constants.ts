/**
 * Shared constants for the voxel Kendal. Browser-safe: no Node imports.
 *
 * World coordinates are metres: x east, y up, z south, origin at the centre of BBOX.
 * The grid starts at the north-west corner of BBOX.
 */

/** Area covered: Kendal town plus a margin of fields. */
export const BBOX = { south: 54.305, west: -2.785, north: 54.352, east: -2.705 } as const;

export const ORIGIN = {
  lat: (BBOX.south + BBOX.north) / 2,
  lon: (BBOX.west + BBOX.east) / 2,
} as const;

/** Cell classes. Keep this list short: the look is deliberately simple. */
export const CLASS = {
  GROUND: 0,
  GRASS: 1,
  ROAD: 2,
  WATER: 3,
  BUILDING: 4,
} as const;
export type CellClass = (typeof CLASS)[keyof typeof CLASS];
export const CLASS_NAMES = ["ground", "grass", "road", "water", "building"] as const;

/** Detail grid cell size in metres. */
export const DETAIL_CELL = 2;
/** Low-detail grid for the zoomed-out view. */
export const LOD_FACTOR = 4;
export const LOD_CELL = DETAIL_CELL * LOD_FACTOR;
/** Cells per chunk side. One mesh (one draw call) per chunk. */
export const CHUNK = 64;
/** Detail cells per region file side (8 x 8 chunks). */
export const REGION = 512;

/** Heights in metres. Buildings share one height on purpose. */
export const HEIGHT = {
  building: 6,
  land: 0,
  waterFloor: -2.5,
  /** Normal water surface. The river layer moves it between waterMin and waterMax. */
  waterSurface: -1.4,
  waterMin: -2.3,
  waterMax: -0.15,
  /** Bottom of the "diorama" skirt around the edge of the map. */
  skirt: -8,
} as const;

/** Mesh positions are stored as Int16 in units of 1/POS_SCALE metres. */
export const POS_SCALE = 4;

type RGB = readonly [number, number, number];

/** sRGB colours. Kendal is the "Auld Grey Town": limestone walls, slate roofs. */
export const COLORS: Record<"top" | "side", Record<number, RGB>> & { earth: RGB } = {
  top: {
    [CLASS.GROUND]: [226, 219, 192],
    [CLASS.GRASS]: [132, 184, 90],
    [CLASS.ROAD]: [94, 98, 106],
    [CLASS.WATER]: [64, 144, 214],
    [CLASS.BUILDING]: [128, 137, 156],
  },
  side: {
    [CLASS.GROUND]: [190, 181, 152],
    [CLASS.GRASS]: [104, 146, 70],
    [CLASS.ROAD]: [72, 75, 82],
    [CLASS.WATER]: [52, 120, 184],
    [CLASS.BUILDING]: [221, 214, 197],
  },
  earth: [150, 118, 86],
};

/** Baked light: brightness per face direction. */
export const SHADE = { top: 1.0, px: 0.86, nx: 0.7, pz: 0.94, nz: 0.62 } as const;
