import * as THREE from "three";
import { fromWorld } from "./coords";
import { setHingedDoorOpen } from "./createPlate";
import { applyOfficeAd } from "./officeAds";
import { clampPrivacy, type Claim, type DeskKind, type Privacy } from "./protocol";
import type { FloorPlate, OfficeInstance } from "./types";

export type Desk = {
  id: string;
  kind: DeskKind;
  instance: OfficeInstance;
  group: THREE.Object3D;
  seat: { x: number; y: number; facing: number };
};

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

function isSittable(type: string) {
  if (type === "beanbag" || type === "couch") return true;
  if (type.includes("sofa") || type.includes("chair")) return true;
  return false;
}

function isCouchLike(type: string) {
  return type === "couch" || type.includes("sofa");
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
) {
  node.updateWorldMatrix(true, true);
  const box = new THREE.Box3().setFromObject(node);
  const center = box.getCenter(new THREE.Vector3());
  const item = node.userData.item as { facing?: number; type?: string };
  const furnFacing = (((item.facing ?? 0) + roomRot) % 360 + 360) % 360;
  const facing = (furnFacing + 180) % 360;
  const rad = (facing * Math.PI) / 180;
  if (click && isCouchLike(item.type ?? "")) {
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
  const canvas = fromWorld(
    center.x + Math.sin(rad) * 0.12,
    center.z + Math.cos(rad) * 0.12,
    plate,
  );
  return { x: canvas.x, y: canvas.y, facing };
}

export function chairSeat(group: THREE.Object3D, inst: OfficeInstance, plate: FloorPlate) {
  const chair = chairNode(group);
  if (chair) return furnitureSeat(chair, plate, undefined, inst.rot ?? 0);
  const cell = plate.grid.cellSize;
  return {
    x: inst.col * cell + ((inst.cols ?? 1) * cell) / 2,
    y: inst.row * cell + ((inst.rows ?? 1) * cell) / 2,
    facing: inst.rot ?? 0,
  };
}

const VACANT = { color: 0x15202c, emissive: 0x05080c, intensity: 0.12, opacity: 0.62 };
const OCCUPIED = { color: 0xffd7a0, emissive: 0xff9a3a, intensity: 0.85, opacity: 0.42 };
const FOCUS = { color: 0x121820, emissive: 0x05080c, intensity: 0.06, opacity: 0.82 };

function drawDoorPlate(canvas: HTMLCanvasElement, name: string) {
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
  ctx.font = "700 48px ui-sans-serif, system-ui, sans-serif";
  ctx.fillText(name.slice(0, 16).toUpperCase(), w / 2, h / 2 + 2);
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
  light = new THREE.PointLight(0xffc27a, 0, 6.5, 2);
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

function ensureDoorPlate(door: THREE.Object3D) {
  let plate = door.getObjectByName("door-plate") as THREE.Mesh | undefined;
  if (!plate) {
    const canvas = document.createElement("canvas");
    canvas.width = 512;
    canvas.height = 96;
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    plate = new THREE.Mesh(
      new THREE.PlaneGeometry(0.78, 0.2),
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
  } else {
    plate.geometry.dispose();
    plate.geometry = new THREE.PlaneGeometry(0.78, 0.2);
    (plate.material as THREE.MeshBasicMaterial).side = THREE.FrontSide;
  }
  const edge = String(door.userData.doorEdge ?? "n");
  const alongX = Boolean(door.userData.alongX ?? (edge === "n" || edge === "s"));
  const out = 0.14;
  plate.position.set(0, 1.01, 0);
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
  looseRoot?: THREE.Group;
}) {
  const { plate, officesRoot, cubiclesRoot, recreationsRoot, looseRoot } = opts;
  const desks = new Map<string, Desk>();
  const claims = new Map<string, Claim>();
  const fixtures = new Map<string, string>();
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

  const paint = (desk: Desk) => {
    const oldSign = desk.group.getObjectByName("desk-sign");
    if (oldSign) oldSign.visible = false;
    desk.group.traverse((node) => {
      if (node.name === "window-name") node.visible = false;
    });
    const fixture = fixtures.get(desk.id);
    const claim = claimAt(desk.id);
    const occupied = Boolean(claim || fixture);
    const privacy: Privacy = claim ? clampPrivacy(claim.privacy) : "open";
    const look = !occupied ? VACANT : privacy === "focus" ? FOCUS : OCCUPIED;
    const name = occupied ? (claim?.name ?? fixture ?? "") : "";
    for (const glass of windowGlasses(desk.group)) tintGlass(glass, look);
    const adUrl =
      claim?.kind === "office" && claim.officeAd?.enabled && claim.officeAd.url
        ? claim.officeAd.url
        : null;
    applyOfficeAd(desk.group, adUrl);
    const lamp = lampNode(desk.group);
    if (lamp) {
      const light = ensureLampLight(lamp);
      light.visible = occupied;
      light.intensity = !occupied ? 0 : privacy === "focus" ? 0.85 : 1.55;
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
      const plate = ensureDoorPlate(door);
      if (plate) {
        if (occupied && name) {
          drawDoorPlate(plate.userData.canvas as HTMLCanvasElement, name);
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
      const next = chairSeat(desk.group, desk.instance, plate);
      desk.seat = next;
      return next;
    },
    couchSeat(desk: Desk) {
      const couch = couchNode(desk.group);
      if (!couch) return null;
      return furnitureSeat(couch, plate, undefined, desk.instance.rot ?? 0);
    },
    pickSeat(camera: THREE.Camera, pointer: THREE.Vector2) {
      seatRay.setFromCamera(pointer, camera);
      const targets: THREE.Object3D[] = [...desks.values()].map((desk) => desk.group);
      if (recreationsRoot) targets.push(...recreationsRoot.children);
      if (looseRoot) targets.push(...looseRoot.children);
      const hits = seatRay.intersectObjects(targets, true);
      const hit = hits[0];
      if (!hit) return null;
      const node = itemNodeFrom(hit.object);
      const type = node?.userData?.item?.type as string | undefined;
      if (!node || !type || !isSittable(type)) return null;
      let parent: THREE.Object3D | null = node;
      let desk: Desk | null = null;
      let roomRot = 0;
      while (parent) {
        const inst =
          (parent.userData?.office as OfficeInstance | undefined) ??
          (parent.userData?.cubicle as OfficeInstance | undefined);
        const rec = parent.userData?.recreation as OfficeInstance | undefined;
        if (inst) {
          desk = desks.get(inst.id) ?? null;
          roomRot = inst.rot ?? 0;
          break;
        }
        if (rec) {
          roomRot = rec.rot ?? 0;
          break;
        }
        parent = parent.parent;
      }
      return {
        desk,
        type,
        seat: furnitureSeat(node, plate, hit.point, roomRot),
      };
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
            desk: label,
            privacy: claim.privacy,
            since: claim.since,
          };
        })
        .sort((a, b) => a.name.localeCompare(b.name)),
    fixture: (id: string) => fixtures.get(id),
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
    label(desk: Desk) {
      const claim = claimAt(desk.id);
      const fixture = fixtures.get(desk.id);
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
