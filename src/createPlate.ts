import * as THREE from "three";
import {
  SCALE,
  cellToWorld,
  getItemSize,
  itemRotation,
  toWorld,
} from "./coords";
import { CHAR_KIND, INDOOR_KINDS, kindAt } from "./grid";
import type { CellKind, FloorPlate, FurnitureItem } from "./types";

/** Pull openings off the wall plane so glass/frames don't share faces with walls. */
const OPENING_INSET = 0.03;
const WINDOW_INSET = 0.05;
const WALL_SHRINK = 0.018;

function insetByEdge(obj: THREE.Object3D, edge: string, amount: number) {
  if (edge === "n") obj.position.z += amount;
  else if (edge === "s") obj.position.z -= amount;
  else if (edge === "w") obj.position.x += amount;
  else if (edge === "e") obj.position.x -= amount;
}

export const TILE: Record<CellKind, number> = {
  no_office: 0x3d6b3a,
  office: 0xc4b4a0,
  channel: 0xb8b8b4,
  cube: 0x9a9084,
  elevator: 0xd8dce2,
  kitchen: 0x7ea0c4,
  conference: 0x8a6a9a,
  recreation: 0xd4a05a,
  sidewalk: 0xc8c2b4,
  parking: 0x3c3e46,
};

export function createGround(plate: FloorPlate) {
  const root = new THREE.Group();
  root.name = "ground";
  const tiles = new THREE.Group();
  tiles.name = "tiles";

  const grass = new THREE.Mesh(
    new THREE.PlaneGeometry(grassSize(plate).w, grassSize(plate).h),
    new THREE.MeshStandardMaterial({ color: 0x5c9a52, roughness: 1 }),
  );
  grass.name = "grass";
  grass.rotation.x = -Math.PI / 2;
  grass.position.y = -0.02;
  grass.receiveShadow = true;
  root.add(grass);

  fillTiles(tiles, plate);
  root.add(tiles);
  root.add(createRoof(plate));
  root.add(createParkingLot(plate));
  root.add(createPark(plate));
  return root;
}

function fillTiles(tiles: THREE.Group, plate: FloorPlate) {
  while (tiles.children.length) tiles.remove(tiles.children[0]);
  const cell = plate.grid.cellSize * SCALE;
  const geo = new THREE.PlaneGeometry(cell + 0.012, cell + 0.012);
  for (let row = 0; row < plate.grid.rows; row++) {
    for (let col = 0; col < plate.grid.cols; col++) {
      const ch = plate.cells[row][col];
      const kind = CHAR_KIND[ch];
      if (!kind) continue;
      const mesh = new THREE.Mesh(
        geo,
        new THREE.MeshStandardMaterial({
          color: TILE[kind],
          roughness: kind === "channel" ? 0.85 : 0.95,
          emissive: 0x000000,
        }),
      );
      const [wx, , wz] = cellToWorld(col, row, plate);
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.set(wx + cell / 2, 0, wz + cell / 2);
      mesh.receiveShadow = true;
      mesh.userData = { col, row, kind };
      tiles.add(mesh);
    }
  }
}

export function refreshGround(ground: THREE.Group, plate: FloorPlate) {
  const grass = ground.getObjectByName("grass") as THREE.Mesh | undefined;
  if (grass) {
    grass.geometry.dispose();
    grass.geometry = new THREE.PlaneGeometry(grassSize(plate).w, grassSize(plate).h);
  }
  const tiles = ground.getObjectByName("tiles") as THREE.Group | undefined;
  if (tiles) fillTiles(tiles, plate);
  const roof = ground.getObjectByName("roof");
  if (roof) {
    ground.remove(roof);
    ground.add(createRoof(plate));
  }
  const cars = ground.getObjectByName("parking-lot");
  if (cars) {
    ground.remove(cars);
    ground.add(createParkingLot(plate));
  }
  const park = ground.getObjectByName("park");
  if (park) {
    ground.remove(park);
    ground.add(createPark(plate));
  }
}

export const STORY_H = 1.08;
export const STORY_COUNT = 10;

export type ParkingStall = {
  id: string;
  col: number;
  row: number;
  slot: number;
  occupied: boolean;
  x: number;
  z: number;
  rotY: number;
  sidewalkCol: number;
  sidewalkRow: number;
};

function indoorCell(plate: FloorPlate, col: number, row: number) {
  const kind = kindAt(plate, col, row);
  return Boolean(kind && INDOOR_KINDS.includes(kind));
}

function indoorBounds(plate: FloorPlate) {
  let minC = Infinity;
  let minR = Infinity;
  let maxC = -Infinity;
  let maxR = -Infinity;
  for (let row = 0; row < plate.grid.rows; row++) {
    for (let col = 0; col < plate.grid.cols; col++) {
      if (!indoorCell(plate, col, row)) continue;
      minC = Math.min(minC, col);
      minR = Math.min(minR, row);
      maxC = Math.max(maxC, col);
      maxR = Math.max(maxR, row);
    }
  }
  return { minC, minR, maxC, maxR };
}

export function createRoof(plate: FloorPlate) {
  const root = new THREE.Group();
  root.name = "roof";
  const b = indoorBounds(plate);
  if (!Number.isFinite(b.minC)) return root;
  const cell = plate.grid.cellSize * SCALE;
  const wallMat = new THREE.MeshStandardMaterial({
    color: 0x8a8680,
    roughness: 0.92,
  });
  const glassMat = new THREE.MeshStandardMaterial({
    color: 0xa8d4ee,
    emissive: 0x1b3d66,
    emissiveIntensity: 0.25,
    transparent: true,
    opacity: 0.45,
    roughness: 0.12,
    depthWrite: false,
  });
  const roofMat = new THREE.MeshStandardMaterial({
    color: 0x6a6560,
    roughness: 0.92,
  });
  const thick = 0.12;
  const edges: { dc: number; dr: number; alongX: boolean }[] = [
    { dc: 0, dr: -1, alongX: true },
    { dc: 0, dr: 1, alongX: true },
    { dc: -1, dr: 0, alongX: false },
    { dc: 1, dr: 0, alongX: false },
  ];

  for (let story = 1; story < STORY_COUNT; story++) {
    const y0 = story * STORY_H;
    for (let row = 0; row < plate.grid.rows; row++) {
      for (let col = 0; col < plate.grid.cols; col++) {
        if (!indoorCell(plate, col, row)) continue;
        const [cx, , cz] = cellToWorld(col, row, plate);
        const mx = cx + cell / 2;
        const mz = cz + cell / 2;
        for (const edge of edges) {
          if (indoorCell(plate, col + edge.dc, row + edge.dr)) continue;
          const wall = new THREE.Mesh(
            new THREE.BoxGeometry(
              edge.alongX ? cell : thick,
              STORY_H,
              edge.alongX ? thick : cell,
            ),
            wallMat,
          );
          wall.position.set(
            mx + edge.dc * (cell / 2 - thick / 2),
            y0 + STORY_H / 2,
            mz + edge.dr * (cell / 2 - thick / 2),
          );
          wall.castShadow = true;
          root.add(wall);
          const glass = new THREE.Mesh(
            new THREE.BoxGeometry(
              edge.alongX ? cell * 0.62 : 0.04,
              STORY_H * 0.42,
              edge.alongX ? 0.04 : cell * 0.62,
            ),
            glassMat,
          );
          glass.position.set(
            mx + edge.dc * (cell / 2 - thick / 2 + 0.02),
            y0 + STORY_H * 0.55,
            mz + edge.dr * (cell / 2 - thick / 2 + 0.02),
          );
          glass.renderOrder = 2;
          root.add(glass);
        }
      }
    }
  }

  const w = (b.maxC - b.minC + 1) * cell;
  const d = (b.maxR - b.minR + 1) * cell;
  const [wx, , wz] = cellToWorld(b.minC, b.minR, plate);
  const lid = new THREE.Mesh(
    new THREE.BoxGeometry(w + 0.1, 0.08, d + 0.1),
    roofMat,
  );
  lid.position.set(wx + w / 2, STORY_H, wz + d / 2);
  lid.receiveShadow = true;
  root.add(lid);
  const cap = new THREE.Mesh(
    new THREE.BoxGeometry(w + 0.16, 0.1, d + 0.16),
    roofMat,
  );
  cap.position.set(wx + w / 2, STORY_COUNT * STORY_H + 0.04, wz + d / 2);
  cap.receiveShadow = true;
  cap.castShadow = true;
  root.add(cap);
  return root;
}

export function makeCar(color: number) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(0.95, 0.28, 0.48),
    new THREE.MeshStandardMaterial({ color, roughness: 0.45, metalness: 0.2 }),
  );
  body.position.y = 0.2;
  body.castShadow = true;
  const cabin = new THREE.Mesh(
    new THREE.BoxGeometry(0.46, 0.22, 0.42),
    new THREE.MeshStandardMaterial({ color: 0x8ab4d4, roughness: 0.2, metalness: 0.15 }),
  );
  cabin.position.set(-0.08, 0.4, 0);
  const wheelMat = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.9 });
  for (const [x, z] of [
    [0.28, 0.22],
    [0.28, -0.22],
    [-0.28, 0.22],
    [-0.28, -0.22],
  ]) {
    const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.08, 10), wheelMat);
    wheel.rotation.z = Math.PI / 2;
    wheel.position.set(x, 0.1, z);
    g.add(wheel);
  }
  g.add(body);
  g.add(cabin);
  return g;
}

const GRASS_PAD = 18;
const GRASS_SPREAD = 3;
const PARKING_DEPTH_SCALE = 3;

function mulberry(seed: number) {
  let t = (seed + 0x6d2b79f5) | 0;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

function makeTree(seed: number) {
  const g = new THREE.Group();
  const h = 0.55 + mulberry(seed) * 0.35;
  const trunk = new THREE.Mesh(
    new THREE.CylinderGeometry(0.06, 0.09, h, 6),
    new THREE.MeshStandardMaterial({ color: 0x6b4a2a, roughness: 0.95 }),
  );
  trunk.position.y = h / 2;
  trunk.castShadow = true;
  g.add(trunk);
  const greens = [0x2f7a38, 0x3d8c44, 0x4a9a4e];
  const count = 2 + Math.floor(mulberry(seed + 3) * 2);
  for (let i = 0; i < count; i++) {
    const r = 0.32 + mulberry(seed + 11 + i) * 0.18;
    const leaf = new THREE.Mesh(
      new THREE.SphereGeometry(r, 8, 6),
      new THREE.MeshStandardMaterial({
        color: greens[(seed + i) % greens.length],
        roughness: 0.9,
      }),
    );
    leaf.position.set(
      (mulberry(seed + 21 + i) - 0.5) * 0.22,
      h + 0.12 + i * 0.16,
      (mulberry(seed + 31 + i) - 0.5) * 0.22,
    );
    leaf.castShadow = true;
    g.add(leaf);
  }
  return g;
}

function makeParkBench() {
  const g = new THREE.Group();
  const wood = new THREE.MeshStandardMaterial({ color: 0x8a6a3a, roughness: 0.85 });
  const iron = new THREE.MeshStandardMaterial({ color: 0x3a3a40, roughness: 0.6, metalness: 0.2 });
  const seat = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.05, 0.28), wood);
  seat.position.y = 0.28;
  const back = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.28, 0.05), wood);
  back.position.set(0, 0.44, -0.12);
  g.add(seat, back);
  for (const x of [-0.28, 0.28]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.28, 0.26), iron);
    leg.position.set(x, 0.14, 0);
    g.add(leg);
  }
  seat.castShadow = true;
  back.castShadow = true;
  return g;
}

const PARK_LAWN = new THREE.MeshStandardMaterial({ color: 0x6aaa58, roughness: 1 });
const PARK_GREEN = new THREE.MeshStandardMaterial({ color: 0x4f8f46, roughness: 1 });
const PARK_PATH = new THREE.MeshStandardMaterial({ color: 0xcbb889, roughness: 0.95 });

function addParkPath(
  root: THREE.Group,
  x1: number,
  z1: number,
  x2: number,
  z2: number,
  width: number,
) {
  const dx = x2 - x1;
  const dz = z2 - z1;
  const len = Math.hypot(dx, dz);
  if (len < 0.05) return;
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, 0.02, len), PARK_PATH);
  mesh.position.set((x1 + x2) / 2, 0.012, (z1 + z2) / 2);
  mesh.rotation.y = Math.atan2(dx, dz);
  mesh.receiveShadow = true;
  root.add(mesh);
}

function addPathCap(root: THREE.Group, x: number, z: number, radius: number) {
  const cap = new THREE.Mesh(new THREE.CircleGeometry(radius, 20), PARK_PATH);
  cap.rotation.x = -Math.PI / 2;
  cap.position.set(x, 0.013, z);
  cap.receiveShadow = true;
  root.add(cap);
}

function addParkCircle(
  root: THREE.Group,
  cx: number,
  cz: number,
  cell: number,
  radius: number,
  seed: number,
  trees: number,
  benches: number,
) {
  const lawn = new THREE.Mesh(new THREE.CircleGeometry(cell * radius, 24), PARK_LAWN);
  lawn.rotation.x = -Math.PI / 2;
  lawn.position.set(cx, 0.005, cz);
  lawn.receiveShadow = true;
  root.add(lawn);

  const ringInner = cell * radius * 0.22;
  const ringOuter = cell * radius * 0.34;
  const path = new THREE.Mesh(new THREE.RingGeometry(ringInner, ringOuter, 24), PARK_PATH);
  path.rotation.x = -Math.PI / 2;
  path.position.set(cx, 0.013, cz);
  path.receiveShadow = true;
  root.add(path);

  const green = new THREE.Mesh(new THREE.CircleGeometry(ringInner - 0.02, 20), PARK_GREEN);
  green.rotation.x = -Math.PI / 2;
  green.position.set(cx, 0.01, cz);
  green.receiveShadow = true;
  root.add(green);

  for (let i = 0; i < trees; i++) {
    const a = (i / trees) * Math.PI * 2 + seed * 0.07;
    const r = cell * radius * (0.52 + mulberry(seed + i * 17) * 0.32);
    const tree = makeTree(seed + i * 13);
    tree.position.set(cx + Math.cos(a) * r, 0, cz + Math.sin(a) * r);
    tree.rotation.y = mulberry(seed + i * 9) * Math.PI * 2;
    root.add(tree);
  }

  for (let i = 0; i < benches; i++) {
    const ang = (i / benches) * Math.PI * 2 + 0.5;
    const bench = makeParkBench();
    const r = (ringInner + ringOuter) * 0.5;
    bench.position.set(cx + Math.cos(ang) * r, 0, cz + Math.sin(ang) * r);
    bench.rotation.y = ang + Math.PI;
    root.add(bench);
  }
}

export function createPark(plate: FloorPlate) {
  const root = new THREE.Group();
  root.name = "park";
  const b = indoorBounds(plate);
  if (!Number.isFinite(b.minC)) return root;
  const cell = plate.grid.cellSize * SCALE;
  const [westX, , northZ] = cellToWorld(b.minC, b.minR, plate);
  const southZ = northZ + (b.maxR - b.minR + 1) * cell;

  const spots = [
    { x: westX - cell * 1.55, z: northZ + cell * 2.1, r: 1.12, seed: 11, trees: 7, benches: 2 },
    { x: westX - cell * 2.05, z: (northZ + southZ) / 2, r: 1.32, seed: 40, trees: 9, benches: 3 },
    { x: westX - cell * 1.42, z: southZ - cell * 0.15, r: 1.08, seed: 73, trees: 6, benches: 2 },
  ];

  for (const spot of spots) {
    addParkCircle(root, spot.x, spot.z, cell, spot.r, spot.seed, spot.trees, spot.benches);
  }
  addParkPath(root, spots[0].x, spots[0].z, spots[1].x, spots[1].z, cell * 0.22);
  addParkPath(root, spots[1].x, spots[1].z, spots[2].x, spots[2].z, cell * 0.22);
  addPathCap(root, spots[0].x, spots[0].z, cell * 0.12);
  addPathCap(root, spots[1].x, spots[1].z, cell * 0.12);
  addPathCap(root, spots[2].x, spots[2].z, cell * 0.12);

  for (let i = 0; i < 4; i++) {
    const tree = makeTree(200 + i * 19);
    tree.position.set(
      westX + (b.maxC - b.minC + 1) * cell + cell * (0.7 + mulberry(i * 5) * 0.6),
      0,
      northZ + (0.2 + mulberry(i * 8)) * (southZ - northZ),
    );
    root.add(tree);
  }
  return root;
}

function grassSize(plate: FloorPlate) {
  return {
    w: (plate.grid.width * SCALE + GRASS_PAD) * GRASS_SPREAD,
    h: (plate.grid.height * SCALE + GRASS_PAD) * GRASS_SPREAD,
  };
}

function sidewalkForCol(plate: FloorPlate, col: number) {
  for (let row = 0; row < plate.grid.rows; row++) {
    if (kindAt(plate, col, row) === "sidewalk") return row;
  }
  return 0;
}

function parkingRowIndices(plate: FloorPlate) {
  const rows: number[] = [];
  for (let row = 0; row < plate.grid.rows; row++) {
    for (let col = 0; col < plate.grid.cols; col++) {
      if (kindAt(plate, col, row) === "parking") {
        rows.push(row);
        break;
      }
    }
  }
  return rows;
}

export function createParkingLot(plate: FloorPlate) {
  const root = new THREE.Group();
  root.name = "parking-lot";
  const stalls: ParkingStall[] = [];
  const colors = [0xc45c26, 0x3d5c8a, 0x3d7a5a, 0x8a3d5c, 0xd4c4a0, 0x2c2c34];
  const asphalt = new THREE.MeshBasicMaterial({ color: 0x2a2c32 });
  const lineMat = new THREE.MeshBasicMaterial({ color: 0xe8e4d8 });
  const padMat = new THREE.MeshBasicMaterial({ color: 0x32343a });
  const cell = plate.grid.cellSize;
  const cellW = cell * SCALE;
  const existing = parkingRowIndices(plate);
  const parkingCols: number[] = [];
  for (let col = 0; col < plate.grid.cols; col++) {
    if (existing.some((row) => kindAt(plate, col, row) === "parking")) parkingCols.push(col);
  }
  const lastRow = existing[existing.length - 1] ?? plate.grid.rows - 1;
  const extraRows = Math.max(0, existing.length * (PARKING_DEPTH_SCALE - 1));
  const cells: { col: number; row: number }[] = [];
  for (const row of existing) {
    for (let col = 0; col < plate.grid.cols; col++) {
      if (kindAt(plate, col, row) === "parking") cells.push({ col, row });
    }
  }
  for (let i = 1; i <= extraRows; i++) {
    for (const col of parkingCols) cells.push({ col, row: lastRow + i });
  }

  let npc = 0;
  for (const { col, row } of cells) {
    const [ox, , oz] = cellToWorld(col, row, plate);
    const outline = new THREE.Mesh(
      new THREE.PlaneGeometry(cellW - 0.08, cellW - 0.08),
      asphalt,
    );
    outline.rotation.x = -Math.PI / 2;
    outline.position.set(ox + cellW / 2, 0.012, oz + cellW / 2);
    root.add(outline);
    const mid = new THREE.Mesh(
      new THREE.BoxGeometry(0.04, 0.02, cellW - 0.2),
      lineMat,
    );
    mid.position.set(ox + cellW / 2, 0.02, oz + cellW / 2);
    root.add(mid);
    for (const slot of [0, 1]) {
      const x = ox + (slot + 0.5) * (cellW / 2);
      const z = oz + cellW * 0.48;
      const stall: ParkingStall = {
        id: `stall_${col}_${row}_${slot}`,
        col,
        row,
        slot,
        occupied: true,
        x,
        z,
        rotY: Math.PI / 2,
        sidewalkCol: col,
        sidewalkRow: sidewalkForCol(plate, col),
      };
      stalls.push(stall);
      const pad = new THREE.Mesh(
        new THREE.PlaneGeometry(cellW / 2 - 0.16, cellW * 0.72),
        padMat,
      );
      pad.rotation.x = -Math.PI / 2;
      pad.position.set(x, 0.018, z);
      pad.userData.stall = stall;
      pad.name = stall.id;
      root.add(pad);
      const car = makeCar(colors[npc % colors.length]);
      npc += 1;
      car.position.set(x, 0, z);
      car.rotation.y = stall.rotY;
      root.add(car);
    }
  }
  root.userData.stalls = stalls;
  return root;
}

export function createWallsAndDoors(plate: FloorPlate) {
  const root = new THREE.Group();
  root.name = "structure";
  const wallMat = new THREE.MeshStandardMaterial({
    color: 0x8a8680,
    roughness: 0.92,
    polygonOffset: true,
    polygonOffsetFactor: 1,
    polygonOffsetUnits: 1,
  });
  const baseMat = new THREE.MeshStandardMaterial({ color: 0x0c0c10 });
  const frameMat = new THREE.MeshStandardMaterial({
    color: 0x4a3421,
    roughness: 0.88,
  });
  const leafMat = new THREE.MeshStandardMaterial({
    color: 0x7c5330,
    roughness: 0.74,
  });

  for (const item of plate.furniture) {
    if (item.type === "wall") {
      root.add(createWallSegment(item, plate, wallMat, baseMat));
    } else if (item.type === "door") {
      root.add(createHingedDoor(item, plate, frameMat, leafMat));
    } else if (item.type === "window") {
      root.add(createWindow(item, plate, frameMat));
    }
  }

  addKitchenSplit(root, plate, wallMat, baseMat);
  addElevatorShafts(root, plate);
  return root;
}

export function createWallSegment(
  item: FurnitureItem,
  plate: FloorPlate,
  wallMat: THREE.Material,
  baseMat: THREE.Material,
) {
  const { width, height } = getItemSize(item, plate);
  const [wx, , wz] = toWorld(item.x, item.y, plate);
  const ww = width * SCALE;
  const wd = height * SCALE;
  const h = 1.05;
  const group = new THREE.Group();
  group.position.set(wx, item.elevation ?? 0, wz);
  const inner = new THREE.Group();
  inner.position.set(ww / 2, 0, wd / 2);
  inner.rotation.y = itemRotation(item);
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(
      Math.max(ww - WALL_SHRINK, 0.02),
      h,
      Math.max(wd - WALL_SHRINK, 0.02),
    ),
    wallMat,
  );
  body.position.y = h / 2;
  body.castShadow = true;
  body.receiveShadow = true;
  inner.add(body);
  const base = new THREE.Mesh(
    new THREE.BoxGeometry(
      Math.max(ww - WALL_SHRINK, 0.02),
      0.06,
      Math.max(wd - WALL_SHRINK, 0.02),
    ),
    baseMat,
  );
  base.position.y = 0.03;
  inner.add(base);
  group.add(inner);
  group.userData.item = item;
  group.userData.structure = true;
  return group;
}

export function createHingedDoor(
  item: FurnitureItem,
  plate: FloorPlate,
  frameMat: THREE.Material,
  leafMat: THREE.Material,
) {
  const edge = item.doorEdge ?? "s";
  const alongX = edge === "n" || edge === "s";
  const length = (alongX ? item.w : item.h) ?? 56;
  const thick = (alongX ? item.h : item.w) ?? 10;
  const [wx, , wz] = toWorld(item.x, item.y, plate);
  const leafLen = length * SCALE;
  const leafThick = Math.max(thick * SCALE, 0.035);
  const open = THREE.MathUtils.clamp(item.open ?? 0.38, 0, 1) * Math.PI * 0.55;

  const root = new THREE.Group();
  root.position.set(wx, item.elevation ?? 0, wz);

  const cx = alongX ? leafLen / 2 : leafThick / 2;
  const cz = alongX ? leafThick / 2 : leafLen / 2;
  const frame = new THREE.Group();
  frame.position.set(cx, 0, cz);

  if (alongX) {
    frame.add(jamb(-leafLen / 2, 0, leafThick, frameMat));
    frame.add(jamb(leafLen / 2, 0, leafThick, frameMat));
    const lintel = new THREE.Mesh(
      new THREE.BoxGeometry(leafLen + 0.06, 0.08, leafThick + 0.04),
      frameMat,
    );
    lintel.position.set(0, 1.01, 0);
    frame.add(lintel);
  } else {
    frame.add(jamb(0, -leafLen / 2, leafThick, frameMat, true));
    frame.add(jamb(0, leafLen / 2, leafThick, frameMat, true));
    const lintel = new THREE.Mesh(
      new THREE.BoxGeometry(leafThick + 0.04, 0.08, leafLen + 0.06),
      frameMat,
    );
    lintel.position.set(0, 1.01, 0);
    frame.add(lintel);
  }

  const hinge = new THREE.Group();
  hinge.name = "door-hinge";
  const openDir = alongX ? (edge === "s" ? -1 : 1) : edge === "e" ? 1 : -1;
  hinge.userData.openDir = openDir;
  const leaf = new THREE.Mesh(
    new THREE.BoxGeometry(
      alongX ? leafLen - 0.08 : Math.max(leafThick * 0.5, 0.03),
      0.94,
      alongX ? Math.max(leafThick * 0.5, 0.03) : leafLen - 0.08,
    ),
    leafMat,
  );
  leaf.position.y = 0.5;
  leaf.castShadow = true;
  leaf.receiveShadow = true;

  if (alongX) {
    hinge.position.set(-leafLen / 2 + 0.03, 0, 0);
    leaf.position.x = (leafLen - 0.08) / 2;
  } else {
    hinge.position.set(0, 0, -leafLen / 2 + 0.03);
    leaf.position.z = (leafLen - 0.08) / 2;
  }
  hinge.rotation.y = openDir * open;

  hinge.add(leaf);
  frame.add(hinge);
  root.add(frame);
  applyDoorTransform(root, item, plate);
  root.userData.item = item;
  root.userData.structure = true;
  root.userData.doorEdge = edge;
  root.userData.alongX = alongX;
  return root;
}

const DOOR_OPEN_ANGLE = Math.PI * 0.55;

export function setHingedDoorOpen(root: THREE.Object3D, fraction: number) {
  const hinge = root.getObjectByName("door-hinge");
  if (!hinge) return;
  const dir = Number(hinge.userData.openDir ?? 1);
  const t = THREE.MathUtils.clamp(fraction, 0, 1);
  hinge.rotation.y = dir * DOOR_OPEN_ANGLE * t;
}

/** Place a hinged door on its wall. Do not use furniture pivot/rotation on these. */
export function applyDoorTransform(
  root: THREE.Object3D,
  item: FurnitureItem,
  plate: FloorPlate,
) {
  const edge = item.doorEdge ?? "s";
  const alongX = edge === "n" || edge === "s";
  const length = (alongX ? item.w : item.h) ?? 56;
  const thick = (alongX ? item.h : item.w) ?? 10;
  const [wx, , wz] = toWorld(item.x, item.y, plate);
  const leafLen = length * SCALE;
  const leafThick = Math.max(thick * SCALE, 0.035);
  const cx = alongX ? leafLen / 2 : leafThick / 2;
  const cz = alongX ? leafThick / 2 : leafLen / 2;
  root.position.set(wx, item.elevation ?? 0, wz);
  root.rotation.set(0, 0, 0);
  root.scale.set(1, 1, 1);
  const frame = root.children[0];
  if (frame) {
    frame.position.set(cx, 0, cz);
    frame.rotation.set(0, 0, 0);
    frame.scale.set(1, 1, 1);
  }
  insetByEdge(root, edge, OPENING_INSET);
}

function jamb(
  x: number,
  z: number,
  thick: number,
  mat: THREE.Material,
  alongZ = false,
) {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(alongZ ? thick + 0.03 : 0.05, 1, alongZ ? 0.05 : thick + 0.03),
    mat,
  );
  mesh.position.set(x, 0.5, z);
  return mesh;
}

export function createWindow(
  item: FurnitureItem,
  plate: FloorPlate,
  frameMat: THREE.Material,
) {
  const edge = item.windowEdge ?? "n";
  const alongX = edge === "n" || edge === "s";
  const length = (alongX ? item.w : item.h) ?? 140;
  const thick = (alongX ? item.h : item.w) ?? 10;
  const [wx, , wz] = toWorld(item.x, item.y, plate);
  const len = length * SCALE;
  const th = Math.max(thick * SCALE, 0.04);
  /** Stay inside the opening so glass/sill don't share faces with wall stubs. */
  const endGap = 0.03;
  const jambW = 0.08;
  const frameLen = Math.max(len - endGap * 2, 0.2);
  const frameTh = Math.max(th - 0.024, 0.04);
  const glassW = Math.max(frameLen - jambW * 2 - 0.04, 0.12);
  const glassTh = 0.018;
  const root = new THREE.Group();
  root.position.set(wx, item.elevation ?? 0, wz);
  const cx = alongX ? len / 2 : th / 2;
  const cz = alongX ? th / 2 : len / 2;
  const frame = new THREE.Group();
  frame.position.set(cx, 0, cz);

  const sillH = 0.32;
  const head = 0.95;
  const glassH = head - sillH - 0.06;

  const sill = new THREE.Mesh(
    new THREE.BoxGeometry(alongX ? frameLen : frameTh, sillH, alongX ? frameTh : frameLen),
    frameMat,
  );
  sill.position.set(0, sillH / 2, 0);
  frame.add(sill);

  const lintel = new THREE.Mesh(
    new THREE.BoxGeometry(alongX ? frameLen : frameTh, 0.08, alongX ? frameTh : frameLen),
    frameMat,
  );
  lintel.position.set(0, head, 0);
  frame.add(lintel);

  const jambDepth = frameTh;
  const jambAlong = jambW;
  if (alongX) {
    const j = (x: number) => {
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(jambAlong, 1, jambDepth),
        frameMat,
      );
      mesh.position.set(x, 0.5, 0);
      return mesh;
    };
    frame.add(j(-frameLen / 2 + jambAlong / 2));
    frame.add(j(frameLen / 2 - jambAlong / 2));
  } else {
    const j = (z: number) => {
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(jambDepth, 1, jambAlong),
        frameMat,
      );
      mesh.position.set(0, 0.5, z);
      return mesh;
    };
    frame.add(j(-frameLen / 2 + jambAlong / 2));
    frame.add(j(frameLen / 2 - jambAlong / 2));
  }

  const glass = new THREE.Mesh(
    new THREE.BoxGeometry(
      alongX ? glassW : glassTh,
      glassH,
      alongX ? glassTh : glassW,
    ),
    new THREE.MeshStandardMaterial({
      color: 0xa8d4ee,
      emissive: 0x1b3d66,
      emissiveIntensity: 0.35,
      transparent: true,
      opacity: 0.4,
      roughness: 0.08,
      metalness: 0.15,
      depthWrite: true,
      polygonOffset: true,
      polygonOffsetFactor: 1,
      polygonOffsetUnits: 1,
    }),
  );
  glass.name = "window-glass";
  glass.userData.windowGlass = true;
  glass.userData.windowEdge = edge;
  glass.position.set(0, sillH + glassH / 2, 0);
  frame.add(glass);

  const mullion = new THREE.Mesh(
    new THREE.BoxGeometry(
      alongX ? 0.04 : frameTh * 0.7,
      glassH,
      alongX ? frameTh * 0.7 : 0.04,
    ),
    frameMat,
  );
  mullion.position.set(0, sillH + glassH / 2, 0);
  frame.add(mullion);

  root.add(frame);
  insetByEdge(root, edge, WINDOW_INSET);
  root.userData.item = item;
  root.userData.structure = true;
  return root;
}

function addKitchenSplit(
  root: THREE.Group,
  plate: FloorPlate,
  wallMat: THREE.Material,
  baseMat: THREE.Material,
) {
  const elev = plate.zones.elevator?.cells ?? [];
  const borders = elev.filter((cell) => kindAt(plate, cell.col, cell.row + 1) === "kitchen");
  if (!borders.length) return;
  const minC = Math.min(...borders.map((c) => c.col));
  const maxC = Math.max(...borders.map((c) => c.col));
  const row = borders[0].row;
  const [x0, , wz] = cellToWorld(minC, row + 1, plate);
  const [x1] = cellToWorld(maxC + 1, row + 1, plate);
  const thick = 0.08;
  const h = 1.05;
  const len = Math.abs(x1 - x0);
  const cx = (x0 + x1) / 2;
  const group = new THREE.Group();
  group.name = "kitchen-split";
  const body = new THREE.Mesh(new THREE.BoxGeometry(len, h, thick), wallMat);
  body.position.set(cx, h / 2, wz);
  body.castShadow = true;
  body.receiveShadow = true;
  const base = new THREE.Mesh(new THREE.BoxGeometry(len, 0.06, thick), baseMat);
  base.position.set(cx, 0.03, wz);
  group.add(body, base);
  root.add(group);
}

function addElevatorShafts(root: THREE.Group, plate: FloorPlate) {
  const elev = plate.zones.elevator?.cells ?? [];
  const borders = elev.filter((cell) => kindAt(plate, cell.col, cell.row + 1) === "kitchen");
  if (!borders.length) return;
  const minC = Math.min(...borders.map((c) => c.col));
  const maxC = Math.max(...borders.map((c) => c.col));
  const row = borders[0].row;
  const [wallX0, , wallZ] = cellToWorld(minC, row + 1, plate);
  const [wallX1] = cellToWorld(maxC + 1, row + 1, plate);
  const span = Math.abs(wallX1 - wallX0);
  const count = 4;
  const gap = 0.1;
  const thick = 0.08;
  const h = 1.05;
  const size = Math.min((span - gap * (count + 1)) / count, 1.42);
  const opening = size * 0.72;
  const xMin = Math.min(wallX0, wallX1);
  const mat = new THREE.MeshStandardMaterial({
    color: 0xb8c0c8,
    metalness: 0.55,
    roughness: 0.32,
  });
  const doorMat = new THREE.MeshStandardMaterial({
    color: 0x111214,
    metalness: 0.45,
    roughness: 0.38,
  });
  const box = (
    w: number,
    d: number,
    x: number,
    y: number,
    z: number,
    parent: THREE.Group,
    height = h,
  ) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, height, d), mat);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    parent.add(mesh);
  };

  for (let i = 0; i < count; i++) {
    const cx = xMin + gap + size / 2 + i * (size + gap);
    const cz = wallZ - thick / 2 - size / 2;
    const x0 = cx - size / 2;
    const z0 = cz - size / 2;
    const x1 = cx + size / 2;
    const z1 = cz + size / 2;
    const shaft = new THREE.Group();
    shaft.name = `elevator-${i}`;
    const edges: {
      id: "n" | "s" | "e" | "w";
      alongX: boolean;
      x: number;
      z: number;
      len: number;
    }[] = [
      { id: "n", alongX: true, x: cx, z: z0 + thick / 2, len: size },
      { id: "s", alongX: true, x: cx, z: z1 - thick / 2, len: size },
      { id: "w", alongX: false, x: x0 + thick / 2, z: cz, len: size },
      { id: "e", alongX: false, x: x1 - thick / 2, z: cz, len: size },
    ];
    for (const edge of edges) {
      if (edge.id !== "n") {
        box(
          edge.alongX ? edge.len : thick,
          edge.alongX ? thick : edge.len,
          edge.x,
          h / 2,
          edge.z,
          shaft,
        );
        continue;
      }
      const jamb = Math.max((edge.len - opening) / 2, 0.05);
      box(jamb, thick, edge.x - edge.len / 2 + jamb / 2, h / 2, edge.z, shaft);
      box(jamb, thick, edge.x + edge.len / 2 - jamb / 2, h / 2, edge.z, shaft);
      const lintelH = 0.16;
      box(edge.len, thick, edge.x, h - lintelH / 2, edge.z, shaft, lintelH);
      const slit = 0.02;
      const doorW = opening / 2 - slit / 2;
      const doorH = h - lintelH - 0.02;
      const doorTh = 0.03;
      const doorY = doorH / 2;
      const doorZ = edge.z + 0.012;
      const left = new THREE.Mesh(new THREE.BoxGeometry(doorW, doorH, doorTh), doorMat);
      left.position.set(edge.x - doorW / 2 - slit / 2, doorY, doorZ);
      left.castShadow = true;
      shaft.add(left);
      const right = new THREE.Mesh(new THREE.BoxGeometry(doorW, doorH, doorTh), doorMat);
      right.position.set(edge.x + doorW / 2 + slit / 2, doorY, doorZ);
      right.castShadow = true;
      shaft.add(right);
    }
    const ceil = new THREE.Mesh(new THREE.BoxGeometry(size, 0.04, size), mat);
    ceil.position.set(cx, h - 0.02, cz);
    ceil.castShadow = true;
    shaft.add(ceil);
    root.add(shaft);
  }
}

export function furnitureByType(plate: FloorPlate) {
  const map = new Map<string, FurnitureItem[]>();
  for (const item of plate.furniture) {
    if (item.type === "wall" || item.type === "door" || item.type === "window")
      continue;
    const list = map.get(item.type) ?? [];
    list.push(item);
    map.set(item.type, list);
  }
  return map;
}
