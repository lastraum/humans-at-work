import * as THREE from "three";
import { fromWorld, toWorld } from "./coords";
import { applyAvatarTransform } from "./createAvatars";
import {
  astarWorld,
  collectColliders,
  snapToStandable,
  tryMove,
  type Collider,
} from "./collision";
import type { Pose } from "./protocol";
import type { Avatar, FloorPlate } from "./types";

export type CanvasPoint = { x: number; y: number };

export type Locomotion = {
  setWorldGoal: (wx: number, wz: number) => CanvasPoint | null;
  setCanvasGoal: (x: number, y: number) => CanvasPoint | null;
  snap: (pose: Pose) => void;
  moving: () => boolean;
  pose: () => Pose;
  update: (dt: number) => boolean;
};

export function attachLocomotion(opts: {
  plate: FloorPlate;
  object: THREE.Object3D;
  avatar: Avatar;
  colliderRoots: THREE.Object3D[];
  inside?: boolean;
}): Locomotion {
  const { plate, object, avatar, colliderRoots } = opts;
  const inside = opts.inside ?? true;
  let path: { x: number; y: number }[] = [];
  let colliders: Collider[] = collectColliders(colliderRoots);

  const refresh = () => {
    colliders = collectColliders(colliderRoots);
  };

  const writeFromWorld = () => {
    const canvas = fromWorld(object.position.x, object.position.z, plate);
    avatar.x = canvas.x;
    avatar.y = canvas.y;
    avatar.col = Math.floor(canvas.x / plate.grid.cellSize);
    avatar.row = Math.floor(canvas.y / plate.grid.cellSize);
  };

  const unstick = () => {
    const free = snapToStandable(
      object.position.x,
      object.position.z,
      plate,
      inside,
      colliders,
    );
    if (!free) return fromWorld(object.position.x, object.position.z, plate);
    if (
      Math.hypot(free.x - object.position.x, free.z - object.position.z) > 0.01
    ) {
      object.position.x = free.x;
      object.position.z = free.z;
      writeFromWorld();
    }
    return fromWorld(free.x, free.z, plate);
  };

  const pathTo = (wx: number, wz: number): CanvasPoint | null => {
    refresh();
    const snapped = snapToStandable(wx, wz, plate, inside, colliders);
    if (!snapped) return null;
    const start = unstick();
    const goal = fromWorld(snapped.x, snapped.z, plate);
    const next = astarWorld(start, goal, plate, inside, colliders);
    if (!next?.length) return null;
    path = next;
    return goal;
  };

  const goalNear = (wx: number, wz: number) => {
    const direct = pathTo(wx, wz);
    if (direct) return direct;
    for (const r of [0.35, 0.7, 1.1, 1.6]) {
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        const hit = pathTo(wx + Math.cos(a) * r, wz + Math.sin(a) * r);
        if (hit) return hit;
      }
    }
    return null;
  };

  return {
    setWorldGoal(wx, wz) {
      return goalNear(wx, wz);
    },
    setCanvasGoal(x, y) {
      const [wx, , wz] = toWorld(x, y, plate);
      return goalNear(wx, wz);
    },
    snap(next) {
      path = [];
      avatar.x = next.x;
      avatar.y = next.y;
      avatar.facing = next.facing;
      avatar.pose = next.pose;
      avatar.col = next.col ?? Math.floor(next.x / plate.grid.cellSize);
      avatar.row = next.row ?? Math.floor(next.y / plate.grid.cellSize);
      applyAvatarTransform(object, avatar, plate);
    },
    moving: () => path.length > 0,
    pose: () => ({
      x: avatar.x,
      y: avatar.y,
      facing: avatar.facing,
      pose: avatar.pose,
      col: avatar.col,
      row: avatar.row,
    }),
    update(dt) {
      if (!path.length || dt <= 0) return false;
      let remaining = 3.2 * dt;
      let any = false;
      let guard = 0;
      while (path.length && remaining > 1e-4 && guard++ < 200) {
        const target = path[0];
        const [tx, , tz] = toWorld(target.x, target.y, plate);
        const dx = tx - object.position.x;
        const dz = tz - object.position.z;
        const dist = Math.hypot(dx, dz);
        if (dist < 0.08) {
          avatar.x = target.x;
          avatar.y = target.y;
          avatar.col = Math.floor(target.x / plate.grid.cellSize);
          avatar.row = Math.floor(target.y / plate.grid.cellSize);
          path.shift();
          applyAvatarTransform(object, avatar, plate);
          any = true;
          continue;
        }
        const step = Math.min(remaining, dist);
        const moved = tryMove(
          object.position,
          (dx / dist) * step,
          (dz / dist) * step,
          plate,
          inside,
          colliders,
        );
        if (!moved) {
          path.shift();
          continue;
        }
        const traveled = Math.hypot(moved.x - object.position.x, moved.z - object.position.z);
        object.position.x = moved.x;
        object.position.z = moved.z;
        remaining -= Math.max(traveled, 1e-4);
        avatar.facing = (Math.atan2(dx, dz) * 180) / Math.PI;
        object.rotation.y = (avatar.facing * Math.PI) / 180;
        writeFromWorld();
        any = true;
      }
      return any;
    },
  };
}
