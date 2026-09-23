import * as THREE from "three";
import { hashId, resolveLook, type AvatarGender } from "./avatarLook";
import { ENV_SCALE, FURNITURE_SCALE, toWorld } from "./coords";
import { chairSeat } from "./desks";
import type { Avatar, FloorPlate, FurnitureItem, OfficeInstance } from "./types";

/** Kenney chair seat is y=0.19 native; chairs are scaled in FURNITURE_SCALE. */
const CHAIR_SEAT_Y = 0.19 * (FURNITURE_SCALE.chair?.[1] ?? 1.2) * ENV_SCALE;

/**
 * Claw3D retro agents, rebuilt here as a pivot body (arms, legs, eyes).
 * Native proportions match that office; BODY_SCALE fits our Kenney chairs.
 * Facing 0 is south, which is +z. Eyes and knees point +z.
 */
const BODY_SCALE = 1.7;
/** Bottom of the torso in the scaled body. Sitting sets this on the chair cushion. */
const SIT_HIPS = 0.22 * BODY_SCALE;
const HEAD_TOP = 0.62 * BODY_SCALE;
const HIP_Y = 0.17;
const KNEE_Y = -0.11;
const SHOE_H = 0.045;
const SHOE_Y = -0.11;
/** Shoe sole in the unscaled body. Negative, so the shoes sink through the floor plane. */
const SOLE_Y = HIP_Y + KNEE_Y + SHOE_Y - SHOE_H / 2;
/** Standing plants the sole on the floor. Clearance keeps the toe off the tile mid-step. */
const STAND_Y = -SOLE_Y * BODY_SCALE + 0.012;

const SHOES = ["#1c1917", "#243044", "#3a2a22"];

type Rig = {
  body: THREE.Group;
  leftLeg: THREE.Group;
  rightLeg: THREE.Group;
  leftKnee: THREE.Group;
  rightKnee: THREE.Group;
  leftArm: THREE.Group;
  rightArm: THREE.Group;
  eyes: THREE.Object3D[];
  highlights: THREE.Object3D[];
  phase: number;
  blink: number;
  seed: number;
  prev: THREE.Vector3;
};

const live = new Set<THREE.Group>();

function lambert(color: string | number) {
  return new THREE.MeshLambertMaterial({ color });
}

function box(
  parent: THREE.Object3D,
  w: number,
  h: number,
  d: number,
  color: string | number,
  x: number,
  y: number,
  z: number,
) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), lambert(color));
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

function basicBox(
  parent: THREE.Object3D,
  w: number,
  h: number,
  d: number,
  color: string,
  x: number,
  y: number,
  z: number,
) {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(w, h, d),
    new THREE.MeshBasicMaterial({ color }),
  );
  mesh.position.set(x, y, z);
  mesh.castShadow = false;
  parent.add(mesh);
  return mesh;
}

/** +z is the face. Long hair sits on the back and sides so it does not cover the eyes. */
function addHair(parent: THREE.Object3D, gender: AvatarGender, color: string) {
  if (gender === "m") {
    box(parent, 0.17, 0.05, 0.15, color, 0, 0.555, -0.01);
    return;
  }
  box(parent, 0.18, 0.05, 0.16, color, 0, 0.56, -0.015);
  box(parent, 0.16, 0.18, 0.05, color, 0, 0.44, -0.075);
  box(parent, 0.045, 0.16, 0.1, color, -0.09, 0.46, -0.01);
  box(parent, 0.045, 0.16, 0.1, color, 0.09, 0.46, -0.01);
}

function buildBody(avatar: Avatar): Rig {
  const seed = hashId(avatar.id || avatar.color || "you");
  const look = resolveLook(avatar);
  const female = look.gender === "f";
  const shoes = SHOES[(seed >>> 9) % SHOES.length]!;
  const hipX = female ? 0.05 : 0.045;
  const armX = female ? 0.11 : 0.125;
  const torsoW = female ? 0.15 : 0.18;

  const body = new THREE.Group();
  body.name = "avatar-body";
  body.scale.setScalar(BODY_SCALE);

  const leg = (x: number) => {
    const hip = new THREE.Group();
    hip.position.set(x, HIP_Y, 0);
    box(hip, 0.07, 0.12, 0.08, look.pants, 0, -0.05, 0);
    const knee = new THREE.Group();
    knee.position.set(0, KNEE_Y, 0);
    box(knee, 0.065, 0.11, 0.07, look.pants, 0, -0.05, 0);
    box(knee, 0.07, SHOE_H, 0.11, shoes, 0, SHOE_Y, 0.02);
    hip.add(knee);
    body.add(hip);
    return { hip, knee };
  };
  const left = leg(hipX);
  const right = leg(-hipX);

  box(body, torsoW, 0.2, 0.11, look.shirt, 0, 0.3, 0);
  box(body, 0.07, 0.05, 0.07, look.skin, 0, 0.4, 0);
  box(body, 0.16, 0.15, 0.14, look.skin, 0, 0.5, 0);
  addHair(body, look.gender, look.hair);

  const arm = (x: number) => {
    const pivot = new THREE.Group();
    pivot.position.set(x, 0.36, 0);
    box(pivot, 0.055, 0.14, 0.055, look.shirt, 0, -0.07, 0);
    box(pivot, 0.048, 0.045, 0.048, look.skin, 0, -0.155, 0);
    body.add(pivot);
    return pivot;
  };

  // +z is the face (facing 0 = south).
  const eyes = [
    basicBox(body, 0.034, 0.032, 0.012, look.eyes, -0.038, 0.5, 0.072),
    basicBox(body, 0.034, 0.032, 0.012, look.eyes, 0.038, 0.5, 0.072),
  ];
  const highlights = [
    basicBox(body, 0.01, 0.01, 0.012, "#ffffff", -0.028, 0.508, 0.078),
    basicBox(body, 0.01, 0.01, 0.012, "#ffffff", 0.048, 0.508, 0.078),
  ];
  basicBox(body, 0.04, 0.012, 0.01, look.hair, -0.038, 0.532, 0.074);
  basicBox(body, 0.04, 0.012, 0.01, look.hair, 0.038, 0.532, 0.074);
  basicBox(body, 0.05, 0.012, 0.01, "#9c4a4a", 0, 0.455, 0.074);

  return {
    body,
    leftLeg: left.hip,
    rightLeg: right.hip,
    leftKnee: left.knee,
    rightKnee: right.knee,
    leftArm: arm(armX),
    rightArm: arm(-armX),
    eyes,
    highlights,
    phase: (seed % 100) / 10,
    blink: (seed % 50) / 10,
    seed,
    prev: new THREE.Vector3(NaN, NaN, NaN),
  };
}

function poseLimbs(rig: Rig, pose: Avatar["pose"], swing: number) {
  const sit = pose === "sit";
  rig.leftLeg.rotation.x = (sit ? -1.45 : 0) + swing * 0.7;
  rig.rightLeg.rotation.x = (sit ? -1.45 : 0) - swing * 0.7;
  rig.leftKnee.rotation.x = sit ? 1.55 : Math.max(0, -swing) * 0.55;
  rig.rightKnee.rotation.x = sit ? 1.55 : Math.max(0, swing) * 0.55;
  rig.leftArm.rotation.x = (sit ? -0.55 : 0) - swing * 0.7;
  rig.rightArm.rotation.x = (sit ? -0.55 : 0) + swing * 0.7;
  rig.body.position.y = !sit && swing !== 0 ? Math.abs(swing) * 0.025 : 0;
}

export function applyAvatarTransform(obj: THREE.Object3D, avatar: Avatar, plate: FloorPlate) {
  const [wx, , wz] = toWorld(avatar.x, avatar.y, plate);
  const sitY = avatar.seatY ?? CHAIR_SEAT_Y;
  const y = avatar.pose === "sit" ? sitY - SIT_HIPS : STAND_Y;
  obj.position.set(wx, y, wz);
  const facing = (avatar.facing ?? 0) + (avatar.pose === "sit" ? 180 : 0);
  obj.rotation.y = (facing * Math.PI) / 180;
}

function bindAvatarData(group: THREE.Group, avatar: Avatar, editable: boolean) {
  const item: FurnitureItem = {
    _uid: `avatar_${avatar.id}`,
    type: "avatar",
    id: avatar.id,
    x: avatar.x,
    y: avatar.y,
    facing: avatar.facing,
  };
  group.userData = {
    editable,
    avatar,
    item,
    cellKind: avatar.officeId ? "office" : undefined,
    officeId: avatar.officeId,
  };
}

function drawName(canvas: HTMLCanvasElement, name: string) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "rgba(16, 14, 28, 0.82)";
  if (typeof ctx.roundRect === "function") {
    ctx.beginPath();
    ctx.roundRect(8, 8, canvas.width - 16, canvas.height - 16, 12);
    ctx.fill();
  } else {
    ctx.fillRect(8, 8, canvas.width - 16, canvas.height - 16);
  }
  ctx.fillStyle = "#f4f0e8";
  ctx.font = "600 28px ui-sans-serif, system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(name.slice(0, 18), canvas.width / 2, canvas.height / 2 + 1);
}

function placeNameTag(group: THREE.Object3D) {
  const tag = group.getObjectByName("name-tag");
  if (tag) tag.position.y = HEAD_TOP + 0.08;
}

export function setAvatarName(group: THREE.Object3D, name: string) {
  let sprite = group.getObjectByName("name-tag") as THREE.Sprite | undefined;
  if (!sprite) {
    const canvas = document.createElement("canvas");
    canvas.width = 256;
    canvas.height = 64;
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    const mat = new THREE.SpriteMaterial({
      map: tex,
      transparent: true,
      depthTest: false,
    });
    sprite = new THREE.Sprite(mat);
    sprite.name = "name-tag";
    sprite.center.set(0.5, 0);
    sprite.scale.set(1.6, 0.4, 1);
    sprite.renderOrder = 12;
    sprite.userData.canvas = canvas;
    sprite.userData.texture = tex;
    group.add(sprite);
  }
  const canvas = sprite.userData.canvas as HTMLCanvasElement;
  const tex = sprite.userData.texture as THREE.CanvasTexture;
  drawName(canvas, name);
  tex.needsUpdate = true;
  placeNameTag(group);
}

export function setNameTagVisible(group: THREE.Object3D, visible: boolean) {
  const tag = group.getObjectByName("name-tag");
  if (tag) tag.visible = visible;
}

function disposeObject(obj: THREE.Object3D) {
  obj.traverse((node) => {
    const mesh = node as THREE.Mesh;
    mesh.geometry?.dispose();
    const material = mesh.material;
    if (Array.isArray(material)) material.forEach((entry) => entry.dispose());
    else material?.dispose();
  });
}

/** Rebuild the body after a look edit. Name tag and hit box stay. */
export function restyleAvatar(group: THREE.Object3D) {
  const avatar = group.userData.avatar as Avatar | undefined;
  if (!avatar || !(group instanceof THREE.Group)) return;
  const rig = group.userData.rig as Rig | undefined;
  if (rig) {
    group.remove(rig.body);
    disposeObject(rig.body);
    delete group.userData.rig;
  }
  const next = ensureRig(group, avatar);
  poseLimbs(next, avatar.pose, 0);
}

function ensureRig(group: THREE.Group, avatar: Avatar) {
  const existing = group.userData.rig as Rig | undefined;
  if (existing) return existing;
  const rig = buildBody(avatar);
  group.add(rig.body);
  group.userData.rig = rig;
  live.add(group);
  poseLimbs(rig, avatar.pose, 0);
  return rig;
}

function ensureAvatarHit(group: THREE.Object3D) {
  if (group.getObjectByName("avatar-hit")) return;
  const hit = new THREE.Mesh(
    new THREE.BoxGeometry(0.55, HEAD_TOP, 0.4),
    new THREE.MeshBasicMaterial({ visible: false }),
  );
  hit.name = "avatar-hit";
  hit.position.y = HEAD_TOP * 0.5;
  group.add(hit);
}

export function createAvatar(
  avatar: Avatar,
  plate: FloorPlate,
  opts?: { editable?: boolean; label?: string },
) {
  const group = new THREE.Group();
  group.name = `avatar-${avatar.id}`;
  bindAvatarData(group, avatar, opts?.editable ?? true);
  ensureRig(group, avatar);
  applyAvatarTransform(group, avatar, plate);
  const label = opts?.label ?? avatar.id;
  if (label) setAvatarName(group, label);
  ensureAvatarHit(group);
  return group;
}

export function setAvatarPose(group: THREE.Object3D, pose: Avatar["pose"]) {
  const avatar = group.userData.avatar as Avatar | undefined;
  if (!avatar) return;
  avatar.pose = pose;
  const rig = ensureRig(group as THREE.Group, avatar);
  poseLimbs(rig, pose, 0);
  placeNameTag(group);
}

/** Walk swing and blink. Safe to call every frame. */
export function updateAvatars(dt: number) {
  const step = Math.min(Math.max(dt, 0), 0.05);
  for (const group of live) {
    if (!group.parent) {
      live.delete(group);
      continue;
    }
    const rig = group.userData.rig as Rig | undefined;
    const avatar = group.userData.avatar as Avatar | undefined;
    if (!rig || !avatar) continue;
    const moved = Number.isFinite(rig.prev.x) && rig.prev.distanceTo(group.position) > 0.003;
    rig.prev.copy(group.position);
    rig.phase += step * (moved ? 9 : 1.5);
    rig.blink += step;
    const swing = moved && avatar.pose === "stand" ? Math.sin(rig.phase) : 0;
    poseLimbs(rig, avatar.pose, swing);
    const cycle = 2.8 + (rig.seed % 17) * 0.08;
    const t = rig.blink % cycle;
    const shut = t < 0.14 ? Math.sin((t / 0.14) * Math.PI) : 0;
    const open = Math.max(0.08, 1 - shut * 0.92);
    for (const eye of rig.eyes) eye.scale.y = open;
    for (const dot of rig.highlights) dot.visible = open > 0.5;
  }
}

export function createAvatars(plate: FloorPlate, officesRoot?: THREE.Group) {
  const root = new THREE.Group();
  root.name = "avatars";
  const list = (plate.avatars ?? []).filter((avatar) => avatar.id !== "you");

  for (const avatar of list) {
    const officeGroup = avatar.officeId
      ? officesRoot?.getObjectByName(avatar.officeId)
      : undefined;
    const inst = officeGroup?.userData.office as OfficeInstance | undefined;
    if (officeGroup && inst && avatar.pose === "sit") {
      const seat = chairSeat(officeGroup, inst, plate);
      avatar.x = seat.x;
      avatar.y = seat.y;
      avatar.facing = seat.facing;
    }
    const group = createAvatar(avatar, plate, {
      label: avatar.officeId ? "" : avatar.id,
    });
    root.add(group);
  }
  return root;
}
