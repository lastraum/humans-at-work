import * as THREE from "three";
import { SCALE, fromWorld, toWorld } from "./coords";
import { blocksNavigation } from "./furnitureCatalog";
import { INDOOR_WALKABLE, OUTDOOR_WALKABLE, kindAt } from "./grid";
import type { CellKind, FloorPlate, FurnitureItem } from "./types";

export type Collider = {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
};

const _box = new THREE.Box3();
export const PLAYER_RADIUS = 0.16;
export const NAV_STEP = 20;

export function collectColliders(roots: THREE.Object3D | THREE.Object3D[]): Collider[] {
  const list = Array.isArray(roots) ? roots : [roots];
  const out: Collider[] = [];
  for (const root of list) {
    root.traverse((node) => {
      if (node.userData?.blocksNav) {
        _box.setFromObject(node);
        if (_box.isEmpty()) return;
        out.push({
          minX: _box.min.x,
          maxX: _box.max.x,
          minZ: _box.min.z,
          maxZ: _box.max.z,
        });
        return;
      }
      const item = node.userData?.item as FurnitureItem | undefined;
      if (!item) return;
      if (node.parent?.userData?.item) return;
      if (!blocksNavigation(item.type)) return;
      _box.setFromObject(node);
      if (_box.isEmpty()) return;
      out.push({
        minX: _box.min.x,
        maxX: _box.max.x,
        minZ: _box.min.z,
        maxZ: _box.max.z,
      });
    });
  }
  return out;
}

export function hitsCollider(
  wx: number,
  wz: number,
  colliders: Collider[],
  radius = PLAYER_RADIUS,
) {
  for (const box of colliders) {
    if (
      wx + radius > box.minX &&
      wx - radius < box.maxX &&
      wz + radius > box.minZ &&
      wz - radius < box.maxZ
    ) {
      return true;
    }
  }
  return false;
}

function walkableKind(kind: CellKind | null, inside: boolean) {
  if (!kind) return false;
  if (OUTDOOR_WALKABLE.includes(kind)) return true;
  return inside && INDOOR_WALKABLE.includes(kind);
}

export function canStandAt(
  wx: number,
  wz: number,
  plate: FloorPlate,
  inside: boolean,
  colliders: Collider[],
) {
  const canvas = fromWorld(wx, wz, plate);
  const col = Math.floor(canvas.x / plate.grid.cellSize);
  const row = Math.floor(canvas.y / plate.grid.cellSize);
  const kind = kindAt(plate, col, row);
  if (!walkableKind(kind, inside)) return false;
  if (hitsCollider(wx, wz, colliders)) return false;
  return true;
}

function kindStepBlocked(from: CellKind | null, to: CellKind | null) {
  if (!from || !to || from === to) return false;
  return (from === "elevator" && to === "kitchen") || (from === "kitchen" && to === "elevator");
}

type Node = { x: number; y: number };

export function astarWorld(
  startCanvas: { x: number; y: number },
  goalCanvas: { x: number; y: number },
  plate: FloorPlate,
  inside: boolean,
  colliders: Collider[],
): { x: number; y: number }[] | null {
  const snap = (n: number) => Math.round(n / NAV_STEP) * NAV_STEP;
  const start: Node = { x: snap(startCanvas.x), y: snap(startCanvas.y) };
  const goal: Node = { x: snap(goalCanvas.x), y: snap(goalCanvas.y) };
  const key = (n: Node) => `${n.x},${n.y}`;
  const h = (n: Node) =>
    (Math.abs(n.x - goal.x) + Math.abs(n.y - goal.y)) / NAV_STEP;
  const open: Node[] = [start];
  const came = new Map<string, Node>();
  const gScore = new Map<string, number>([[key(start), 0]]);
  const seen = new Set<string>();
  let guard = 0;
  while (open.length && guard < 20000) {
    guard += 1;
    open.sort(
      (a, b) =>
        (gScore.get(key(a)) ?? 1e9) + h(a) - ((gScore.get(key(b)) ?? 1e9) + h(b)),
    );
    const cur = open.shift()!;
    if (cur.x === goal.x && cur.y === goal.y) {
      const path = [cur];
      let k = key(cur);
      while (came.has(k)) {
        const prev = came.get(k)!;
        path.push(prev);
        k = key(prev);
      }
      path.reverse();
      return path;
    }
    const ck = key(cur);
    if (seen.has(ck)) continue;
    seen.add(ck);
    for (const [dx, dy] of [
      [NAV_STEP, 0],
      [-NAV_STEP, 0],
      [0, NAV_STEP],
      [0, -NAV_STEP],
    ]) {
      const next = { x: cur.x + dx, y: cur.y + dy };
      const [wx, , wz] = toWorld(next.x, next.y, plate);
      if (!canStandAt(wx, wz, plate, inside, colliders)) continue;
      const fromKind = kindAt(
        plate,
        Math.floor(cur.x / plate.grid.cellSize),
        Math.floor(cur.y / plate.grid.cellSize),
      );
      const toKind = kindAt(
        plate,
        Math.floor(next.x / plate.grid.cellSize),
        Math.floor(next.y / plate.grid.cellSize),
      );
      if (kindStepBlocked(fromKind, toKind)) continue;
      const nk = key(next);
      const tentative = (gScore.get(ck) ?? 1e9) + 1;
      if (tentative >= (gScore.get(nk) ?? 1e9)) continue;
      came.set(nk, cur);
      gScore.set(nk, tentative);
      open.push(next);
    }
  }
  return null;
}

export function snapToStandable(
  wx: number,
  wz: number,
  plate: FloorPlate,
  inside: boolean,
  colliders: Collider[],
) {
  if (canStandAt(wx, wz, plate, inside, colliders)) return { x: wx, z: wz };
  const step = NAV_STEP * SCALE;
  for (let ring = 1; ring <= 10; ring++) {
    for (let dx = -ring; dx <= ring; dx++) {
      for (let dz = -ring; dz <= ring; dz++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== ring) continue;
        const x = wx + dx * step;
        const z = wz + dz * step;
        if (canStandAt(x, z, plate, inside, colliders)) return { x, z };
      }
    }
  }
  return null;
}

export function tryMove(
  from: THREE.Vector3,
  dx: number,
  dz: number,
  plate: FloorPlate,
  inside: boolean,
  colliders: Collider[],
) {
  const nx = from.x + dx;
  const nz = from.z + dz;
  if (canStandAt(nx, nz, plate, inside, colliders)) {
    return { x: nx, z: nz };
  }
  if (canStandAt(nx, from.z, plate, inside, colliders)) {
    return { x: nx, z: from.z };
  }
  if (canStandAt(from.x, nz, plate, inside, colliders)) {
    return { x: from.x, z: nz };
  }
  return null;
}
