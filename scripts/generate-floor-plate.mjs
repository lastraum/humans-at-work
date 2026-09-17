#!/usr/bin/env node
/**
 * Builds data/floor-plate.json from the locked 10x16 spreadsheet.
 * Furniture types and GLB filenames match Claw3D (MIT).
 * https://github.com/iamlukethedev/Claw3D
 */

import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "data", "floor-plate.json");

const COLS = 10;
const CELL = 179;
const WALL = 8;
const DOOR_LEN = 40;
const DOOR_THICK = 8;
const WINDOW_LEN = 90;

/** Spreadsheet: n=no office, x=office, .=channel, u=open desk, E=elevator, K=kitchen */
const CELLS = [
  "nxxxxxxxxn",
  "x........x",
  "x.u.uu.u.x",
  "x.u.uu.u.x",
  "x........x",
  "x.u....u.x",
  "x.u.EE.u.x",
  "x.u.KK.u.x",
  "x.u.KK.u.x",
  "x........x",
  "x.u.uu.u.x",
  "x.u.uu.u.x",
  "x........x",
  "nxxxxxxxxn",
];
const ROWS = CELLS.length;

const KIND = {
  n: "no_office",
  x: "office",
  ".": "channel",
  u: "cube",
  E: "elevator",
  K: "kitchen",
  C: "conference",
  R: "recreation",
  L: "library",
};

const ASSETS = {
  source: {
    repo: "https://github.com/iamlukethedev/Claw3D",
    license: "MIT",
    copyright: "Copyright (c) 2026 Luke The Dev",
    path: "public/office-assets/models/furniture",
  },
  baseUrl: "/office-assets/models/furniture",
  types: {
    desk_cubicle: { glb: "desk.glb", footprint: [100, 55] },
    executive_desk: { glb: "deskCorner.glb", footprint: [130, 65] },
    chair: { glb: "chairDesk.glb", footprint: [24, 24] },
    round_table: { glb: "tableRound.glb", footprint: [120, 120] },
    plant: { glb: "pottedPlant.glb", footprint: [24, 24] },
    table_rect: { glb: "table.glb", footprint: [80, 40] },
    coffee_machine: { glb: "kitchenCoffeeMachine.glb", footprint: [32, 34] },
    fridge: { glb: "kitchenFridgeSmall.glb", footprint: [40, 80] },
    water_cooler: { glb: "plantSmall1.glb", footprint: [20, 54], note: "Claw3D placeholder mesh" },
    cabinet: { glb: "kitchenCabinet.glb", footprint: [200, 40] },
    computer: { glb: "computerScreen.glb", footprint: [30, 20] },
    lamp: { glb: "lampRoundFloor.glb", footprint: [30, 30] },
    couch: { glb: "loungeSofa.glb", footprint: [100, 40] },
    bookcase: { glb: "bookcaseClosed.glb", footprint: [22, 14] },
    lounge_chair: { glb: "loungeDesignChair.glb", footprint: [41, 23] },
    cushion_chair: { glb: "chairModernCushion.glb", footprint: [11, 11] },
    coffee_table: { glb: "tableCoffee.glb", footprint: [37, 22] },
    wall: { glb: null, footprint: [80, 10] },
    door: { glb: null, footprint: [56, 10] },
    window: { glb: null, footprint: [140, 10] },
  },
};

let uid = 0;
const nextUid = (prefix) => `${prefix}_${String(++uid).padStart(3, "0")}`;

const at = (col, row) => CELLS[row][col];
const kindAt = (col, row) => {
  if (col < 0 || row < 0 || col >= COLS || row >= ROWS) return null;
  return KIND[at(col, row)];
};

const cellOrigin = (col, row) => ({ x: col * CELL, y: row * CELL });
const cellCenter = (col, row) => ({
  x: col * CELL + CELL / 2,
  y: row * CELL + CELL / 2,
});

/** 0 = +Y (south / down the sheet), 90 = +X (east). Person faces this way. */
function officeFacing(col, row) {
  if (row === 0) return 0;
  if (row === ROWS - 1) return 180;
  if (col === 0) return 90;
  if (col === COLS - 1) return 270;
  return 0;
}

function doorEdge(col, row) {
  if (row === 0) return "s";
  if (row === ROWS - 1) return "n";
  if (col === 0) return "e";
  if (col === COLS - 1) return "w";
  return "s";
}

function windowEdge(door) {
  return { s: "n", n: "s", e: "w", w: "e" }[door];
}

function cubeFacing(col, row) {
  if (col <= 2) return 90;
  if (col >= 7) return 270;
  if (row < 8) return 0;
  return 180;
}

function placeDeskSet({ id, col, row, facing, deskType, claim }) {
  const { x: ox, y: oy } = cellOrigin(col, row);
  const [long, depth] = ASSETS.types[deskType].footprint;
  const chair = 24;
  const gap = 12;
  let placeW;
  let placeH;
  let deskX;
  let deskY;
  let deskFacing = facing;
  let chairX;
  let chairY;
  let chairFacing = facing;
  let pcX;
  let pcY;
  let pcFacing = facing;
  let lampX;
  let lampY;

  if (claim === "office") {
    // Flush to the right-hand partition, centered along it.
    // N/S offices: vertical desk on E/W wall. E/W offices: horizontal desk on N/S wall.
    const pad = WALL;
    deskX = ox + (CELL - long) / 2;
    deskY = oy + (CELL - long) / 2;
    if (facing === 0) {
      placeW = depth;
      placeH = long;
      deskX = ox + pad;
      deskY = oy + (CELL - placeH) / 2;
      deskFacing = 270;
      chairFacing = 270;
      chairX = deskX + placeW + 6;
      chairY = deskY + 18;
    } else if (facing === 180) {
      placeW = depth;
      placeH = long;
      deskX = ox + CELL - pad - placeW;
      deskY = oy + (CELL - placeH) / 2;
      deskFacing = 90;
      chairFacing = 90;
      chairX = deskX - chair - 6;
      chairY = deskY + placeH - chair - 18;
    } else if (facing === 90) {
      placeW = long;
      placeH = depth;
      deskX = ox + (CELL - placeW) / 2;
      deskY = oy + pad;
      deskFacing = 0;
      chairFacing = 0;
      chairX = deskX + placeW - chair - 18;
      chairY = deskY + placeH + 6;
    } else {
      placeW = long;
      placeH = depth;
      deskX = ox + (CELL - placeW) / 2;
      deskY = oy + CELL - pad - placeH;
      deskFacing = 180;
      chairFacing = 180;
      chairX = deskX + 18;
      chairY = deskY - chair - 6;
    }
  } else {
    const alongWall = facing === 90 || facing === 270;
    placeW = alongWall ? depth : long;
    placeH = alongWall ? long : depth;
    deskX = ox + (CELL - placeW) / 2;
    deskY = oy + (CELL - placeH) / 2;
    chairX = deskX + (placeW - chair) / 2;
    chairY = deskY + (placeH - chair) / 2;
    if (facing === 0) chairY = deskY - gap - chair;
    else if (facing === 180) chairY = deskY + placeH + gap;
    else if (facing === 90) chairX = deskX - gap - chair;
    else chairX = deskX + placeW + gap;
  }

  const [cw, ch] = ASSETS.types.computer.footprint;
  const edge = 10;
  pcX = deskX + placeW / 2 - cw / 2;
  pcY = deskY + placeH / 2 - ch / 2;
  if (claim === "office") {
    if (facing === 0) {
      pcX = deskX + placeW - cw - 8;
      pcY = deskY + 12;
      pcFacing = 180;
    } else if (facing === 180) {
      pcX = deskX + 8;
      pcY = deskY + placeH - ch - 12;
      pcFacing = 0;
    } else if (facing === 90) {
      pcX = deskX + placeW - cw - 12;
      pcY = deskY + placeH - ch - 8;
      pcFacing = 0;
    } else {
      pcX = deskX + 12;
      pcY = deskY + 8;
      pcFacing = 180;
    }
  }

  lampX = deskX + 10;
  lampY = deskY + 10;
  if (facing === 0) lampY = deskY + (placeH - 28) / 2;
  else if (facing === 180) lampY = deskY + (placeH - 28) / 2;
  else if (facing === 90) lampX = deskX + (placeW - 28) / 2;
  else lampX = deskX + (placeW - 28) / 2;

  const items = [
    {
      _uid: nextUid("desk"),
      type: deskType,
      id,
      x: round(deskX),
      y: round(deskY),
      w: placeW,
      h: placeH,
      facing: deskFacing,
    },
    {
      _uid: nextUid("chair"),
      type: "chair",
      x: round(chairX),
      y: round(chairY),
      facing: chairFacing,
    },
    {
      _uid: nextUid("pc"),
      type: "computer",
      x: round(pcX),
      y: round(pcY),
      facing: pcFacing,
    },
    {
      _uid: nextUid("lamp"),
      type: "lamp",
      x: round(lampX),
      y: round(lampY),
      facing,
    },
  ];

  if (claim === "office") {
    const [cw, ch] = ASSETS.types.couch.footprint;
    const pad = WALL + 28;
    let cx;
    let cy;
    let couchFacing;
    if (facing === 0) {
      cx = ox + pad + ch / 2;
      cy = oy + CELL / 2;
      couchFacing = 90;
    } else if (facing === 180) {
      cx = ox + CELL - pad - ch / 2;
      cy = oy + CELL / 2;
      couchFacing = 270;
    } else if (facing === 90) {
      cx = ox + CELL / 2;
      cy = oy + CELL - pad - ch / 2;
      couchFacing = 180;
    } else {
      cx = ox + CELL / 2;
      cy = oy + pad + ch / 2;
      couchFacing = 0;
    }
    items.push({
      _uid: nextUid("couch"),
      type: "couch",
      x: round(cx - cw / 2),
      y: round(cy - ch / 2),
      w: cw,
      h: ch,
      facing: couchFacing,
    });
  }

  return { claim, furniture: items };
}

function doorItem(col, row, edge) {
  const { x: ox, y: oy } = cellOrigin(col, row);
  const mid = CELL / 2 - DOOR_LEN / 2;
  const base = {
    _uid: nextUid("door"),
    type: "door",
    hinge: "left",
    open: 0.38,
    doorEdge: edge,
  };
  if (edge === "s") {
    return {
      ...base,
      x: round(ox + mid),
      y: round(oy + CELL - DOOR_THICK),
      w: DOOR_LEN,
      h: DOOR_THICK,
      facing: 0,
    };
  }
  if (edge === "n") {
    return {
      ...base,
      x: round(ox + mid),
      y: round(oy),
      w: DOOR_LEN,
      h: DOOR_THICK,
      facing: 180,
    };
  }
  if (edge === "e") {
    return {
      ...base,
      x: round(ox + CELL - DOOR_THICK),
      y: round(oy + mid),
      w: DOOR_THICK,
      h: DOOR_LEN,
      facing: 90,
    };
  }
  return {
    ...base,
    x: round(ox),
    y: round(oy + mid),
    w: DOOR_THICK,
    h: DOOR_LEN,
    facing: 270,
  };
}

function windowItem(col, row, edge) {
  const { x: ox, y: oy } = cellOrigin(col, row);
  const mid = CELL / 2 - WINDOW_LEN / 2;
  const base = {
    _uid: nextUid("win"),
    type: "window",
    windowEdge: edge,
  };
  if (edge === "n") {
    return { ...base, x: round(ox + mid), y: round(oy), w: WINDOW_LEN, h: WALL };
  }
  if (edge === "s") {
    return {
      ...base,
      x: round(ox + mid),
      y: round(oy + CELL - WALL),
      w: WINDOW_LEN,
      h: WALL,
    };
  }
  if (edge === "w") {
    return { ...base, x: round(ox), y: round(oy + mid), w: WALL, h: WINDOW_LEN };
  }
  return {
    ...base,
    x: round(ox + CELL - WALL),
    y: round(oy + mid),
    w: WALL,
    h: WINDOW_LEN,
  };
}

function splitWall(edge, openingLen) {
  const gap0 = CELL / 2 - openingLen / 2;
  const gap1 = gap0 + openingLen;
  return { gap0, gap1 };
}

function addWindowPanel(x, y, w, h, edge) {
  if (w <= 0 || h <= 0) return null;
  return {
    _uid: nextUid("win"),
    type: "window",
    windowEdge: edge,
    x: round(x),
    y: round(y),
    w: round(w),
    h: round(h),
  };
}

function glassFront(col, row, edge) {
  const { x: ox, y: oy } = cellOrigin(col, row);
  const { gap0, gap1 } = splitWall(edge, DOOR_LEN);
  const panes = [];
  if (edge === "n") {
    panes.push(addWindowPanel(ox, oy, gap0, WALL, "n"));
    panes.push(addWindowPanel(ox + gap1, oy, CELL - gap1, WALL, "n"));
  } else if (edge === "s") {
    panes.push(addWindowPanel(ox, oy + CELL - WALL, gap0, WALL, "s"));
    panes.push(addWindowPanel(ox + gap1, oy + CELL - WALL, CELL - gap1, WALL, "s"));
  } else if (edge === "w") {
    panes.push(addWindowPanel(ox, oy, WALL, gap0, "w"));
    panes.push(addWindowPanel(ox, oy + gap1, WALL, CELL - gap1, "w"));
  } else {
    panes.push(addWindowPanel(ox + CELL - WALL, oy, WALL, gap0, "e"));
    panes.push(
      addWindowPanel(ox + CELL - WALL, oy + gap1, WALL, CELL - gap1, "e"),
    );
  }
  return panes.filter(Boolean);
}

function officeWalls(col, row, door, window) {
  const { x: ox, y: oy } = cellOrigin(col, row);
  const walls = [];
  const add = (x, y, w, h) => {
    if (w <= 0 || h <= 0) return;
    walls.push({
      _uid: nextUid("wall"),
      type: "wall",
      x: round(x),
      y: round(y),
      w: round(w),
      h: round(h),
    });
  };

  const north = splitWall("n", window === "n" ? WINDOW_LEN : 0);
  if (door === "n") {
    // glass front, no solid wall
  } else if (window === "n") {
    add(ox, oy, north.gap0, WALL);
    add(ox + north.gap1, oy, CELL - north.gap1, WALL);
  } else {
    add(ox, oy, CELL, WALL);
  }

  const south = splitWall("s", window === "s" ? WINDOW_LEN : 0);
  if (door === "s") {
    // glass front
  } else if (window === "s") {
    add(ox, oy + CELL - WALL, south.gap0, WALL);
    add(ox + south.gap1, oy + CELL - WALL, CELL - south.gap1, WALL);
  } else {
    add(ox, oy + CELL - WALL, CELL, WALL);
  }

  const west = splitWall("w", window === "w" ? WINDOW_LEN : 0);
  if (door === "w") {
    // glass front
  } else if (window === "w") {
    add(ox, oy, WALL, west.gap0);
    add(ox, oy + west.gap1, WALL, CELL - west.gap1);
  } else {
    add(ox, oy, WALL, CELL);
  }

  const east = splitWall("e", window === "e" ? WINDOW_LEN : 0);
  if (door === "e") {
    // glass front
  } else if (window === "e") {
    add(ox + CELL - WALL, oy, WALL, east.gap0);
    add(ox + CELL - WALL, oy + east.gap1, WALL, CELL - east.gap1);
  } else {
    add(ox + CELL - WALL, oy, WALL, CELL);
  }

  return walls;
}

function round(n) {
  return Math.round(n * 10) / 10;
}

function rectCenter(cells) {
  const xs = cells.map((c) => c.col);
  const ys = cells.map((c) => c.row);
  const minC = Math.min(...xs);
  const maxC = Math.max(...xs);
  const minR = Math.min(...ys);
  const maxR = Math.max(...ys);
  return {
    x: ((minC + maxC + 1) * CELL) / 2,
    y: ((minR + maxR + 1) * CELL) / 2,
    col: (minC + maxC) / 2,
    row: (minR + maxR) / 2,
  };
}

const offices = [];
const cubes = [];
const elevatorCells = [];
const kitchenCells = [];
const furniture = [];
const rooms = [];

for (let row = 0; row < ROWS; row++) {
  for (let col = 0; col < COLS; col++) {
    const kind = kindAt(col, row);
    if (kind === "office") {
      const facing = officeFacing(col, row);
      const id = `office_${String(offices.length + 1).padStart(2, "0")}`;
      let rot = 0;
      if (row === ROWS - 1) rot = 0;
      else if (col === 0) rot = 90;
      else if (row === 0) rot = 180;
      else if (col === COLS - 1) rot = 270;
      const c = cellCenter(col, row);
      offices.push({
        id,
        col,
        row,
        facing,
        rot,
        seat: { x: c.x, y: c.y },
        center: c,
      });
    } else if (kind === "cube") {
      const id = `cube_${String(cubes.length + 1).padStart(2, "0")}`;
      const c = cellCenter(col, row);
      cubes.push({
        id,
        col,
        row,
        rot: 0,
        facing: 0,
        seat: { x: c.x, y: c.y },
        center: c,
      });
    } else if (kind === "elevator") {
      elevatorCells.push({ col, row });
    } else if (kind === "kitchen") {
      kitchenCells.push({ col, row });
    }
  }
}

function addOpeningWall(x, y, alongX, span, openingLen) {
  const gap0 = span / 2 - openingLen / 2;
  const gap1 = gap0 + openingLen;
  if (alongX) {
    furniture.push(
      {
        _uid: nextUid("wall"),
        type: "wall",
        x: round(x),
        y: round(y),
        w: round(gap0),
        h: WALL,
      },
      {
        _uid: nextUid("wall"),
        type: "wall",
        x: round(x + gap1),
        y: round(y),
        w: round(span - gap1),
        h: WALL,
      },
      {
        _uid: nextUid("door"),
        type: "door",
        hinge: "left",
        open: 0.38,
        doorEdge: "s",
        x: round(x + gap0),
        y: round(y),
        w: openingLen,
        h: WALL,
        facing: 0,
      },
    );
  } else {
    furniture.push(
      {
        _uid: nextUid("wall"),
        type: "wall",
        x: round(x),
        y: round(y),
        w: WALL,
        h: round(gap0),
      },
      {
        _uid: nextUid("wall"),
        type: "wall",
        x: round(x),
        y: round(y + gap1),
        w: WALL,
        h: round(span - gap1),
      },
      {
        _uid: nextUid("door"),
        type: "door",
        hinge: "left",
        open: 0.38,
        doorEdge: "e",
        x: round(x),
        y: round(y + gap0),
        w: WALL,
        h: openingLen,
        facing: 90,
      },
    );
  }
}

function addCoreRooms() {
  const minC = Math.min(...elevatorCells.map((c) => c.col));
  const maxC = Math.max(...elevatorCells.map((c) => c.col));
  const minR = Math.min(...elevatorCells.map((c) => c.row));
  const maxR = Math.max(...elevatorCells.map((c) => c.row));
  const x0 = minC * CELL;
  const y0 = minR * CELL;
  const spanW = (maxC - minC + 1) * CELL;
  const spanH = (maxR - minR + 1) * CELL;

  furniture.push(
    {
      _uid: nextUid("wall"),
      type: "wall",
      x: round(x0),
      y: round(y0),
      w: WALL,
      h: round(spanH),
    },
    {
      _uid: nextUid("wall"),
      type: "wall",
      x: round(x0 + spanW - WALL),
      y: round(y0),
      w: WALL,
      h: round(spanH),
    },
    {
      _uid: nextUid("wall"),
      type: "wall",
      x: round(x0),
      y: round(y0 + spanH - WALL),
      w: round(spanW),
      h: WALL,
    },
  );
  addOpeningWall(x0, y0, true, spanW, DOOR_LEN);
}

const elev = rectCenter(elevatorCells);
const kit = rectCenter(kitchenCells);
addCoreRooms();

furniture.push(
  {
    _uid: nextUid("fridge"),
    type: "fridge",
    x: round(kit.x - 110),
    y: round(kit.y - 80),
    w: 40,
    h: 80,
    facing: 90,
  },
  {
    _uid: nextUid("coffee"),
    type: "coffee_machine",
    x: round(kit.x - 32),
    y: round(kit.y - 64),
    facing: 180,
  },
  {
    _uid: nextUid("cooler"),
    type: "water_cooler",
    x: round(kit.x + 58),
    y: round(kit.y - 64),
    facing: 180,
  },
  {
    _uid: nextUid("cab"),
    type: "cabinet",
    x: round(kit.x - 160),
    y: round(kit.y + 64),
    w: 200,
    h: 40,
    facing: 0,
  },
  {
    _uid: nextUid("table"),
    type: "round_table",
    x: round(kit.x - 64),
    y: round(kit.y + 16),
    r: 36,
  },
  {
    _uid: nextUid("kchair"),
    type: "chair",
    x: round(kit.x + 32),
    y: round(kit.y + 28),
    facing: 270,
  },
  {
    _uid: nextUid("plant"),
    type: "plant",
    x: round(kit.x + 112),
    y: round(kit.y + 80),
  },
);

const coolerCells = [
  ...kitchenCells,
  { col: 3, row: 7 },
  { col: 6, row: 7 },
  { col: 3, row: 8 },
  { col: 6, row: 8 },
  { col: 4, row: 9 },
  { col: 5, row: 9 },
];

function buildOfficeTemplate() {
  const items = [
    {
      _uid: "tpl_desk",
      type: "executive_desk",
      id: "desk",
      x: 94.6,
      y: 20.5,
      w: 65,
      h: 130,
      facing: 90,
    },
    {
      _uid: "tpl_chair",
      type: "chair",
      id: "chair",
      x: 35,
      y: 70.9,
      facing: 180,
    },
    {
      _uid: "tpl_pc",
      type: "computer",
      id: "pc",
      x: 16.6,
      y: 86,
      facing: 90,
    },
    {
      _uid: "tpl_lamp",
      type: "lamp",
      id: "lamp",
      x: 155.4,
      y: 34.2,
      facing: 0,
    },
    {
      _uid: "tpl_couch",
      type: "couch",
      id: "couch",
      x: 74.8,
      y: 78.5,
      w: 100,
      h: 40,
      facing: 270,
    },
  ];
  const structure = [
    ...officeWalls(0, 0, "n", "s"),
    doorItem(0, 0, "n"),
    windowItem(0, 0, "s"),
    ...glassFront(0, 0, "n"),
  ];
  return { size: CELL, furniture: items, structure };
}

function buildCubicleTemplate() {
  return {
    size: CELL,
    structure: [],
    furniture: [
      {
        _uid: "cub_desk_a",
        type: "desk_cubicle",
        id: "desk_a",
        x: -20.1,
        y: 82.6,
        w: 100,
        h: 55,
        facing: 270,
      },
      {
        _uid: "cub_chair_a",
        type: "chair",
        id: "chair_a",
        x: 54,
        y: 86.8,
        facing: 90,
      },
      {
        _uid: "cub_pc_a",
        type: "computer",
        id: "pc_a",
        x: 49.8,
        y: 97.4,
        facing: 270,
      },
      {
        _uid: "cub_desk_b",
        type: "desk_cubicle",
        id: "desk_b",
        x: 107.9,
        y: 41.3,
        w: 100,
        h: 55,
        facing: 90,
      },
      {
        _uid: "cub_chair_b",
        type: "chair",
        id: "chair_b",
        x: 112.9,
        y: 66.9,
        facing: 270,
      },
      {
        _uid: "cub_pc_b",
        type: "computer",
        id: "pc_b",
        x: 109.2,
        y: 62.6,
        facing: 90,
      },
    ],
  };
}

const walkable = [];
for (let row = 0; row < ROWS; row++) {
  const line = [];
  for (let col = 0; col < COLS; col++) {
    const k = kindAt(col, row);
    line.push(k === "channel" || k === "elevator" || k === "kitchen" ? 1 : 0);
  }
  walkable.push(line);
}

const floor = {
  id: "floor-1",
  name: "Ground",
  version: 1,
  notes:
    "Locked spreadsheet layout. Feel of Claw3D / image 9. Perimeter offices, channel grid, open cubes, elevator over kitchen.",
  grid: {
    cols: COLS,
    rows: ROWS,
    cellSize: CELL,
    width: COLS * CELL,
    height: ROWS * CELL,
    origin: { x: 0, y: 0 },
    yIncreasesSouth: true,
    facingZero: "+Y south",
  },
  legend: {
    n: "no_office",
    x: "office",
    ".": "channel",
    u: "cube",
    E: "elevator",
    K: "kitchen",
    C: "conference",
    R: "recreation",
    L: "library",
  },
  cells: CELLS,
  walkable,
  walkableKinds: ["channel", "elevator", "kitchen", "recreation", "library"],
  spawn: {
    id: "elevator",
    col: elev.col,
    row: elev.row,
    x: round(elev.x),
    y: round(elev.y),
  },
  claimable: {
    offices,
    cubes,
  },
  zones: {
    elevator: {
      id: "elevator",
      cells: elevatorCells,
      center: { x: round(elev.x), y: round(elev.y) },
    },
    kitchen: {
      id: "kitchen",
      cells: kitchenCells,
      center: { x: round(kit.x), y: round(kit.y) },
    },
    cooler: {
      id: "cooler",
      cells: coolerCells,
      voice: true,
    },
  },
  officeTemplate: buildOfficeTemplate(),
  offices: offices.map((o) => ({
    id: o.id,
    col: o.col,
    row: o.row,
    rot: o.rot,
  })),
  cubicleTemplate: buildCubicleTemplate(),
  cubicles: cubes.map((o) => ({
    id: o.id,
    col: o.col,
    row: o.row,
    rot: 0,
  })),
  avatars: [
    {
      id: "ada",
      pose: "sit",
      officeId: offices[3]?.id,
      col: offices[3]?.col,
      row: offices[3]?.row,
      facing: offices[3]?.facing,
      x: offices[3]?.seat.x,
      y: offices[3]?.seat.y,
      color: "#3d7a5a",
    },
    {
      id: "niko",
      pose: "sit",
      officeId: offices[18]?.id,
      col: offices[18]?.col,
      row: offices[18]?.row,
      facing: offices[18]?.facing,
      x: offices[18]?.seat.x,
      y: offices[18]?.seat.y,
      color: "#3d5c8a",
    },
    {
      id: "ren",
      pose: "stand",
      facing: 180,
      x: round(kit.x + 40),
      y: round(kit.y + 70),
      color: "#c45c26",
    },
  ],
  counts: {
    offices: offices.length,
    cubes: cubes.length,
    elevatorCells: elevatorCells.length,
    kitchenCells: kitchenCells.length,
    furniture: furniture.length,
  },
  assets: ASSETS,
  furniture,
};

if (offices.length !== 40) {
  throw new Error(`expected 40 offices, got ${offices.length}`);
}
if (cubes.length !== 24) {
  throw new Error(`expected 24 cubes, got ${cubes.length}`);
}

writeFileSync(OUT, JSON.stringify(floor, null, 2) + "\n");
console.log(
  `wrote ${OUT} offices=${offices.length} cubes=${cubes.length} furniture=${furniture.length}`,
);
