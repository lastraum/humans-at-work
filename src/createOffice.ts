import * as THREE from "three";
import { SCALE, toWorld } from "./coords";
import {
  createHingedDoor,
  createWallSegment,
  createWindow,
} from "./createPlate";
import { applyItemTransform, loadFurnitureFromItems } from "./loadFurniture";
import {
  INDOOR_KINDS,
  clampDoorToSouthWall,
  conferencePerimeter,
  defaultConferenceTemplate,
  defaultRecreationTemplate,
  kindAt,
} from "./grid";
import type { FloorPlate, FurnitureItem, OfficeInstance, OfficeTemplate } from "./types";

export type RoomKind = "office" | "cubicle" | "conference" | "recreation";

export const ROOM_ROT_Y: Record<number, number> = {
  0: 0,
  90: -Math.PI / 2,
  180: Math.PI,
  270: Math.PI / 2,
};

export function localPlate(plate: FloorPlate): FloorPlate {
  const cell =
    plate.officeTemplate?.size ??
    plate.cubicleTemplate?.size ??
    plate.grid.cellSize;
  return {
    ...plate,
    grid: { ...plate.grid, width: cell, height: cell, cellSize: cell },
  };
}

export function officeWorldCenter(
  office: OfficeInstance,
  plate: FloorPlate,
): [number, number, number] {
  const cell = plate.grid.cellSize;
  const cols = office.cols ?? 1;
  const rows = office.rows ?? 1;
  return toWorld(
    office.col * cell + (cols * cell) / 2,
    office.row * cell + (rows * cell) / 2,
    plate,
  );
}

export function localPlateFor(
  plate: FloorPlate,
  cols = 1,
  rows = 1,
): FloorPlate {
  const cell =
    plate.officeTemplate?.size ??
    plate.cubicleTemplate?.size ??
    plate.grid.cellSize;
  return {
    ...plate,
    grid: {
      ...plate.grid,
      width: cell * cols,
      height: cell * rows,
      cellSize: cell,
    },
  };
}

function addStructure(
  parent: THREE.Object3D,
  items: FurnitureItem[],
  plate: FloorPlate,
) {
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
  for (const item of items) {
    if (item.type === "wall") parent.add(createWallSegment(item, plate, wallMat, baseMat));
    else if (item.type === "door") parent.add(createHingedDoor(item, plate, frameMat, leafMat));
    else if (item.type === "window") parent.add(createWindow(item, plate, frameMat));
  }
}

function copyItem(item: FurnitureItem, uid: string): FurnitureItem {
  return { ...item, _uid: uid };
}

function windowNeighbor(office: OfficeInstance) {
  const cols = office.cols ?? 1;
  const rows = office.rows ?? 1;
  // Template window is local +Z (south). rot 90 yaw is -90°, so +Z → world −X (west).
  if (office.rot === 90) return { col: office.col - 1, row: office.row };
  if (office.rot === 180) return { col: office.col, row: office.row - 1 };
  if (office.rot === 270) return { col: office.col + cols, row: office.row };
  return { col: office.col, row: office.row + rows };
}

function officeWindowFacesOutside(plate: FloorPlate, office: OfficeInstance) {
  const next = windowNeighbor(office);
  const kind = kindAt(plate, next.col, next.row);
  if (!kind) return true;
  return !INDOOR_KINDS.includes(kind);
}

function solidSouthWall(
  structure: FurnitureItem[],
  sizeW: number,
  sizeH: number,
): FurnitureItem[] {
  const wall = 8;
  const south = sizeH - wall;
  const next = structure.filter((item) => {
    if (item.type === "window" && (item.windowEdge === "s" || (item.y ?? 0) >= south - 0.5)) {
      return false;
    }
    if (item.type === "wall" && (item.y ?? 0) >= south - 0.5 && (item.h ?? 10) <= wall + 2) {
      return false;
    }
    return true;
  });
  next.push({
    _uid: "wall_interior_s",
    type: "wall",
    x: 0,
    y: south,
    w: sizeW,
    h: wall,
  });
  return next;
}

function uniqueTypeItems(items: FurnitureItem[]) {
  const seen = new Set<string>();
  const out: FurnitureItem[] = [];
  for (const item of items) {
    if (item.type === "door" || seen.has(item.type)) continue;
    seen.add(item.type);
    out.push(item);
  }
  return out;
}

function templateMeshFor(furnitureTemplate: THREE.Group, item: FurnitureItem) {
  const byId = item.id
    ? furnitureTemplate.children.find((child) => {
        const src = child.userData.item as FurnitureItem | undefined;
        return Boolean(src?.id && src.id === item.id && src.type === item.type);
      })
    : undefined;
  if (byId) return byId;
  return furnitureTemplate.children.find((child) => {
    const src = child.userData.item as FurnitureItem | undefined;
    return src?.type === item.type;
  });
}

function stampInstance(
  root: THREE.Group,
  instance: OfficeInstance,
  template: OfficeTemplate,
  furnitureTemplate: THREE.Group,
  plate: FloorPlate,
  kind: RoomKind,
) {
  const cols = instance.cols ?? 1;
  const rows = instance.rows ?? 1;
  const cell =
    plate.officeTemplate?.size ??
    plate.cubicleTemplate?.size ??
    plate.grid.cellSize;
  const structLp = localPlateFor(plate, cols, rows);
  const furnLp = localPlateFor(plate, cols, rows);
  const group = new THREE.Group();
  group.name = instance.id;
  group.userData.cellKind = kind;
  group.userData.office = kind === "office" ? instance : undefined;
  group.userData.cubicle = kind === "cubicle" ? instance : undefined;
  group.userData.conference = kind === "conference" ? instance : undefined;
  group.userData.recreation = kind === "recreation" ? instance : undefined;
  const [wx, , wz] = officeWorldCenter(instance, plate);
  group.position.set(wx, 0, wz);
  group.rotation.y = ROOM_ROT_Y[instance.rot] ?? 0;

  const ox = ((cols - 1) * cell) / 2;
  const oy = ((rows - 1) * cell) / 2;
  if (!instance.furniture) {
    if (kind === "recreation") {
      const width = cols * cell;
      instance.furniture = [
        {
          _uid: `${instance.id}_screen`,
          type: "projection_screen",
          id: "screen",
          x: (width - 110) / 2,
          y: 12,
          w: 110,
          h: 14,
          facing: 0,
        },
      ];
    } else {
      instance.furniture = template.furniture.map((item, i) => ({
        ...copyItem(item, `${instance.id}_${item.id ?? item._uid}_${i}`),
        x: (item.x ?? 0) + ox,
        y: (item.y ?? 0) + oy,
      }));
      if (kind === "conference") {
        const door = conferencePerimeter(cols, rows, cell).find((item) => item.type === "door");
        if (door) instance.furniture.push(copyItem(door, `${instance.id}_door`));
      }
    }
  }
  if (kind === "office") {
    const hasDoor = instance.furniture.some((item) => item.type === "door");
    const templateDoor = template.structure?.find((item) => item.type === "door");
    if (!hasDoor && templateDoor) {
      instance.furniture.push({
        ...copyItem(templateDoor, `${instance.id}_door`),
        id: "door",
        open: 0,
        x: (templateDoor.x ?? 0) + ox,
        y: (templateDoor.y ?? 0) + oy,
      });
    }
  }

  const door = instance.furniture.find((item) => item.type === "door");
  let walls =
    kind === "conference"
      ? conferencePerimeter(cols, rows, cell, door?.x).filter((item) => item.type === "wall")
      : template.structure?.filter((item) => item.type !== "door") ?? [];
  if (kind === "office" && !officeWindowFacesOutside(plate, instance)) {
    walls = solidSouthWall(walls, cell * cols, cell * rows);
  }
  if (walls.length) addStructure(group, walls, structLp);

  const frameMat = new THREE.MeshStandardMaterial({
    color: 0x4a3421,
    roughness: 0.88,
  });
  const leafMat = new THREE.MeshStandardMaterial({
    color: 0x7c5330,
    roughness: 0.74,
  });

  for (const item of instance.furniture) {
    if (item.type === "door") {
      if (kind === "conference") clampDoorToSouthWall(item, cols, rows, cell);
      const doorMesh = createHingedDoor(item, furnLp, frameMat, leafMat);
      doorMesh.userData = {
        item,
        editable: true,
        isDoor: true,
        cellKind: kind,
        officeId: instance.id,
      };
      group.add(doorMesh);
      continue;
    }
    const src = templateMeshFor(furnitureTemplate, item);
    if (!src) continue;
    const clone = src.clone(true);
    clone.userData = {
      item,
      editable: true,
      cellKind: kind,
      officeId: instance.id,
    };
    applyItemTransform(clone, item, furnLp);
    group.add(clone);
  }
  root.add(group);
}

export function rebuildConferenceShell(
  group: THREE.Object3D,
  instance: OfficeInstance,
  plate: FloorPlate,
) {
  const cols = instance.cols ?? 1;
  const rows = instance.rows ?? 1;
  const cell = plate.grid.cellSize;
  const door = instance.furniture?.find((item) => item.type === "door");
  for (const child of [...group.children]) {
    if (!child.userData?.editable) group.remove(child);
  }
  const walls = conferencePerimeter(cols, rows, cell, door?.x).filter(
    (item) => item.type === "wall",
  );
  addStructure(group, walls, localPlateFor(plate, cols, rows));
}

async function createTemplatedCells(
  plate: FloorPlate,
  template: OfficeTemplate,
  instances: OfficeInstance[],
  name: string,
  kind: RoomKind,
) {
  const root = new THREE.Group();
  root.name = name;
  const lp = localPlate(plate);
  const catalog = uniqueTypeItems([
    ...template.furniture,
    ...instances.flatMap((instance) => instance.furniture ?? []),
  ]);
  const furnitureTemplate = await loadFurnitureFromItems(catalog, lp);
  root.userData.furnitureTemplate = furnitureTemplate;
  root.userData.roomTemplate = template;
  root.userData.roomKind = kind;
  for (const instance of instances) {
    stampInstance(root, instance, template, furnitureTemplate, plate, kind);
  }
  return root;
}

export async function restampTemplatedCells(
  root: THREE.Group,
  plate: FloorPlate,
  instances: OfficeInstance[],
  template: OfficeTemplate | undefined,
  kind: RoomKind,
) {
  if (!template) return;
  for (const child of [...root.children]) root.remove(child);
  const base =
    (root.userData.furnitureTemplate as THREE.Group | undefined) ??
    (await loadFurnitureFromItems(template.furniture, localPlate(plate)));
  root.userData.furnitureTemplate = base;
  const catalog = uniqueTypeItems([
    ...template.furniture,
    ...instances.flatMap((instance) => instance.furniture ?? []),
  ]);
  const tpl =
    catalog.length > 0
      ? await loadFurnitureFromItems(catalog, localPlate(plate))
      : base;
  root.userData.furnitureTemplate = tpl;
  for (const instance of instances) {
    stampInstance(root, instance, template, tpl, plate, kind);
  }
}

export function syncTemplatedCells(
  root: THREE.Group,
  plate: FloorPlate,
  instances: OfficeInstance[],
  template: OfficeTemplate | undefined,
  kind: RoomKind,
) {
  if (!template) return;
  const furnitureTemplate = root.userData.furnitureTemplate as THREE.Group | undefined;
  if (!furnitureTemplate) return;
  const wanted = new Map(instances.map((item) => [item.id, item]));
  for (const child of [...root.children]) {
    if (!wanted.has(child.name)) root.remove(child);
  }
  const existing = new Map(root.children.map((child) => [child.name, child]));
  for (const instance of instances) {
    const group = existing.get(instance.id);
    if (group) {
      const [wx, , wz] = officeWorldCenter(instance, plate);
      group.position.set(wx, 0, wz);
      group.rotation.y = ROOM_ROT_Y[instance.rot] ?? 0;
      group.userData.office = kind === "office" ? instance : undefined;
      group.userData.cubicle = kind === "cubicle" ? instance : undefined;
      group.userData.conference = kind === "conference" ? instance : undefined;
      group.userData.recreation = kind === "recreation" ? instance : undefined;
      continue;
    }
    stampInstance(root, instance, template, furnitureTemplate, plate, kind);
  }
}

export async function createOffices(plate: FloorPlate) {
  if (!plate.officeTemplate || !plate.offices) {
    const root = new THREE.Group();
    root.name = "offices";
    return root;
  }
  return createTemplatedCells(
    plate,
    plate.officeTemplate,
    plate.offices,
    "offices",
    "office",
  );
}

export async function createCubicles(plate: FloorPlate) {
  if (!plate.cubicleTemplate || !plate.cubicles) {
    const root = new THREE.Group();
    root.name = "cubicles";
    return root;
  }
  return createTemplatedCells(
    plate,
    plate.cubicleTemplate,
    plate.cubicles,
    "cubicles",
    "cubicle",
  );
}

export async function createConferences(plate: FloorPlate) {
  plate.conferenceTemplate ??= defaultConferenceTemplate(
    plate.officeTemplate?.size ?? plate.grid.cellSize,
  );
  plate.conferences ??= [];
  return createTemplatedCells(
    plate,
    plate.conferenceTemplate,
    plate.conferences,
    "conferences",
    "conference",
  );
}

export async function createRecreations(plate: FloorPlate) {
  plate.recreationTemplate ??= defaultRecreationTemplate(
    plate.officeTemplate?.size ?? plate.grid.cellSize,
  );
  plate.recreations ??= [];
  return createTemplatedCells(
    plate,
    plate.recreationTemplate,
    plate.recreations,
    "recreations",
    "recreation",
  );
}

export function syncTemplateFurniture(
  root: THREE.Group,
  template: NonNullable<FloorPlate["officeTemplate"]>,
  plate: FloorPlate,
) {
  const lp = localPlate(plate);
  const byId = new Map(template.furniture.map((item) => [item.id ?? item._uid, item]));
  root.traverse((node) => {
    const id = node.userData?.templateId as string | undefined;
    if (!id || !node.userData?.editable) return;
    const item = byId.get(id);
    if (!item) return;
    node.userData.item = item;
    applyItemTransform(node, item, lp);
  });
}

export function syncOfficeFurniture(officesRoot: THREE.Group, plate: FloorPlate) {
  if (!plate.officeTemplate) return;
  syncTemplateFurniture(officesRoot, plate.officeTemplate, plate);
}

const _box = new THREE.Box3();
const _corner = new THREE.Vector3();

/** Clamp using the real mesh bounds in office-local space, not the unrotated AABB. */
export function clampObjectToOffice(
  obj: THREE.Object3D,
  office: THREE.Object3D,
  item: FurnitureItem,
  cell: number,
  wall = 8,
) {
  obj.updateWorldMatrix(true, true);
  office.updateWorldMatrix(true, true);
  _box.makeEmpty();
  obj.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (!mesh.isMesh || !mesh.geometry) return;
    if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
    const bb = mesh.geometry.boundingBox;
    if (!bb) return;
    for (let ix = 0; ix < 2; ix++) {
      for (let iy = 0; iy < 2; iy++) {
        for (let iz = 0; iz < 2; iz++) {
          _corner.set(
            ix ? bb.max.x : bb.min.x,
            iy ? bb.max.y : bb.min.y,
            iz ? bb.max.z : bb.min.z,
          );
          _corner.applyMatrix4(mesh.matrixWorld);
          office.worldToLocal(_corner);
          _box.expandByPoint(_corner);
        }
      }
    }
  });
  if (_box.isEmpty()) return;

  const halfW = (_box.max.x - _box.min.x) / 2;
  const halfD = (_box.max.z - _box.min.z) / 2;
  const cx = (_box.min.x + _box.max.x) / 2;
  const cz = (_box.min.z + _box.max.z) / 2;
  const inst =
    office.userData?.conference ??
    office.userData?.office ??
    office.userData?.cubicle ??
    office.userData?.recreation;
  const spanX = cell * (inst?.cols ?? 1);
  const spanZ = cell * (inst?.rows ?? 1);
  const limitX = (spanX / 2 - wall) * SCALE;
  const limitZ = (spanZ / 2 - wall) * SCALE;
  const ncx =
    halfW >= limitX ? 0 : Math.min(Math.max(cx, -limitX + halfW), limitX - halfW);
  const ncz =
    halfD >= limitZ ? 0 : Math.min(Math.max(cz, -limitZ + halfD), limitZ - halfD);
  item.x += (ncx - cx) / SCALE;
  item.y += (ncz - cz) / SCALE;
}


