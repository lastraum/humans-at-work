export type FurnitureItem = {
  _uid: string;
  type: string;
  x: number;
  y: number;
  w?: number;
  h?: number;
  r?: number;
  facing?: number;
  pitch?: number;
  roll?: number;
  sx?: number;
  sy?: number;
  sz?: number;
  id?: string;
  elevation?: number;
  hinge?: "left" | "right";
  open?: number;
  doorEdge?: "n" | "s" | "e" | "w";
  windowEdge?: "n" | "s" | "e" | "w";
};

export type Avatar = {
  id: string;
  pose: "sit" | "stand";
  facing: number;
  x: number;
  y: number;
  color: string;
  officeId?: string;
  col?: number;
  row?: number;
  name?: string;
};

export type CellKind =
  | "no_office"
  | "office"
  | "channel"
  | "cube"
  | "elevator"
  | "kitchen"
  | "conference"
  | "recreation"
  | "sidewalk"
  | "parking";

export type ClaimSeat = {
  id: string;
  col: number;
  row: number;
  facing: number;
  doorEdge?: string;
  seat: { x: number; y: number };
  center: { x: number; y: number };
};

export type OfficeInstance = {
  id: string;
  col: number;
  row: number;
  /** Degrees clockwise from the south-facing template. 0=S 90=W 180=N 270=E */
  rot: number;
  /** Footprint in cells. Conference rooms merge to 2x1 / 2x2. */
  cols?: number;
  rows?: number;
  furniture?: FurnitureItem[];
};

export type OfficeTemplate = {
  size: number;
  furniture: FurnitureItem[];
  structure: FurnitureItem[];
};

export type FloorPlate = {
  id: string;
  name: string;
  grid: {
    cols: number;
    rows: number;
    cellSize: number;
    width: number;
    height: number;
  };
  legend: Record<string, CellKind>;
  cells: string[];
  walkable: number[][];
  spawn: { id: string; col: number; row: number; x: number; y: number };
  claimable: { offices: ClaimSeat[]; cubes: ClaimSeat[] };
  zones: {
    elevator: { cells: { col: number; row: number }[] };
    kitchen: { cells: { col: number; row: number }[] };
    cooler: { cells: { col: number; row: number }[] };
  };
  assets: {
    baseUrl: string;
    types: Record<string, { glb: string | null; footprint: number[]; procedural?: boolean }>;
  };
  furniture: FurnitureItem[];
  officeTemplate?: OfficeTemplate;
  offices?: OfficeInstance[];
  cubicleTemplate?: OfficeTemplate;
  cubicles?: OfficeInstance[];
  conferenceTemplate?: OfficeTemplate;
  conferences?: OfficeInstance[];
  recreationTemplate?: OfficeTemplate;
  recreations?: OfficeInstance[];
  avatars?: Avatar[];
};
