import type { FloorPlate, FurnitureItem } from "./types";

/** Floor, walls, and furniture. People are not multiplied by this. */
export const ENV_SCALE = 1.2;

/** Claw3D canvas → world scale so the vendored GLBs sit at the right size. */
export const SCALE = 0.018 * ENV_SCALE;

export const FURNITURE_ROTATION: Record<string, number> = {};

export const FURNITURE_SCALE: Record<string, [number, number, number]> = {
  desk_cubicle: [1, 1, 1],
  executive_desk: [1, 1, 1],
  chair: [1.2, 1.2, 1.2],
  round_table: [3.2, 3.2, 3.2],
  plant: [1.2, 1.8, 1.2],
  table_rect: [1.4, 1.2, 1.0],
  coffee_machine: [0.8, 0.8, 0.8],
  fridge: [1, 1.4, 1],
  water_cooler: [1, 2, 1],
  cabinet: [2.6, 1.2, 1],
  computer: [1.1, 1.1, 1.1],
  lamp: [1.2, 1.2, 1.2],
  couch: [1.15, 1.15, 1.15],
  bookcase: [1, 1, 1],
  lounge_chair: [1, 1, 1],
  cushion_chair: [1.2, 1.2, 1.2],
  coffee_table: [1, 1, 1],
  conference_table: [2.4, 1.15, 1.9],
  guest_chair: [1.15, 1.15, 1.15],
  projection_screen: [1, 1, 1],
  whiteboard: [1, 1, 1],
  beanbag: [1, 1, 1],
  ping_pong: [1, 1, 1],
  vending: [1, 1, 1],
};

export const FURNITURE_TINT: Record<string, string | null> = {
  desk_cubicle: "#8b5e32",
  executive_desk: "#6b3c1a",
  chair: "#4a5568",
  round_table: "#9a6332",
  computer: "#363c58",
  table_rect: "#7a5028",
  coffee_machine: "#2d2d38",
  fridge: "#505a60",
  water_cooler: "#3a5070",
  cabinet: "#3c4248",
  plant: null,
  lamp: "#c8a060",
  couch: "#3d5575",
  bookcase: "#6a4a32",
  lounge_chair: "#4a6748",
  cushion_chair: "#7a5a78",
  coffee_table: "#8a6038",
  conference_table: "#5c4030",
  guest_chair: "#4a5568",
  projection_screen: "#1a1e28",
  whiteboard: "#d8dde4",
  beanbag: "#c45a3a",
  ping_pong: "#2e6b4a",
  vending: "#c43a3a",
};

/** Native Kenney desk top is y=0.384. */
export const FURNITURE_Y_OFFSET: Record<string, number> = {
  computer: 0.384,
};

export const toWorld = (
  cx: number,
  cy: number,
  plate: FloorPlate,
): [number, number, number] => [
  cx * SCALE - plate.grid.width * SCALE * 0.5,
  0,
  cy * SCALE - plate.grid.height * SCALE * 0.5,
];

export const fromWorld = (
  wx: number,
  wz: number,
  plate: FloorPlate,
): { x: number; y: number } => ({
  x: wx / SCALE + plate.grid.width * 0.5,
  y: wz / SCALE + plate.grid.height * 0.5,
});

export const cellToWorld = (
  col: number,
  row: number,
  plate: FloorPlate,
): [number, number, number] => {
  const size = plate.grid.cellSize;
  return toWorld(col * size, row * size, plate);
};

export const getItemSize = (item: FurnitureItem, plate: FloorPlate) => {
  if (item.r !== undefined) {
    return { width: item.r * 2, height: item.r * 2 };
  }
  const fp = plate.assets.types[item.type]?.footprint ?? [40, 40];
  return { width: item.w ?? fp[0] ?? 40, height: item.h ?? fp[1] ?? 40 };
};

export const itemRotation = (item: FurnitureItem) =>
  ((item.facing ?? 0) * Math.PI) / 180 + (FURNITURE_ROTATION[item.type] ?? 0);
