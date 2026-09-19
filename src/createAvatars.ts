import * as THREE from "three";
import { FURNITURE_SCALE, toWorld } from "./coords";
import { chairSeat } from "./desks";
import type { Avatar, FloorPlate, FurnitureItem, OfficeInstance } from "./types";

/** Kenney chair seat is y=0.19 native; chairs are scaled in FURNITURE_SCALE. */
const CHAIR_SEAT_Y = 0.19 * (FURNITURE_SCALE.chair?.[1] ?? 1.2);

function box(w: number, h: number, d: number, color: number, y: number) {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(w, h, d),
    new THREE.MeshStandardMaterial({ color, roughness: 0.7 }),
  );
  mesh.position.y = y;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function fillAvatarBody(group: THREE.Object3D, avatar: Avatar) {
  const keep = group.children.filter((child) => child.name === "name-tag" || child.name === "avatar-hit");
  group.clear();
  for (const child of keep) group.add(child);
  const skin = 0xe8c4a8;
  const shirt = new THREE.Color(avatar.color).getHex();
  const pants = 0x3a3f4a;
  if (avatar.pose === "sit") {
    group.add(box(0.12, 0.1, 0.14, pants, 0.05));
    group.add(box(0.16, 0.26, 0.12, shirt, 0.23));
    group.add(box(0.13, 0.13, 0.13, skin, 0.425));
    const thigh = box(0.08, 0.07, 0.16, pants, 0.035);
    thigh.position.z = 0.12;
    group.add(thigh);
    const shin = box(0.07, 0.16, 0.07, pants, -0.05);
    shin.position.z = 0.18;
    group.add(shin);
  } else {
    group.add(box(0.13, 0.4, 0.13, pants, 0.2));
    group.add(box(0.18, 0.3, 0.13, shirt, 0.55));
    group.add(box(0.13, 0.13, 0.13, skin, 0.765));
  }
}

export function applyAvatarTransform(
  obj: THREE.Object3D,
  avatar: Avatar,
  plate: FloorPlate,
) {
  const [wx, , wz] = toWorld(avatar.x, avatar.y, plate);
  obj.position.set(wx, avatar.pose === "sit" ? CHAIR_SEAT_Y : 0, wz);
  obj.rotation.y = ((avatar.facing ?? 0) * Math.PI) / 180;
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

export function setAvatarName(group: THREE.Object3D, name: string) {
  const avatar = group.userData.avatar as Avatar | undefined;
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
    sprite.scale.set(2.4, 0.6, 1);
    sprite.renderOrder = 12;
    sprite.userData.canvas = canvas;
    sprite.userData.texture = tex;
    group.add(sprite);
  }
  const canvas = sprite.userData.canvas as HTMLCanvasElement;
  const tex = sprite.userData.texture as THREE.CanvasTexture;
  drawName(canvas, name);
  tex.needsUpdate = true;
  sprite.position.y = avatar?.pose === "sit" ? 0.78 : 1.18;
}

export function setNameTagVisible(group: THREE.Object3D, visible: boolean) {
  const tag = group.getObjectByName("name-tag");
  if (tag) tag.visible = visible;
}

export function createAvatar(
  avatar: Avatar,
  plate: FloorPlate,
  opts?: { editable?: boolean; label?: string },
) {
  const group = new THREE.Group();
  group.name = `avatar-${avatar.id}`;
  bindAvatarData(group, avatar, opts?.editable ?? true);
  fillAvatarBody(group, avatar);
  applyAvatarTransform(group, avatar, plate);
  const label = opts?.label ?? avatar.id;
  if (label) setAvatarName(group, label);
  ensureAvatarHit(group);
  return group;
}

function ensureAvatarHit(group: THREE.Object3D) {
  if (group.getObjectByName("avatar-hit")) return;
  const hit = new THREE.Mesh(
    new THREE.BoxGeometry(0.72, 1.5, 0.72),
    new THREE.MeshBasicMaterial({ visible: false }),
  );
  hit.name = "avatar-hit";
  hit.position.y = 0.75;
  group.add(hit);
}

export function setAvatarPose(group: THREE.Object3D, pose: Avatar["pose"]) {
  const avatar = group.userData.avatar as Avatar | undefined;
  if (!avatar) return;
  avatar.pose = pose;
  fillAvatarBody(group, avatar);
  const tag = group.getObjectByName("name-tag");
  if (tag) tag.position.y = pose === "sit" ? 0.78 : 1.18;
  ensureAvatarHit(group);
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