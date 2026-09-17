import { FURNITURE_CATALOG } from "./furnitureCatalog";
import type { CellKind, FloorPlate, FurnitureItem, OfficeInstance, OfficeTemplate } from "./types";

export const KIND_CHAR: Record<CellKind, string> = {
  no_office: "n",
  office: "x",
  channel: ".",
  cube: "u",
  elevator: "E",
  kitchen: "K",
  conference: "C",
  recreation: "R",
  library: "L",
  sidewalk: "w",
  parking: "p",
};

export const CHAR_KIND: Record<string, CellKind> = {
  n: "no_office",
  x: "office",
  ".": "channel",
  u: "cube",
  E: "elevator",
  K: "kitchen",
  C: "conference",
  R: "recreation",
  L: "library",
  w: "sidewalk",
  p: "parking",
};

export const INDOOR_WALKABLE: CellKind[] = [
  "channel",
  "elevator",
  "kitchen",
  "recreation",
  "library",
  "office",
  "cube",
  "conference",
];

export const OUTDOOR_WALKABLE: CellKind[] = ["sidewalk", "parking"];

export const WALKABLE_KINDS: CellKind[] = [...INDOOR_WALKABLE, ...OUTDOOR_WALKABLE];

export const INDOOR_KINDS: CellKind[] = [
  "office",
  "channel",
  "cube",
  "elevator",
  "kitchen",
  "conference",
  "recreation",
  "library",
];

export const PAINT_KINDS: { kind: CellKind; label: string }[] = [
  { kind: "channel", label: "hallway" },
  { kind: "office", label: "office" },
  { kind: "cube", label: "cubicle" },
  { kind: "conference", label: "conference" },
  { kind: "kitchen", label: "kitchen" },
  { kind: "recreation", label: "recreation" },
  { kind: "library", label: "library" },
  { kind: "elevator", label: "elevator" },
  { kind: "sidewalk", label: "sidewalk" },
  { kind: "parking", label: "parking" },
  { kind: "no_office", label: "outside" },
];

export function kindAt(plate: FloorPlate, col: number, row: number): CellKind | null {
  if (row < 0 || col < 0 || row >= plate.grid.rows || col >= plate.grid.cols) return null;
  return CHAR_KIND[plate.cells[row][col]] ?? null;
}

export function setCellKind(plate: FloorPlate, col: number, row: number, kind: CellKind) {
  if (row < 0 || col < 0 || row >= plate.grid.rows || col >= plate.grid.cols) return;
  const line = plate.cells[row];
  plate.cells[row] = line.slice(0, col) + KIND_CHAR[kind] + line.slice(col + 1);
}

function officeRot(col: number, row: number, cols: number, rows: number) {
  if (row === rows - 1) return 0;
  if (col === 0) return 90;
  if (row === 0) return 180;
  if (col === cols - 1) return 270;
  return 0;
}

function collect(
  plate: FloorPlate,
  match: CellKind,
  existing: OfficeInstance[] | undefined,
  prefix: string,
  withRot: boolean,
): OfficeInstance[] {
  const byKey = new Map((existing ?? []).map((item) => [`${item.col},${item.row}`, item]));
  const next: OfficeInstance[] = [];
  for (let row = 0; row < plate.grid.rows; row++) {
    for (let col = 0; col < plate.grid.cols; col++) {
      if (kindAt(plate, col, row) !== match) continue;
      const prev = byKey.get(`${col},${row}`);
      next.push(
        prev ?? {
          id: `${prefix}_${col}_${row}`,
          col,
          row,
          rot: withRot ? officeRot(col, row, plate.grid.cols, plate.grid.rows) : 0,
        },
      );
    }
  }
  return next;
}

function collectMergedRooms(
  plate: FloorPlate,
  match: CellKind,
  prefix: string,
  existing: OfficeInstance[] | undefined,
): OfficeInstance[] {
  const used = new Set<string>();
  const key = (col: number, row: number) => `${col},${row}`;
  const free = (col: number, row: number) =>
    kindAt(plate, col, row) === match && !used.has(key(col, row));
  const fits = (col: number, row: number, w: number, h: number) => {
    if (col + w > plate.grid.cols || row + h > plate.grid.rows) return false;
    for (let dc = 0; dc < w; dc++) {
      for (let dr = 0; dr < h; dr++) {
        if (!free(col + dc, row + dr)) return false;
      }
    }
    return true;
  };
  const mark = (col: number, row: number, w: number, h: number) => {
    for (let dc = 0; dc < w; dc++) {
      for (let dr = 0; dr < h; dr++) used.add(key(col + dc, row + dr));
    }
  };
  const hitFor = (col: number, row: number, w: number, h: number) =>
    (existing ?? []).find((room) => {
      const rw = room.cols ?? 1;
      const rh = room.rows ?? 1;
      return (
        col < room.col + rw &&
        col + w > room.col &&
        row < room.row + rh &&
        row + h > room.row
      );
    });

  const rooms: OfficeInstance[] = [];
  for (let row = 0; row < plate.grid.rows; row++) {
    for (let col = 0; col < plate.grid.cols; col++) {
      if (!free(col, row)) continue;
      let w = 1;
      let h = 1;
      if (fits(col, row, 2, 2)) {
        w = 2;
        h = 2;
      } else if (fits(col, row, 2, 1)) {
        w = 2;
        h = 1;
      } else if (fits(col, row, 1, 2)) {
        w = 1;
        h = 2;
      }
      mark(col, row, w, h);
      const hit = hitFor(col, row, w, h);
      rooms.push({
        id: `${prefix}_${col}_${row}_${w}x${h}`,
        col,
        row,
        cols: w,
        rows: h,
        rot: hit?.rot ?? 0,
        furniture: hit?.furniture,
      });
    }
  }
  return rooms;
}

export function conferencePerimeter(
  cols: number,
  rows: number,
  cell: number,
  doorX?: number,
): FurnitureItem[] {
  const wall = 8;
  const door = 40;
  const sizeW = cols * cell;
  const sizeH = rows * cell;
  const maxX = Math.max(wall, sizeW - wall - door);
  const x = Math.min(maxX, Math.max(wall, doorX ?? sizeW / 2 - door / 2));
  return [
    { _uid: "conf_wn", type: "wall", x: 0, y: 0, w: sizeW, h: wall },
    { _uid: "conf_ww", type: "wall", x: 0, y: 0, w: wall, h: sizeH },
    { _uid: "conf_we", type: "wall", x: sizeW - wall, y: 0, w: wall, h: sizeH },
    { _uid: "conf_ws0", type: "wall", x: 0, y: sizeH - wall, w: x, h: wall },
    {
      _uid: "conf_ws1",
      type: "wall",
      x: x + door,
      y: sizeH - wall,
      w: sizeW - x - door,
      h: wall,
    },
    {
      _uid: "conf_door",
      type: "door",
      x,
      y: sizeH - wall,
      w: door,
      h: wall,
      facing: 0,
      hinge: "left",
      open: 0.38,
      doorEdge: "s",
    },
  ];
}

export function clampDoorToSouthWall(
  item: FurnitureItem,
  cols: number,
  rows: number,
  cell: number,
) {
  const wall = 8;
  const door = item.w ?? 40;
  const sizeW = cols * cell;
  const sizeH = rows * cell;
  const maxX = Math.max(wall, sizeW - wall - door);
  item.x = Math.min(maxX, Math.max(wall, item.x));
  item.y = sizeH - wall;
  item.w = door;
  item.h = wall;
  item.doorEdge = "s";
  item.facing = 0;
  item.pitch = 0;
  item.roll = 0;
}

function rebuildWalkable(plate: FloorPlate) {
  plate.walkable = [];
  for (let row = 0; row < plate.grid.rows; row++) {
    const line: number[] = [];
    for (let col = 0; col < plate.grid.cols; col++) {
      const kind = kindAt(plate, col, row);
      line.push(kind && WALKABLE_KINDS.includes(kind) ? 1 : 0);
    }
    plate.walkable.push(line);
  }
}

function cellsOf(plate: FloorPlate, match: CellKind) {
  const cells: { col: number; row: number }[] = [];
  for (let row = 0; row < plate.grid.rows; row++) {
    for (let col = 0; col < plate.grid.cols; col++) {
      if (kindAt(plate, col, row) === match) cells.push({ col, row });
    }
  }
  return cells;
}

export function syncGridDerived(plate: FloorPlate) {
  plate.grid.width = plate.grid.cols * plate.grid.cellSize;
  plate.grid.height = plate.grid.rows * plate.grid.cellSize;
  plate.legend = { ...CHAR_KIND, ...plate.legend };
  rebuildWalkable(plate);
  plate.offices = collect(plate, "office", plate.offices, "office", true);
  plate.cubicles = collect(plate, "cube", plate.cubicles, "cube", false);
  plate.conferences = collectMergedRooms(plate, "conference", "conf", plate.conferences);
  plate.recreations = collectMergedRooms(plate, "recreation", "rec", plate.recreations);
  plate.libraries = collectMergedRooms(plate, "library", "lib", plate.libraries);
  const kitchen = cellsOf(plate, "kitchen");
  const elevator = cellsOf(plate, "elevator");
  plate.zones.kitchen = { ...plate.zones.kitchen, cells: kitchen };
  plate.zones.elevator = { ...plate.zones.elevator, cells: elevator };
  plate.claimable.offices = (plate.offices ?? []).map((office) => ({
    id: office.id,
    col: office.col,
    row: office.row,
    facing: office.rot,
    seat: {
      x: office.col * plate.grid.cellSize + plate.grid.cellSize / 2,
      y: office.row * plate.grid.cellSize + plate.grid.cellSize / 2,
    },
    center: {
      x: office.col * plate.grid.cellSize + plate.grid.cellSize / 2,
      y: office.row * plate.grid.cellSize + plate.grid.cellSize / 2,
    },
  }));
  plate.claimable.cubes = (plate.cubicles ?? []).map((cube) => ({
    id: cube.id,
    col: cube.col,
    row: cube.row,
    facing: cube.rot,
    seat: {
      x: cube.col * plate.grid.cellSize + plate.grid.cellSize / 2,
      y: cube.row * plate.grid.cellSize + plate.grid.cellSize / 2,
    },
    center: {
      x: cube.col * plate.grid.cellSize + plate.grid.cellSize / 2,
      y: cube.row * plate.grid.cellSize + plate.grid.cellSize / 2,
    },
  }));
}

function shiftRooms(
  plate: FloorPlate,
  colFrom: number,
  rowFrom: number,
  dCol: number,
  dRow: number,
) {
  for (const list of [plate.offices, plate.cubicles, plate.conferences, plate.recreations, plate.libraries]) {
    if (!list) continue;
    for (const item of list) {
      if (dCol && item.col >= colFrom) item.col += dCol;
      if (dRow && item.row >= rowFrom) item.row += dRow;
    }
  }
}

function shiftCanvasItems(
  plate: FloorPlate,
  colFrom: number,
  rowFrom: number,
  dCol: number,
  dRow: number,
) {
  const size = plate.grid.cellSize;
  const xCut = colFrom * size;
  const yCut = rowFrom * size;
  const dx = dCol * size;
  const dy = dRow * size;
  const bump = (item: { x: number; y: number }) => {
    if (dCol && item.x >= xCut) item.x += dx;
    if (dRow && item.y >= yCut) item.y += dy;
  };
  for (const item of plate.furniture) bump(item);
  for (const item of plate.avatars ?? []) bump(item);
}

export function addRow(plate: FloorPlate, afterRow?: number) {
  const at =
    afterRow === undefined
      ? plate.grid.rows
      : Math.min(plate.grid.rows, Math.max(0, afterRow + 1));
  shiftRooms(plate, 0, at, 0, 1);
  shiftCanvasItems(plate, 0, at, 0, 1);
  plate.cells.splice(at, 0, KIND_CHAR.channel.repeat(plate.grid.cols));
  plate.grid.rows += 1;
  syncGridDerived(plate);
}

export function addCol(plate: FloorPlate, afterCol?: number) {
  const at =
    afterCol === undefined
      ? plate.grid.cols
      : Math.min(plate.grid.cols, Math.max(0, afterCol + 1));
  shiftRooms(plate, at, 0, 1, 0);
  shiftCanvasItems(plate, at, 0, 1, 0);
  plate.cells = plate.cells.map(
    (line) => line.slice(0, at) + KIND_CHAR.channel + line.slice(at),
  );
  plate.grid.cols += 1;
  syncGridDerived(plate);
}

export function removeRow(plate: FloorPlate, row?: number) {
  if (plate.grid.rows <= 1) return;
  const at =
    row === undefined
      ? plate.grid.rows - 1
      : Math.min(plate.grid.rows - 1, Math.max(0, row));
  shiftRooms(plate, 0, at + 1, 0, -1);
  shiftCanvasItems(plate, 0, at + 1, 0, -1);
  plate.cells.splice(at, 1);
  plate.grid.rows -= 1;
  syncGridDerived(plate);
}

export function removeCol(plate: FloorPlate, col?: number) {
  if (plate.grid.cols <= 1) return;
  const at =
    col === undefined
      ? plate.grid.cols - 1
      : Math.min(plate.grid.cols - 1, Math.max(0, col));
  shiftRooms(plate, at + 1, 0, -1, 0);
  shiftCanvasItems(plate, at + 1, 0, -1, 0);
  plate.cells = plate.cells.map((line) => line.slice(0, at) + line.slice(at + 1));
  plate.grid.cols -= 1;
  syncGridDerived(plate);
}

export function paintCell(plate: FloorPlate, col: number, row: number, kind: CellKind) {
  setCellKind(plate, col, row, kind);
  syncGridDerived(plate);
}

export function defaultConferenceTemplate(size: number): OfficeTemplate {
  const tableW = 150;
  const tableH = 64;
  const tableX = (size - tableW) / 2;
  const tableY = (size - tableH) / 2 + 12;
  const furniture: FurnitureItem[] = [
    {
      _uid: "conf_table",
      type: "conference_table",
      id: "table",
      x: tableX,
      y: tableY,
      w: tableW,
      h: tableH,
      facing: 0,
    },
    {
      _uid: "conf_screen",
      type: "projection_screen",
      id: "screen",
      x: (size - 110) / 2,
      y: 10,
      w: 110,
      h: 14,
      facing: 0,
    },
    {
      _uid: "conf_chair_n",
      type: "guest_chair",
      id: "chair_n",
      x: tableX + 20,
      y: tableY - 30,
      facing: 0,
    },
    {
      _uid: "conf_chair_n2",
      type: "cushion_chair",
      id: "chair_n2",
      x: tableX + tableW - 44,
      y: tableY - 30,
      facing: 0,
    },
    {
      _uid: "conf_chair_s",
      type: "guest_chair",
      id: "chair_s",
      x: tableX + 20,
      y: tableY + tableH + 6,
      facing: 180,
    },
    {
      _uid: "conf_chair_s2",
      type: "cushion_chair",
      id: "chair_s2",
      x: tableX + tableW - 44,
      y: tableY + tableH + 6,
      facing: 180,
    },
  ];
  return { size, furniture, structure: conferencePerimeter(1, 1, size) };
}

export function defaultRecreationTemplate(size: number): OfficeTemplate {
  return {
    size,
    structure: [],
    furniture: [
      {
        _uid: "rec_screen",
        type: "projection_screen",
        id: "screen",
        x: (size - 110) / 2,
        y: 12,
        w: 110,
        h: 14,
        facing: 0,
      },
    ],
  };
}

/** Walled quiet room. Interior stays empty so the editor can furnish it. */
export function defaultLibraryTemplate(size: number): OfficeTemplate {
  return {
    size,
    structure: conferencePerimeter(1, 1, size),
    furniture: [],
  };
}

function ensureAssetTypes(plate: FloorPlate) {
  plate.assets.types = { ...FURNITURE_CATALOG, ...plate.assets.types };
}

function ensureOutsideStrip(plate: FloorPlate) {
  const hasOutside = plate.cells.some((line) => /[wp]/.test(line));
  if (hasOutside) return;
  const cols = plate.grid.cols;
  plate.cells.push(KIND_CHAR.sidewalk.repeat(cols));
  plate.cells.push(KIND_CHAR.parking.repeat(cols));
  plate.cells.push(KIND_CHAR.parking.repeat(cols));
  plate.grid.rows += 3;
  plate.grid.height = plate.grid.rows * plate.grid.cellSize;
}

export function sidewalkSpawn(plate: FloorPlate) {
  for (let row = 0; row < plate.grid.rows; row++) {
    for (let col = 0; col < plate.grid.cols; col++) {
      if (kindAt(plate, col, row) === "sidewalk") {
        const size = plate.grid.cellSize;
        return {
          id: "sidewalk",
          col,
          row,
          x: col * size + size / 2,
          y: row * size + size / 2,
        };
      }
    }
  }
  return plate.spawn;
}

export function elevatorSpawn(plate: FloorPlate) {
  const cell = plate.zones.elevator?.cells?.[0];
  if (!cell) return sidewalkSpawn(plate);
  const size = plate.grid.cellSize;
  return {
    id: "elevator",
    col: cell.col,
    row: cell.row,
    x: cell.col * size + size / 2,
    y: cell.row * size + size / 2,
  };
}

export function spreadConferenceFurniture(plate: FloorPlate) {
  const rooms = plate.conferences ?? [];
  const source =
    rooms.find((room) => room.id === "conf_2_10_2x1") ??
    rooms.find((room) => room.col === 2 && room.row === 10);
  if (!source?.furniture?.length) return;
  const cols = source.cols ?? 1;
  const rows = source.rows ?? 1;
  for (const room of rooms) {
    if (room.id === source.id) continue;
    if ((room.cols ?? 1) !== cols || (room.rows ?? 1) !== rows) continue;
    room.furniture = source.furniture.map((item, i) => ({
      ...item,
      _uid: `${room.id}_${item.id ?? item.type}_${i}`,
    }));
  }
}

export function ensureGridDefaults(plate: FloorPlate) {
  plate.legend = { ...CHAR_KIND, ...plate.legend };
  ensureAssetTypes(plate);
  ensureOutsideStrip(plate);
  plate.conferenceTemplate = defaultConferenceTemplate(plate.grid.cellSize);
  plate.recreationTemplate ??= defaultRecreationTemplate(plate.grid.cellSize);
  plate.libraryTemplate ??= defaultLibraryTemplate(plate.grid.cellSize);
  plate.conferences ??= [];
  plate.recreations ??= [];
  plate.libraries ??= [];
  plate.cubicles ??= [];
  plate.offices ??= [];
  const spawn = sidewalkSpawn(plate);
  plate.spawn = spawn;
}
