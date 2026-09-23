import * as THREE from "three";
import { setAvatarPose } from "./createAvatars";
import { toWorld } from "./coords";
import { elevatorSpawn } from "./grid";
import { attachLocomotion, type Locomotion } from "./locomotion";
import type { Pose } from "./protocol";
import type { Avatar, FloorPlate } from "./types";

export function attachPlayer(opts: {
  plate: FloorPlate;
  canvas: HTMLCanvasElement;
  camera: THREE.Camera;
  player: THREE.Object3D;
  avatar: Avatar;
  roof: THREE.Object3D | null;
  ground: THREE.Group;
  overlay: HTMLElement | null;
  isBlocked: () => boolean;
  colliderRoots: THREE.Object3D[];
  onMove?: (x: number, y: number, facing: number) => void;
  onPose?: (pose: Pose) => void;
  onClickFx?: (wx: number, wz: number) => void;
  consumeClick?: (hit: {
    wx: number;
    wz: number;
    col: number;
    row: number;
    kind: string;
  }) => boolean;
  pickFirst?: (pointer: THREE.Vector2) => boolean;
}) {
  const {
    plate,
    canvas,
    camera,
    player,
    avatar,
    roof,
    ground,
    isBlocked,
    colliderRoots,
    onMove,
    onPose,
    onClickFx,
    consumeClick,
    pickFirst,
  } = opts;
  const inside = true;
  const walk = attachLocomotion({ plate, object: player, avatar, colliderRoots, inside });
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const down = { x: 0, y: 0 };
  let poseAge = 0;
  let pendingSit: { x: number; y: number; facing: number; seatId?: string; seatY?: number } | null =
    null;

  const spawn = elevatorSpawn(plate);
  player.visible = true;
  walk.snap({
    x: spawn.x,
    y: spawn.y,
    facing: avatar.facing ?? 0,
    pose: "stand",
    col: spawn.col,
    row: spawn.row,
  });
  const shell = ground.getObjectByName("roof") ?? roof;
  if (shell) shell.visible = false;

  canvas.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    down.x = event.clientX;
    down.y = event.clientY;
  });

  canvas.addEventListener("pointerup", (event) => {
    if (event.button !== 0) return;
    if (Math.hypot(event.clientX - down.x, event.clientY - down.y) > 8) return;
    if (isBlocked()) return;
    const rect = canvas.getBoundingClientRect();
    pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    if (pickFirst?.(pointer)) return;
    raycaster.setFromCamera(pointer, camera);
    const tiles = ground.getObjectByName("tiles");
    if (!tiles) return;
    const hit = raycaster.intersectObjects(tiles.children, false)[0];
    if (!hit) return;
    const { col, row, kind } = hit.object.userData as {
      col: number;
      row: number;
      kind: string;
    };
    if (
      consumeClick?.({
        wx: hit.point.x,
        wz: hit.point.z,
        col,
        row,
        kind,
      })
    ) {
      return;
    }
    pendingSit = null;
    if (avatar.pose === "sit") {
      setAvatarPose(player, "stand");
      onPose?.({ ...walk.pose(), pose: "stand" });
    }
    const goal = walk.setWorldGoal(hit.point.x, hit.point.z);
    if (!goal) return;
    onClickFx?.(hit.point.x, hit.point.z);
    onMove?.(goal.x, goal.y, walk.pose().facing);
  });

  const sitNow = (seat: { x: number; y: number; facing: number; seatId?: string; seatY?: number }) => {
    pendingSit = null;
    setAvatarPose(player, "sit");
    walk.snap({ ...seat, pose: "sit" });
    onPose?.(walk.pose());
  };

  return {
    update(dt: number) {
      if (shell) shell.visible = !inside;
      const moved = walk.update(dt);
      if (moved) {
        poseAge += dt;
        if (poseAge >= 0.1) {
          poseAge = 0;
          onPose?.(walk.pose());
        }
      } else if (poseAge > 0) {
        poseAge = 0;
        onPose?.(walk.pose());
      }
      if (pendingSit && !walk.moving()) sitNow(pendingSit);
    },
    pose: () => walk.pose(),
    moving: () => walk.moving(),
    setCellBlocked(fn: Parameters<Locomotion["setCellBlocked"]>[0]) {
      walk.setCellBlocked(fn);
    },
    goTo(x: number, y: number, force = false) {
      pendingSit = null;
      if (avatar.pose === "sit") {
        setAvatarPose(player, "stand");
        onPose?.({ ...walk.pose(), pose: "stand" });
      }
      if (force) {
        walk.snap({ x, y, facing: walk.pose().facing, pose: "stand" });
        onPose?.(walk.pose());
        return true;
      }
      const goal = walk.setCanvasGoal(x, y);
      if (!goal) {
        return false;
      }
      const [wx, , wz] = toWorld(goal.x, goal.y, plate);
      onClickFx?.(wx, wz);
      onMove?.(goal.x, goal.y, walk.pose().facing);
      return true;
    },
    goSit(seat: { x: number; y: number; facing: number; seatId?: string; seatY?: number }) {
      pendingSit = seat;
      if (avatar.pose === "sit") {
        setAvatarPose(player, "stand");
        onPose?.(walk.pose());
      }
      const goal = walk.setCanvasGoal(seat.x, seat.y);
      if (goal) onMove?.(goal.x, goal.y, seat.facing);
      else sitNow(seat);
    },
    stand() {
      pendingSit = null;
      if (avatar.pose === "sit") {
        setAvatarPose(player, "stand");
        onPose?.(walk.pose());
      }
    },
    get inside() {
      return inside;
    },
  };
}
