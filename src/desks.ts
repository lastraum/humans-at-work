import * as THREE from "three";
import { ENV_SCALE, fromWorld, SCALE, toWorld } from "./coords";
import { localPlateFor } from "./createOffice";
import { setHingedDoorOpen } from "./createPlate";
import { applyItemTransform } from "./loadFurniture";
import { applyOfficeAd, setOfficeAdVisible } from "./officeAds";
import { clampPrivacy, type Claim, type DeskKind, type Privacy } from "./protocol";
import type { FloorPlate, FurnitureItem, OfficeInstance } from "./types";

export type Desk = {
  id: string;
  kind: DeskKind;
  instance: OfficeInstance;
  group: THREE.Object3D;
  seat: { x: number; y: number; facing: number };
  lampLight?: THREE.PointLight;
};

/** Shared near-office budget for lamps and window-ad planes. */
export const MAX_NEAR_OFFICES = 6;
export const MAX_OFFICE_POINT_LIGHTS = MAX_NEAR_OFFICES;

type OccupantPose = { id?: string; col?: number; row?: number; x: number; y: number };

function kindOf(group: THREE.Object3D): DeskKind | null {
  if (group.userData?.office) return "office";
  if (group.userData?.cubicle) return "cubicle";
  return null;
}

function instanceOf(group: THREE.Object3D): OfficeInstance | null {
  return (
    (group.userData.office as OfficeInstance | undefined) ??
    (group.userData.cubicle as OfficeInstance | undefined) ??
    null
  );
}

function chairNode(group: THREE.Object3D): THREE.Object3D | null {
  let best: THREE.Object3D | null = null;
  let preferred: THREE.Object3D | null = null;
  group.traverse((node) => {
    const item = node.userData?.item as { id?: string; type?: string } | undefined;
    if (!item || item.type !== "chair") return;
    if (item.id === "chair" || item.id === "chair_a") preferred = node;
    else if (!best) best = node;
  });
  return preferred ?? best;
}

export type Seat = {
  x: number;
  y: number;
  facing: number;
  seatId?: string;
  seatY?: number;
};

function isSittable(type: string) {
  if (type === "beanbag" || type === "couch") return true;
  if (type.includes("sofa") || type.includes("chair") || type.startsWith("stool")) return true;
  return false;
}

function isCouchLike(type: string) {
  return type === "couch" || type.includes("sofa");
}

const _bagCenter = new THREE.Vector3();
const _bagTarget = new THREE.Vector3();
const _bagBox = new THREE.Box3();

function clusterRoot(node: THREE.Object3D) {
  let current: THREE.Object3D | null = node;
  while (current) {
    if (
      current.userData?.recreation ||
      current.userData?.office ||
      current.userData?.library ||
      current.userData?.conference
    ) {
      return current;
    }
    current = current.parent;
  }
  return node.parent ?? node;
}

/** Sit facing is the look direction plus 180, because sitting turns the body halfway around. */
function faceBeanbagInward(node: THREE.Object3D, seat: Seat, plate: FloorPlate) {
  const root = clusterRoot(node);
  const tables: THREE.Object3D[] = [];
  const bags: THREE.Object3D[] = [];
  root.traverse((child) => {
    const type = (child.userData?.item as { type?: string } | undefined)?.type;
    if (!type) return;
    if (type === "beanbag") bags.push(child);
    else if (type.includes("table")) tables.push(child);
  });
  const [sx, , sz] = toWorld(seat.x, seat.y, plate);
  let found = false;
  if (bags.length >= 3) {
    _bagTarget.set(0, 0, 0);
    for (const bag of bags) {
      _bagBox.setFromObject(bag);
      if (_bagBox.isEmpty()) bag.getWorldPosition(_bagCenter);
      else _bagBox.getCenter(_bagCenter);
      _bagTarget.add(_bagCenter);
    }
    _bagTarget.multiplyScalar(1 / bags.length);
    found = true;
  }
  if (!found) {
    let best = 4;
    for (const table of tables) {
      _bagBox.setFromObject(table);
      if (_bagBox.isEmpty()) continue;
      _bagBox.getCenter(_bagCenter);
      const dist = Math.hypot(_bagCenter.x - sx, _bagCenter.z - sz);
      if (dist < best) {
        best = dist;
        _bagTarget.copy(_bagCenter);
        found = true;
      }
    }
  }
  if (!found) return;
  const look = (Math.atan2(_bagTarget.x - sx, _bagTarget.z - sz) * 180) / Math.PI;
  seat.facing = (((look + 180) % 360) + 360) % 360;
}

/** Desk chairs face the opposite way of the Kenney mesh. Bags and lounges use item.facing. */
function sitFacingOf(itemFacing: number, roomRot: number, type: string) {
  const furnFacing = (((itemFacing ?? 0) + roomRot) % 360 + 360) % 360;
  if (isCouchLike(type) || type.startsWith("lounge") || type === "beanbag") {
    return furnFacing;
  }
  return (furnFacing + 180) % 360;
}

export function sitHeightFor(type: string) {
  const base = type.startsWith("stool")
    ? 0.435
    : type === "beanbag"
      ? 0.36
      : isCouchLike(type) || type.startsWith("lounge")
        ? 0.26
        : 0.36 * 1.2;
  return base * ENV_SCALE;
}

function itemNodeFrom(obj: THREE.Object3D | null): THREE.Object3D | null {
  let node: THREE.Object3D | null = obj;
  while (node) {
    const item = node.userData?.item as { type?: string } | undefined;
    if (item?.type) return node;
    node = node.parent;
  }
  return null;
}

function couchNode(group: THREE.Object3D): THREE.Object3D | null {
  let found: THREE.Object3D | null = null;
  group.traverse((node) => {
    if (found) return;
    const item = node.userData?.item as { type?: string } | undefined;
    if (item?.type === "couch") found = node;
  });
  return found;
}

export function furnitureSeat(
  node: THREE.Object3D,
  plate: FloorPlate,
  click?: THREE.Vector3,
  roomRot = 0,
  facingDeg?: number,
): Seat {
  node.updateWorldMatrix(true, true);
  const box = new THREE.Box3().setFromObject(node);
  const center = box.getCenter(new THREE.Vector3());
  const item = node.userData.item as { facing?: number; type?: string; _uid?: string };
  const type = item.type ?? "";
  const facing = sitFacingOf(facingDeg ?? item.facing ?? 0, roomRot, type);
  const rad = (facing * Math.PI) / 180;
  if (click && isCouchLike(type)) {
    const alongX = Math.sin(rad + Math.PI / 2);
    const alongZ = Math.cos(rad + Math.PI / 2);
    const size = box.getSize(new THREE.Vector3());
    const half = Math.max(size.x, size.z) * 0.28;
    const t = THREE.MathUtils.clamp(
      (click.x - center.x) * alongX + (click.z - center.z) * alongZ,
      -half,
      half,
    );
    center.x += alongX * t;
    center.z += alongZ * t;
  }
  const forward = (type === "beanbag" ? 0.32 : 0.12) * ENV_SCALE;
  const canvas = fromWorld(
    center.x + Math.sin(rad) * forward,
    center.z + Math.cos(rad) * forward,
    plate,
  );
  return {
    x: canvas.x,
    y: canvas.y,
    facing,
    seatId: item._uid || undefined,
    seatY: sitHeightFor(type),
  };
}

export function chairSeat(
  group: THREE.Object3D,
  inst: OfficeInstance,
  plate: FloorPlate,
  occupied = false,
): Seat {
  const chair = chairNode(group);
  const item = chair?.userData.item as FurnitureItem | undefined;
  // Chair mesh turns to occupied.facing. The sitter keeps the vacant facing,
  // same as the fixture bots, so the sit half-turn still faces the desk.
  void occupied;
  if (chair) return furnitureSeat(chair, plate, undefined, inst.rot ?? 0, item?.facing);
  const cell = plate.grid.cellSize;
  return {
    x: inst.col * cell + ((inst.cols ?? 1) * cell) / 2,
    y: inst.row * cell + ((inst.rows ?? 1) * cell) / 2,
    facing: inst.rot ?? 0,
    seatId: inst.id,
    seatY: sitHeightFor("chair"),
  };
}

const VACANT = { color: 0x050608, emissive: 0x000000, intensity: 0, opacity: 0.96 };
const OCCUPIED = { color: 0xffd7a0, emissive: 0xff9a3a, intensity: 0.85, opacity: 0.42 };
const FOCUS = { color: 0x121820, emissive: 0x05080c, intensity: 0.06, opacity: 0.82 };

function zoneCity(tz?: string) {
  if (!tz) return "";
  const city = tz.split("/").pop()?.replace(/_/g, " ") ?? "";
  return city;
}

function drawConfPlate(
  canvas: HTMLCanvasElement,
  title: string,
  sub?: string,
  tone: "idle" | "open" | "busy" = "idle",
) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const w = canvas.width;
  const h = canvas.height;
  const inner = tone === "busy" ? "#3a1212" : tone === "open" ? "#14301f" : "#2a1c10";
  const frame = tone === "busy" ? "#c07060" : tone === "open" ? "#7cba8a" : "#d4b06a";
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = "#3a2a18";
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = frame;
  ctx.fillRect(8, 8, w - 16, h - 16);
  ctx.fillStyle = inner;
  ctx.fillRect(14, 14, w - 28, h - 28);
  ctx.fillStyle = "#f3e6c8";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  if (sub) {
    ctx.font = "700 42px ui-sans-serif, system-ui, sans-serif";
    ctx.fillText(title.slice(0, 16).toUpperCase(), w / 2, h * 0.38);
    ctx.font = "700 34px ui-sans-serif, system-ui, sans-serif";
    ctx.fillText(sub.slice(0, 22), w / 2, h * 0.7);
  } else {
    ctx.font = "700 52px ui-sans-serif, system-ui, sans-serif";
    ctx.fillText(title.slice(0, 16).toUpperCase(), w / 2, h / 2 + 2);
  }
}

export function applyConferencePlate(
  group: THREE.Object3D,
  copy: { title: string; sub?: string; tone?: "idle" | "open" | "busy" },
) {
  const door = officeDoor(group);
  if (!door) return;
  door.updateWorldMatrix(true, true);
  const plate = ensureDoorPlate(door, Boolean(copy.sub));
  drawConfPlate(
    plate.userData.canvas as HTMLCanvasElement,
    copy.title,
    copy.sub,
    copy.tone ?? "idle",
  );
  (plate.userData.texture as THREE.CanvasTexture).needsUpdate = true;
  plate.visible = true;
  plate.userData.conferencePlate = true;
}

function drawDoorPlate(canvas: HTMLCanvasElement, name: string, zone?: string) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = "#3a2a18";
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = "#d4b06a";
  ctx.fillRect(8, 8, w - 16, h - 16);
  ctx.fillStyle = "#2a1c10";
  ctx.fillRect(14, 14, w - 28, h - 28);
  ctx.fillStyle = "#f3e6c8";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  if (zone) {
    ctx.font = "700 48px ui-sans-serif, system-ui, sans-serif";
    ctx.fillText(name.slice(0, 16).toUpperCase(), w / 2, h * 0.38);
    ctx.font = "700 40px ui-sans-serif, system-ui, sans-serif";
    ctx.fillStyle = "#f3e6c8";
    ctx.fillText(zone, w / 2, h * 0.7);
  } else {
    ctx.font = "700 52px ui-sans-serif, system-ui, sans-serif";
    ctx.fillText(name.slice(0, 16).toUpperCase(), w / 2, h / 2 + 2);
  }
}

function windowGlasses(group: THREE.Object3D) {
  const list: THREE.Mesh[] = [];
  group.traverse((node) => {
    if (node.userData?.windowGlass && node instanceof THREE.Mesh) list.push(node);
  });
  return list;
}

function tintGlass(glass: THREE.Mesh, look: typeof VACANT) {
  const mat = glass.material as THREE.MeshStandardMaterial;
  mat.color.setHex(look.color);
  mat.emissive.setHex(look.emissive);
  mat.emissiveIntensity = look.intensity;
  mat.opacity = look.opacity;
}

function ensureVacantShade(desk: Desk, dark: boolean, cellSize: number) {
  let shade = desk.group.getObjectByName("vacant-shade") as THREE.Mesh | undefined;
  if (!shade) {
    const cols = desk.instance.cols ?? 1;
    const rows = desk.instance.rows ?? 1;
    const w = Math.max(cols * cellSize * SCALE - 0.12, 0.4);
    const d = Math.max(rows * cellSize * SCALE - 0.12, 0.4);
    shade = new THREE.Mesh(
      new THREE.PlaneGeometry(w, d),
      new THREE.MeshBasicMaterial({
        color: 0x04050a,
        transparent: true,
        opacity: 0.48,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    );
    shade.name = "vacant-shade";
    shade.rotation.x = -Math.PI / 2;
    shade.position.y = 0.98 * ENV_SCALE;
    shade.renderOrder = 3;
    desk.group.add(shade);
  }
  shade.visible = dark;
}

const SCREEN_GEO = new THREE.PlaneGeometry(1, 1);
/** Native Kenney computerScreen.glb glass (local mesh space). */
const SCREEN_FACE = {
  x: 0.1963,
  y: 0.1717,
  z: -0.0492,
  nx: 0,
  ny: 0.139173,
  nz: 0.990268,
  w: 0.348,
  h: 0.225,
};
const SCREEN_MAT = (() => {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 160;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#1a3a5c";
  ctx.fillRect(0, 0, 256, 160);
  ctx.fillStyle = "#2a8fd4";
  ctx.fillRect(0, 0, 256, 18);
  ctx.fillStyle = "#d8eefc";
  ctx.fillRect(24, 36, 120, 88);
  ctx.fillStyle = "#7ad0a0";
  ctx.fillRect(156, 36, 76, 40);
  ctx.fillStyle = "#f0c060";
  ctx.fillRect(156, 84, 76, 40);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return new THREE.MeshStandardMaterial({
    map: tex,
    emissive: 0x4aa0d8,
    emissiveMap: tex,
    emissiveIntensity: 0.85,
    roughness: 0.25,
    metalness: 0.05,
    toneMapped: false,
  });
})();

function computerNode(group: THREE.Object3D): THREE.Object3D | null {
  let found: THREE.Object3D | null = null;
  group.traverse((node) => {
    if (found) return;
    const item = node.userData?.item as { type?: string; id?: string } | undefined;
    if (item && (item.type === "computer" || item.id === "pc" || item.type === "computer_screen")) {
      found = node;
    }
  });
  return found;
}

function computerMesh(computer: THREE.Object3D): THREE.Mesh | null {
  let found: THREE.Mesh | null = null;
  computer.traverse((node) => {
    if (found || node.name === "screen-on") return;
    if ((node as THREE.Mesh).isMesh) found = node as THREE.Mesh;
  });
  return found;
}

function ensureScreenOn(computer: THREE.Object3D) {
  const host = computerMesh(computer) ?? computer;
  computer.traverse((node) => {
    if (node.name === "screen-on" && node.parent && node.parent !== host) {
      node.parent.remove(node);
    }
  });
  let screen = host.getObjectByName("screen-on") as THREE.Mesh | undefined;
  if (!screen) {
    screen = new THREE.Mesh(SCREEN_GEO, SCREEN_MAT);
    screen.name = "screen-on";
    screen.renderOrder = 2;
    host.add(screen);
  }
  const f = SCREEN_FACE;
  const lift = 0.004;
  screen.position.set(f.x + f.nx * lift, f.y + f.ny * lift, f.z + f.nz * lift);
  screen.rotation.set(Math.atan2(-f.ny, f.nz), 0, 0);
  screen.scale.set(f.w, f.h, 1);
  return screen;
}

function lampNode(group: THREE.Object3D) {
  let found: THREE.Object3D | null = null;
  group.traverse((node) => {
    if (found) return;
    const item = node.userData?.item as { type?: string; id?: string } | undefined;
    if (item && (item.type === "lamp" || item.id === "lamp")) found = node;
  });
  return found;
}

function ensureLampLight(lamp: THREE.Object3D) {
  let light = lamp.getObjectByName("lamp-light") as THREE.PointLight | undefined;
  if (light) return light;
  light = new THREE.PointLight(0xffc27a, 0, 6.5 * ENV_SCALE, 2);
  light.name = "lamp-light";
  light.castShadow = false;
  lamp.add(light);
  lamp.updateWorldMatrix(true, true);
  const box = new THREE.Box3().setFromObject(lamp);
  const tip = new THREE.Vector3(
    (box.min.x + box.max.x) / 2,
    box.max.y - 0.04,
    (box.min.z + box.max.z) / 2,
  );
  light.position.copy(lamp.worldToLocal(tip));
  return light;
}

function officeDoor(group: THREE.Object3D): THREE.Object3D | null {
  let found: THREE.Object3D | null = null;
  group.traverse((node) => {
    if (found) return;
    const item = node.userData?.item as { type?: string } | undefined;
    if (node.userData?.isDoor || item?.type === "door") found = node;
  });
  return found;
}

function ensureDoorPlate(door: THREE.Object3D, withZone = false) {
  const planeW = 0.78 * ENV_SCALE;
  const planeH = (withZone ? 0.24 : 0.18) * ENV_SCALE;
  const canvasH = withZone ? 180 : 110;
  const leftovers: THREE.Object3D[] = [];
  door.traverse((node) => {
    if (node.name === "door-plate") leftovers.push(node);
  });
  for (const node of leftovers) {
    node.parent?.remove(node);
    const mesh = node as THREE.Mesh;
    mesh.geometry?.dispose();
    const tex = mesh.userData.texture as THREE.CanvasTexture | undefined;
    tex?.dispose();
    const mat = mesh.material as THREE.Material | THREE.Material[] | undefined;
    if (Array.isArray(mat)) for (const m of mat) m.dispose();
    else mat?.dispose();
  }
  const canvas = document.createElement("canvas");
  canvas.width = 640;
  canvas.height = canvasH;
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const plate = new THREE.Mesh(
    new THREE.PlaneGeometry(planeW, planeH),
    new THREE.MeshBasicMaterial({
      map: tex,
      transparent: true,
      depthWrite: false,
      side: THREE.FrontSide,
    }),
  );
  plate.name = "door-plate";
  plate.renderOrder = 5;
  plate.visible = false;
  plate.userData.canvas = canvas;
  plate.userData.texture = tex;
  const frame = door.children[0] ?? door;
  frame.add(plate);
  const edge = String(door.userData.doorEdge ?? "n");
  const alongX = Boolean(door.userData.alongX ?? (edge === "n" || edge === "s"));
  const out = 0.13 * ENV_SCALE;
  plate.position.set(0, 1.09 * ENV_SCALE, 0);
  plate.rotation.set(0, 0, 0);
  if (alongX) {
    plate.position.z = edge === "n" ? -out : out;
    plate.rotation.y = edge === "n" ? Math.PI : 0;
  } else {
    plate.position.x = edge === "w" ? -out : out;
    plate.rotation.y = edge === "w" ? -Math.PI / 2 : Math.PI / 2;
  }
  return plate;
}

function inDesk(pose: OccupantPose, inst: OfficeInstance, cell: number) {
  const col = pose.col ?? Math.floor(pose.x / cell);
  const row = pose.row ?? Math.floor(pose.y / cell);
  const w = inst.cols ?? 1;
  const h = inst.rows ?? 1;
  return col >= inst.col && col < inst.col + w && row >= inst.row && row < inst.row + h;
}

export function attachDesks(opts: {
  plate: FloorPlate;
  officesRoot: THREE.Group;
  cubiclesRoot: THREE.Group;
  recreationsRoot?: THREE.Group;
  librariesRoot?: THREE.Group;
  conferencesRoot?: THREE.Group;
  looseRoot?: THREE.Group;
}) {
  const { plate, officesRoot, cubiclesRoot, recreationsRoot, librariesRoot, conferencesRoot, looseRoot } = opts;
  const desks = new Map<string, Desk>();
  const claims = new Map<string, Claim>();
  const fixtures = new Map<string, string>();
  let fixturesOn = true;
  const cell = plate.grid.cellSize;
  const seatRay = new THREE.Raycaster();

  const indexRoot = (root: THREE.Group) => {
    for (const group of root.children) {
      const kind = kindOf(group);
      const inst = instanceOf(group);
      if (!kind || !inst) continue;
      desks.set(inst.id, {
        id: inst.id,
        kind,
        instance: inst,
        group,
        seat: chairSeat(group, inst, plate),
      });
    }
  };
  indexRoot(officesRoot);
  indexRoot(cubiclesRoot);

  for (const avatar of plate.avatars ?? []) {
    if (avatar.officeId && desks.has(avatar.officeId)) {
      fixtures.set(avatar.officeId, avatar.id);
    }
  }

  const claimAt = (deskId: string) => claims.get(deskId);

  const poseDeskChair = (desk: Desk, occupied: boolean) => {
    const chair = chairNode(desk.group);
    const item = chair?.userData.item as FurnitureItem | undefined;
    if (!chair || !item || item.type !== "chair") return;
    const pose =
      occupied && item.occupied
        ? { x: item.occupied.x, y: item.occupied.y, facing: item.occupied.facing ?? item.facing }
        : { x: item.x, y: item.y, facing: item.facing };
    applyItemTransform(chair, { ...item, ...pose }, localPlateFor(plate, desk.instance.cols ?? 1, desk.instance.rows ?? 1));
    desk.seat = chairSeat(desk.group, desk.instance, plate, occupied);
  };

  const paint = (desk: Desk) => {
    const oldSign = desk.group.getObjectByName("desk-sign");
    if (oldSign) oldSign.visible = false;
    desk.group.traverse((node) => {
      if (node.name === "window-name") node.visible = false;
    });
    const fixture = fixturesOn ? fixtures.get(desk.id) : undefined;
    const claim = claimAt(desk.id);
    const occupied = Boolean(claim || fixture);
    poseDeskChair(desk, occupied);
    const privacy: Privacy = claim ? clampPrivacy(claim.privacy) : "open";
    const look = !occupied ? VACANT : privacy === "focus" ? FOCUS : OCCUPIED;
    const name = occupied ? (claim?.name ?? fixture ?? "") : "";
    for (const glass of windowGlasses(desk.group)) tintGlass(glass, look);
    ensureVacantShade(desk, !occupied, cell);
    const adUrl =
      claim?.kind === "office" && claim.officeAd?.enabled && claim.officeAd.url
        ? claim.officeAd.url
        : null;
    applyOfficeAd(desk.group, adUrl);
    const lamp = lampNode(desk.group);
    if (lamp) {
      const light = ensureLampLight(lamp);
      desk.lampLight = light;
      light.userData.wanted = occupied;
      light.intensity = !occupied ? 0 : privacy === "focus" ? 0.9 : 1.7;
      light.visible = false;
    }
    const computer = computerNode(desk.group);
    if (computer) {
      const screen = ensureScreenOn(computer);
      screen.visible = occupied;
    }
    const door = officeDoor(desk.group);
    if (door) {
      const open = occupied && privacy === "open";
      setHingedDoorOpen(door, open ? 0.38 : 0);
      door.updateWorldMatrix(true, true);
      const zone = zoneCity(claim?.timezone);
      const plate = ensureDoorPlate(door, Boolean(zone));
      if (plate) {
        if (occupied && name) {
          drawDoorPlate(
            plate.userData.canvas as HTMLCanvasElement,
            name,
            zone,
          );
          (plate.userData.texture as THREE.CanvasTexture).needsUpdate = true;
          plate.visible = true;
        } else {
          plate.visible = false;
        }
      }
    }
  };

  const setAway = (deskId: string, away: boolean) => {
    const desk = desks.get(deskId);
    if (!desk) return;
    if (desk.group.userData.away === away) return;
    desk.group.userData.away = away;
    paint(desk);
  };

  for (const desk of desks.values()) paint(desk);

  return {
    get: (id: string) => desks.get(id),
    contains(desk: Desk, pose: OccupantPose) {
      return inDesk(pose, desk.instance, cell);
    },
    seat(desk: Desk) {
      const occupied = Boolean(claimAt(desk.id) || (fixturesOn && fixtures.get(desk.id)));
      const next = chairSeat(desk.group, desk.instance, plate, occupied);
      desk.seat = next;
      return next;
    },
    couchSeat(desk: Desk) {
      const couch = couchNode(desk.group);
      if (!couch) return null;
      const seat = furnitureSeat(couch, plate, undefined, desk.instance.rot ?? 0);
      if (desk.kind === "office") seat.facing = (seat.facing + 180) % 360;
      return seat;
    },
    pickSeat(
      camera: THREE.Camera,
      pointer: THREE.Vector2,
      taken?: (seatId?: string) => boolean,
    ) {
      seatRay.setFromCamera(pointer, camera);
      const targets: THREE.Object3D[] = [...desks.values()].map((desk) => desk.group);
      if (recreationsRoot) targets.push(...recreationsRoot.children);
      if (librariesRoot) targets.push(...librariesRoot.children);
      if (conferencesRoot) targets.push(...conferencesRoot.children);
      if (looseRoot) targets.push(...looseRoot.children);
      const hits = seatRay.intersectObjects(targets, true);
      let blocked:
        | { desk: Desk | null; type: string; seat: Seat; occupied: true }
        | null = null;
      for (const hit of hits) {
        const node = itemNodeFrom(hit.object);
        const type = node?.userData?.item?.type as string | undefined;
        if (!node || !type || !isSittable(type)) continue;
        let parent: THREE.Object3D | null = node;
        let desk: Desk | null = null;
        let roomRot = 0;
        while (parent) {
          const inst =
            (parent.userData?.office as OfficeInstance | undefined) ??
            (parent.userData?.cubicle as OfficeInstance | undefined);
          const rec = parent.userData?.recreation as OfficeInstance | undefined;
          const lib = parent.userData?.library as OfficeInstance | undefined;
          const conf = parent.userData?.conference as OfficeInstance | undefined;
          if (inst) {
            desk = desks.get(inst.id) ?? null;
            roomRot = inst.rot ?? 0;
            break;
          }
          if (rec) {
            roomRot = rec.rot ?? 0;
            break;
          }
          if (lib) {
            roomRot = lib.rot ?? 0;
            break;
          }
          if (conf) {
            roomRot = conf.rot ?? 0;
            break;
          }
          parent = parent.parent;
        }
        const seat = furnitureSeat(node, plate, hit.point, roomRot);
        // Lounges store the mesh facing. The sit pose adds a half-turn so the
        // face points the other way; turn these seats back so rec couches and
        // lounge chairs face out of the seat. Bean bags look at the table.
        if (type === "beanbag") faceBeanbagInward(node, seat, plate);
        else if (isCouchLike(type) || type.startsWith("lounge")) {
          seat.facing = (seat.facing + 180) % 360;
        }
        if (taken?.(seat.seatId)) {
          if (!blocked) blocked = { desk, type, seat, occupied: true };
          continue;
        }
        return { desk, type, seat, occupied: false as const };
      }
      return blocked;
    },
    claimOf: claimAt,
    mine: (peerId: string) => [...claims.values()].find((entry) => entry.peerId === peerId),
    roster: () =>
      [...claims.values()]
        .map((claim) => {
          const desk = desks.get(claim.deskId);
          const kind = desk ? (desk.kind === "cubicle" ? "Cube" : "Office") : "Office";
          const label = desk ? `${kind} ${desk.instance.col},${desk.instance.row}` : claim.deskId;
          return {
            peerId: claim.peerId,
            name: claim.name,
            deskId: claim.deskId,
            desk: label,
            privacy: claim.privacy,
            since: claim.since,
            company: claim.company,
            profileUrl: claim.profileUrl,
          };
        })
        .sort((a, b) => a.name.localeCompare(b.name)),
    fixture: (id: string) => (fixturesOn ? fixtures.get(id) : undefined),
    setViewFloor(floor: number) {
      const next = floor <= 1;
      if (next === fixturesOn) return;
      fixturesOn = next;
      for (const desk of desks.values()) paint(desk);
    },
    atCell(col: number, row: number) {
      for (const desk of desks.values()) {
        const inst = desk.instance;
        const w = inst.cols ?? 1;
        const h = inst.rows ?? 1;
        if (col >= inst.col && col < inst.col + w && row >= inst.row && row < inst.row + h) {
          return desk;
        }
      }
      return null;
    },
    apply(claim: Claim) {
      claim.privacy = clampPrivacy(claim.privacy);
      claim.since = Number(claim.since) || Date.now();
      const prev = [...claims.values()].find((entry) => entry.peerId === claim.peerId);
      if (prev && prev.deskId !== claim.deskId) {
        claims.delete(prev.deskId);
        const old = desks.get(prev.deskId);
        if (old) paint(old);
      }
      claims.set(claim.deskId, claim);
      const desk = desks.get(claim.deskId);
      if (desk) paint(desk);
    },
    applyAll(list: Claim[]) {
      claims.clear();
      for (const claim of list) {
        claim.privacy = clampPrivacy(claim.privacy);
        claim.since = Number(claim.since) || Date.now();
        claims.set(claim.deskId, claim);
      }
      for (const desk of desks.values()) paint(desk);
    },
    release(deskId: string) {
      claims.delete(deskId);
      const desk = desks.get(deskId);
      if (desk) paint(desk);
    },
    releasePeer(peerId: string) {
      const mine = [...claims.values()].find((entry) => entry.peerId === peerId);
      if (mine) this.release(mine.deskId);
    },
    rename(peerId: string, name: string) {
      const mine = [...claims.values()].find((entry) => entry.peerId === peerId);
      if (!mine) return;
      mine.name = name;
      const desk = desks.get(mine.deskId);
      if (desk) paint(desk);
    },
    refresh(poses: OccupantPose[]) {
      const byId = new Map(poses.map((pose) => [pose.id, pose]));
      for (const [deskId, claim] of claims) {
        const desk = desks.get(deskId);
        if (!desk) continue;
        const pose = byId.get(claim.peerId);
        setAway(deskId, !pose || !inDesk(pose, desk.instance, cell));
      }
    },
    cullLamps(origin: THREE.Vector3) {
      const ranked: { desk: Desk; dist: number; lamp: boolean; ad: boolean }[] = [];
      for (const desk of desks.values()) {
        const lamp = Boolean(desk.lampLight?.userData.wanted);
        const ad = Boolean(desk.group.userData.officeAdUrl);
        if (!lamp && !ad) {
          if (desk.lampLight) desk.lampLight.visible = false;
          setOfficeAdVisible(desk.group, false);
          continue;
        }
        ranked.push({
          desk,
          dist: origin.distanceToSquared(desk.group.position),
          lamp,
          ad,
        });
      }
      ranked.sort((a, b) => a.dist - b.dist);
      let lampsOn = 0;
      let adsOn = 0;
      let lampsWanted = 0;
      let adsWanted = 0;
      for (const [i, row] of ranked.entries()) {
        const show = i < MAX_NEAR_OFFICES;
        if (row.lamp) lampsWanted += 1;
        if (row.ad) adsWanted += 1;
        if (row.desk.lampLight) {
          row.desk.lampLight.visible = show && row.lamp;
          if (show && row.lamp) lampsOn += 1;
        }
        setOfficeAdVisible(row.desk.group, show && row.ad);
        if (show && row.ad) adsOn += 1;
      }
      return {
        on: lampsOn,
        wanted: lampsWanted,
        ads: { on: adsOn, wanted: adsWanted },
      };
    },
    label(desk: Desk) {
      const claim = claimAt(desk.id);
      const fixture = fixturesOn ? fixtures.get(desk.id) : undefined;
      if (claim) return claim.name;
      if (fixture) return fixture;
      return "empty";
    },
    approach(desk: Desk) {
      const door = officeDoor(desk.group);
      if (door) {
        door.updateWorldMatrix(true, true);
        const edge = String(door.userData.doorEdge ?? "n");
        const alongX = Boolean(door.userData.alongX ?? (edge === "n" || edge === "s"));
        const local = new THREE.Vector3();
        if (alongX) local.z = edge === "n" ? -0.7 : 0.7;
        else local.x = edge === "w" ? -0.7 : 0.7;
        door.localToWorld(local);
        return fromWorld(local.x, local.z, plate);
      }
      return fromWorld(desk.group.position.x, desk.group.position.z, plate);
    },
    pretty(desk: Desk) {
      const kind = desk.kind === "cubicle" ? "Cube" : "Office";
      return `${kind} ${desk.instance.col},${desk.instance.row}`;
    },
    all() {
      return [...desks.values()].sort((a, b) => {
        if (a.instance.row !== b.instance.row) return a.instance.row - b.instance.row;
        return a.instance.col - b.instance.col;
      });
    },
  };
}
