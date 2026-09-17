import * as THREE from "three";
import { TransformControls } from "three/addons/controls/TransformControls.js";
import {
  FURNITURE_TINT,
  FURNITURE_Y_OFFSET,
  SCALE,
  cellToWorld,
  fromWorld,
} from "./coords";
import { applyAvatarTransform, setAvatarPose } from "./createAvatars";
import {
  ROOM_ROT_Y,
  rebuildConferenceShell,
  clampObjectToOffice,
  localPlate,
  localPlateFor,
  restampTemplatedCells,
  syncTemplatedCells,
  type RoomKind,
} from "./createOffice";
import { TILE, applyDoorTransform, createHingedDoor, refreshGround } from "./createPlate";
import {
  PAINT_KINDS,
  addCol,
  addRow,
  clampDoorToSouthWall,
  kindAt,
  paintCell,
  removeCol,
  removeRow,
} from "./grid";
import { GROUP_SWATCH, catalogGroup, groupedTypes } from "./furnitureCatalog";
import { applyItemTransform, loadFurnitureFromItems, spawnFurniture } from "./loadFurniture";
import type {
  Avatar,
  CellKind,
  FloorPlate,
  FurnitureItem,
  OfficeInstance,
  OfficeTemplate,
} from "./types";

type Editable = THREE.Object3D & {
  userData: {
    item: FurnitureItem;
    avatar?: Avatar;
    editable: boolean;
    templateId?: string;
    officeId?: string;
    cellKind?: "office" | "cubicle" | "conference" | "recreation" | "library";
    isDoor?: boolean;
  };
};

type Tool = "orbit" | "translate" | "rotate" | "scale";
const TOOLS: Tool[] = ["orbit", "translate", "rotate", "scale"];

const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

function cellGroupOf(node: THREE.Object3D | null): THREE.Object3D | null {
  while (node) {
    if (
      node.userData?.office ||
      node.userData?.cubicle ||
      node.userData?.conference ||
      node.userData?.recreation ||
      node.userData?.library
    ) {
      return node;
    }
    node = node.parent;
  }
  return null;
}

function round1(n: number) {
  return Math.round(n * 10) / 10;
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

function prettyType(type: string) {
  return type.replace(/_/g, " ");
}

let uidSeq = 0;
function nextUid(type: string) {
  uidSeq += 1;
  return `${type}_${Date.now().toString(36)}_${uidSeq}`;
}

function asEditable(node: THREE.Object3D): Editable {
  return node as unknown as Editable;
}

function isTypingTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || target.isContentEditable;
}

export function attachEditor(opts: {
  camera: THREE.Camera;
  canvas: HTMLCanvasElement;
  scene: THREE.Scene;
  controls: { enabled: boolean };
  plate: FloorPlate;
  furnitureRoot: THREE.Group;
  officesRoot: THREE.Group;
  cubiclesRoot: THREE.Group;
  conferencesRoot: THREE.Group;
  recreationsRoot: THREE.Group;
  librariesRoot: THREE.Group;
  looseRoot: THREE.Group;
  avatarsRoot: THREE.Group;
  ground: THREE.Group;
  panel: HTMLElement;
  palette: HTMLElement;
  sceneList: HTMLElement;
  gridPanel: HTMLElement;
  toolHud: HTMLElement;
}) {
  const {
    camera,
    canvas,
    scene,
    controls,
    plate,
    furnitureRoot,
    officesRoot,
    cubiclesRoot,
    conferencesRoot,
    recreationsRoot,
    librariesRoot,
    looseRoot,
    avatarsRoot,
    ground,
    panel,
    palette,
    sceneList,
    gridPanel,
    toolHud,
  } = opts;
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const hitPoint = new THREE.Vector3();
  const localHit = new THREE.Vector3();
  const cell =
    plate.officeTemplate?.size ??
    plate.cubicleTemplate?.size ??
    plate.grid.cellSize;
  const lp = localPlate(plate);

  let editing = false;
  let selected: Editable | null = null;
  let dragging = false;
  let dragOffset = { x: 0,  y: 0 };
  let tool: Tool = "orbit";
  let clipboard: FurnitureItem | null = null;
  let paintKind: CellKind | null = null;
  let paintingGrid = false;
  let selectedCell: { col: number; row: number } | null = null;
  let strokeUndo = false;
  let restoring = false;
  let syncSiblings = false;
  let pasteSiblings = false;
  let deleteSiblings = false;
  type PlateSnap = {
    cells: string[];
    grid: FloorPlate["grid"];
    furniture: FurnitureItem[];
    offices: OfficeInstance[];
    cubicles: OfficeInstance[];
    conferences: OfficeInstance[];
    recreations: OfficeInstance[];
    libraries: OfficeInstance[];
    officeTemplate?: OfficeTemplate;
    cubicleTemplate?: OfficeTemplate;
    conferenceTemplate?: OfficeTemplate;
    recreationTemplate?: OfficeTemplate;
    libraryTemplate?: OfficeTemplate;
  };
  const undoStack: PlateSnap[] = [];
  const redoStack: PlateSnap[] = [];
  const MAX_UNDO = 80;

  const snapshotPlate = (): PlateSnap =>
    structuredClone({
      cells: plate.cells,
      grid: plate.grid,
      furniture: plate.furniture,
      offices: plate.offices ?? [],
      cubicles: plate.cubicles ?? [],
      conferences: plate.conferences ?? [],
      recreations: plate.recreations ?? [],
      libraries: plate.libraries ?? [],
      officeTemplate: plate.officeTemplate,
      cubicleTemplate: plate.cubicleTemplate,
      conferenceTemplate: plate.conferenceTemplate,
      recreationTemplate: plate.recreationTemplate,
      libraryTemplate: plate.libraryTemplate,
    });

  const applyPlateSnap = (snap: PlateSnap) => {
    plate.cells = structuredClone(snap.cells);
    plate.grid = structuredClone(snap.grid);
    plate.furniture = structuredClone(snap.furniture);
    plate.offices = structuredClone(snap.offices);
    plate.cubicles = structuredClone(snap.cubicles);
    plate.conferences = structuredClone(snap.conferences);
    plate.recreations = structuredClone(snap.recreations);
    plate.libraries = structuredClone(snap.libraries);
    plate.officeTemplate = structuredClone(snap.officeTemplate);
    plate.cubicleTemplate = structuredClone(snap.cubicleTemplate);
    plate.conferenceTemplate = structuredClone(snap.conferenceTemplate);
    plate.recreationTemplate = structuredClone(snap.recreationTemplate);
    plate.libraryTemplate = structuredClone(snap.libraryTemplate);
  };

  const pushUndo = () => {
    if (restoring) return;
    undoStack.push(snapshotPlate());
    if (undoStack.length > MAX_UNDO) undoStack.shift();
    redoStack.length = 0;
  };

  const restoreScene = async () => {
    gizmo.detach();
    selectObject(null);
    refreshGround(ground, plate);
    await Promise.all([
      restampTemplatedCells(
        officesRoot,
        plate,
        plate.offices ?? [],
        plate.officeTemplate,
        "office",
      ),
      restampTemplatedCells(
        cubiclesRoot,
        plate,
        plate.cubicles ?? [],
        plate.cubicleTemplate,
        "cubicle",
      ),
      restampTemplatedCells(
        conferencesRoot,
        plate,
        plate.conferences ?? [],
        plate.conferenceTemplate,
        "conference",
      ),
      restampTemplatedCells(
        recreationsRoot,
        plate,
        plate.recreations ?? [],
        plate.recreationTemplate,
        "recreation",
      ),
      restampTemplatedCells(
        librariesRoot,
        plate,
        plate.libraries ?? [],
        plate.libraryTemplate,
        "library",
      ),
    ]);
    while (looseRoot.children.length) looseRoot.remove(looseRoot.children[0]);
    const loose = await loadFurnitureFromItems(
      plate.furniture.filter(
        (item) => item.type !== "wall" && item.type !== "door" && item.type !== "window",
      ),
      plate,
    );
    for (const child of [...loose.children]) looseRoot.add(child);
    renderSceneList();
    renderGridPanel();
    renderInspector();
    placeCellHighlight();
  };

  const undo = async () => {
    const snap = undoStack.pop();
    if (!snap) return;
    redoStack.push(snapshotPlate());
    restoring = true;
    applyPlateSnap(snap);
    await restoreScene();
    restoring = false;
  };

  const redo = async () => {
    const snap = redoStack.pop();
    if (!snap) return;
    undoStack.push(snapshotPlate());
    restoring = true;
    applyPlateSnap(snap);
    await restoreScene();
    restoring = false;
  };
  const cellHighlight = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.MeshBasicMaterial({
      color: 0xffdd66,
      transparent: true,
      opacity: 0.28,
      depthWrite: false,
    }),
  );
  cellHighlight.rotation.x = -Math.PI / 2;
  cellHighlight.position.y = 0.02;
  cellHighlight.visible = false;
  cellHighlight.name = "cell-highlight";
  ground.add(cellHighlight);
  const box = new THREE.BoxHelper(new THREE.Object3D(), 0xffdd66);
  box.visible = false;
  scene.add(box);

  const gizmo = new TransformControls(camera, canvas);
  gizmo.setSize(0.85);
  scene.add(gizmo.getHelper());

  const setPointer = (event: PointerEvent) => {
    const rect = canvas.getBoundingClientRect();
    pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  };

  const pickEditable = (): Editable | null => {
    raycaster.setFromCamera(pointer, camera);
    const hits = raycaster.intersectObjects(furnitureRoot.children, true);
    for (const hit of hits) {
      let node: THREE.Object3D | null = hit.object;
      while (node) {
        if (node.userData?.editable && (node.userData.item || node.userData.avatar)) {
          return node as Editable;
        }
        node = node.parent;
      }
    }
    return null;
  };

  const groundAtPointer = () => {
    raycaster.setFromCamera(pointer, camera);
    if (!raycaster.ray.intersectPlane(groundPlane, hitPoint)) return null;
    return hitPoint;
  };

  const roomInstanceOf = (node: THREE.Object3D | null) => {
    const group = cellGroupOf(node);
    if (!group) return null;
    return (
      (group.userData.office as OfficeInstance | undefined) ??
      (group.userData.cubicle as OfficeInstance | undefined) ??
      (group.userData.conference as OfficeInstance | undefined) ??
      (group.userData.recreation as OfficeInstance | undefined) ??
      (group.userData.library as OfficeInstance | undefined) ??
      null
    );
  };

  const roomLocalPlateOf = (node: THREE.Object3D | null) => {
    const inst = roomInstanceOf(node);
    if (!inst) return lp;
    return localPlateFor(plate, inst.cols ?? 1, inst.rows ?? 1);
  };

  const localFromWorld = (office: THREE.Object3D, world: THREE.Vector3) => {
    localHit.copy(world);
    office.worldToLocal(localHit);
    const inst = roomInstanceOf(office);
    const halfW = ((inst?.cols ?? 1) * cell) / 2;
    const halfH = ((inst?.rows ?? 1) * cell) / 2;
    return {
      x: localHit.x / SCALE + halfW,
      y: localHit.z / SCALE + halfH,
    };
  };

  const usesLocal = (obj: Editable) =>
    Boolean(obj.userData.officeId || obj.userData.templateId || obj.userData.avatar);

  const instancesFor = (kind: RoomKind) => {
    if (kind === "office") return plate.offices ?? [];
    if (kind === "cubicle") return plate.cubicles ?? [];
    if (kind === "conference") return plate.conferences ?? [];
    if (kind === "library") return plate.libraries ?? [];
    return plate.recreations ?? [];
  };

  const roomsRootFor = (kind: RoomKind) => {
    if (kind === "office") return officesRoot;
    if (kind === "cubicle") return cubiclesRoot;
    if (kind === "conference") return conferencesRoot;
    if (kind === "library") return librariesRoot;
    return recreationsRoot;
  };

  const templateFor = (kind: RoomKind) => {
    if (kind === "office") return plate.officeTemplate;
    if (kind === "cubicle") return plate.cubicleTemplate;
    if (kind === "conference") return plate.conferenceTemplate;
    if (kind === "library") return plate.libraryTemplate;
    return plate.recreationTemplate;
  };

  const copyItemPose = (from: FurnitureItem, to: FurnitureItem) => {
    to.x = from.x;
    to.y = from.y;
    to.facing = from.facing;
    to.pitch = from.pitch;
    to.roll = from.roll;
    to.sx = from.sx;
    to.sy = from.sy;
    to.sz = from.sz;
    to.elevation = from.elevation;
    if (from.w !== undefined) to.w = from.w;
    if (from.h !== undefined) to.h = from.h;
  };

  const siblingItem = (
    list: FurnitureItem[],
    source: FurnitureItem,
    sourceList: FurnitureItem[],
  ) => {
    if (source.id) return list.find((entry) => entry.id === source.id);
    const srcIdx = sourceList
      .filter((entry) => entry.type === source.type)
      .findIndex((entry) => entry._uid === source._uid);
    if (srcIdx < 0) return undefined;
    return list.filter((entry) => entry.type === source.type)[srcIdx];
  };

  const applySyncSiblings = (sourceNode: Editable) => {
    if (!syncSiblings) return;
    const kind = sourceNode.userData.cellKind;
    if (!kind) return;
    const srcInst = roomInstanceOf(sourceNode);
    const srcItem = sourceNode.userData.item;
    if (!srcInst?.furniture) return;
    const srcList = srcInst.furniture;
    const ox = (((srcInst.cols ?? 1) - 1) * cell) / 2;
    const oy = (((srcInst.rows ?? 1) - 1) * cell) / 2;
    const template = templateFor(kind);
    if (template && srcItem.id) {
      const tplItem = template.furniture.find((entry) => entry.id === srcItem.id);
      if (tplItem) {
        copyItemPose(
          { ...srcItem, x: srcItem.x - ox, y: srcItem.y - oy },
          tplItem,
        );
      }
    }
    const root = roomsRootFor(kind);
    for (const inst of instancesFor(kind)) {
      if (inst.id === srcInst.id) continue;
      if ((inst.cols ?? 1) !== (srcInst.cols ?? 1) || (inst.rows ?? 1) !== (srcInst.rows ?? 1)) {
        continue;
      }
      const dest = siblingItem(inst.furniture ?? [], srcItem, srcList);
      if (!dest) continue;
      copyItemPose(srcItem, dest);
      const group = root.getObjectByName(inst.id);
      if (!group) continue;
      group.traverse((node) => {
        if (!node.userData?.editable) return;
        const item = node.userData.item as FurnitureItem | undefined;
        if (!item || item._uid !== dest._uid) return;
        const rlp = localPlateFor(plate, inst.cols ?? 1, inst.rows ?? 1);
        if (item.type === "door") {
          clampDoorToSouthWall(item, inst.cols ?? 1, inst.rows ?? 1, cell);
          applyDoorTransform(node, item, rlp);
          rebuildConferenceShell(group, inst, plate);
        } else {
          applyItemTransform(node, item, rlp);
        }
      });
    }
  };

  const replicatePaste = async (
    item: FurnitureItem,
    srcInst: OfficeInstance,
    kind: RoomKind,
  ) => {
    if (!pasteSiblings || item.type === "door") return;
    const root = roomsRootFor(kind);
    for (const inst of instancesFor(kind)) {
      if (inst.id === srcInst.id) continue;
      if ((inst.cols ?? 1) !== (srcInst.cols ?? 1) || (inst.rows ?? 1) !== (srcInst.rows ?? 1)) {
        continue;
      }
      const parent = root.getObjectByName(inst.id);
      if (!parent) continue;
      const clone: FurnitureItem = {
        ...item,
        _uid: nextUid(item.type),
        id: undefined,
      };
      await spawnIntoRoom(clone, parent, inst, kind);
    }
  };

  const replicateDelete = (sourceNode: Editable) => {
    if (!deleteSiblings) return;
    const kind = sourceNode.userData.cellKind;
    if (!kind) return;
    const srcInst = roomInstanceOf(sourceNode);
    const srcItem = sourceNode.userData.item;
    if (!srcInst?.furniture || srcItem.type === "door") return;
    const srcList = srcInst.furniture.slice();
    const ox = (((srcInst.cols ?? 1) - 1) * cell) / 2;
    const oy = (((srcInst.rows ?? 1) - 1) * cell) / 2;
    const template = templateFor(kind);
    if (template) {
      if (srcItem.id) {
        template.furniture = template.furniture.filter((entry) => entry.id !== srcItem.id);
      } else {
        const tx = srcItem.x - ox;
        const ty = srcItem.y - oy;
        let best = -1;
        let bestD = Infinity;
        template.furniture.forEach((entry, i) => {
          if (entry.type !== srcItem.type || entry.id) return;
          const d = Math.hypot(entry.x - tx, entry.y - ty);
          if (d < bestD) {
            bestD = d;
            best = i;
          }
        });
        if (best >= 0 && bestD < 12) template.furniture.splice(best, 1);
      }
    }
    const root = roomsRootFor(kind);
    for (const inst of instancesFor(kind)) {
      if (inst.id === srcInst.id) continue;
      if ((inst.cols ?? 1) !== (srcInst.cols ?? 1) || (inst.rows ?? 1) !== (srcInst.rows ?? 1)) {
        continue;
      }
      const dest = siblingItem(inst.furniture ?? [], srcItem, srcList);
      if (!dest) continue;
      inst.furniture = (inst.furniture ?? []).filter((entry) => entry._uid !== dest._uid);
      const group = root.getObjectByName(inst.id);
      if (!group) continue;
      const remove: THREE.Object3D[] = [];
      group.traverse((node) => {
        if (node.userData?.editable && node.userData.item?._uid === dest._uid) {
          remove.push(node);
        }
      });
      for (const node of remove) node.parent?.remove(node);
    }
  };

  const attachGizmo = () => {
    if (!selected || tool === "orbit" || selected.userData.avatar) {
      gizmo.detach();
      gizmo.enabled = false;
      return;
    }
    gizmo.enabled = true;
    gizmo.setMode(tool);
    const inner = selected.children[0];
    if (selected.userData.isDoor || selected.userData.item?.type === "door") {
      gizmo.setMode("translate");
      gizmo.attach(selected);
      return;
    }
    if (tool === "translate") gizmo.attach(selected);
    else gizmo.attach(inner ?? selected);
  };

  const writeGizmoToItem = () => {
    if (!selected || selected.userData.avatar) return;
    const item = selected.userData.item;
    const inner = selected.children[0];
    if (tool === "translate" || gizmo.getMode() === "translate") {
      if (usesLocal(selected)) {
        const inst = roomInstanceOf(selected);
        const halfW = ((inst?.cols ?? 1) * cell) / 2;
        const halfH = ((inst?.rows ?? 1) * cell) / 2;
        item.x = round1(selected.position.x / SCALE + halfW);
        item.y = round1(selected.position.z / SCALE + halfH);
      } else {
        const canvasPt = fromWorld(selected.position.x, selected.position.z, plate);
        item.x = round1(canvasPt.x);
        item.y = round1(canvasPt.y);
      }
      const baseY = FURNITURE_Y_OFFSET[item.type] ?? 0;
      item.elevation = round2(selected.position.y - baseY);
    }
    if (item.type === "door") return;
    if (inner && (tool === "rotate" || gizmo.getMode() === "rotate")) {
      item.pitch = round1((inner.rotation.x * 180) / Math.PI);
      item.facing = round1((((inner.rotation.y * 180) / Math.PI) % 360 + 360) % 360);
      item.roll = round1((inner.rotation.z * 180) / Math.PI);
    }
    if (inner && (tool === "scale" || gizmo.getMode() === "scale")) {
      item.sx = round2(Math.max(0.05, inner.scale.x));
      item.sy = round2(Math.max(0.05, inner.scale.y));
      item.sz = round2(Math.max(0.05, inner.scale.z));
    }
  };

  const compactItem = (item: FurnitureItem) => ({
    id: item.id ?? item._uid,
    type: item.type,
    x: round1(item.x),
    y: round1(item.y),
    ...(item.w !== undefined ? { w: item.w } : {}),
    ...(item.h !== undefined ? { h: item.h } : {}),
    facing: item.facing ?? 0,
    ...(item.pitch ? { pitch: item.pitch } : {}),
    ...(item.roll ? { roll: item.roll } : {}),
    ...(item.sx !== undefined && item.sx !== 1 ? { sx: item.sx } : {}),
    ...(item.sy !== undefined && item.sy !== 1 ? { sy: item.sy } : {}),
    ...(item.sz !== undefined && item.sz !== 1 ? { sz: item.sz } : {}),
    ...(item.elevation !== undefined ? { elevation: item.elevation } : {}),
  });

  const commit = () => {
    if (!selected) return;
    const item = selected.userData.item;
    const avatar = selected.userData.avatar;
    if (avatar) {
      avatar.x = item.x;
      avatar.y = item.y;
      avatar.facing = item.facing ?? 0;
      const cellGroup = cellGroupOf(selected);
      applyAvatarTransform(selected, avatar, cellGroup ? lp : plate);
      if (cellGroup) {
        clampObjectToOffice(selected, cellGroup, item, cell);
        avatar.x = item.x;
        avatar.y = item.y;
        applyAvatarTransform(selected, avatar, lp);
      }
      box.setFromObject(selected);
      renderInspector();
      highlightList();
      return;
    }
    const cellGroup = cellGroupOf(selected);
    const inst = roomInstanceOf(selected);
    const rlp = roomLocalPlateOf(selected);
    if (cellGroup && inst && item.type === "door") {
      clampDoorToSouthWall(item, inst.cols ?? 1, inst.rows ?? 1, cell);
      applyDoorTransform(selected, item, rlp);
      rebuildConferenceShell(cellGroup, inst, plate);
    } else if (cellGroup && inst) {
      applyItemTransform(selected, item, rlp);
      clampObjectToOffice(selected, cellGroup, item, cell);
    } else {
      applyItemTransform(selected, item, plate);
    }
    applySyncSiblings(selected);
    box.setFromObject(selected);
    attachGizmo();
    renderInspector();
    highlightList();
  };

  const relayout = () => {
    refreshGround(ground, plate);
    syncTemplatedCells(
      officesRoot,
      plate,
      plate.offices ?? [],
      plate.officeTemplate,
      "office",
    );
    syncTemplatedCells(
      cubiclesRoot,
      plate,
      plate.cubicles ?? [],
      plate.cubicleTemplate,
      "cubicle",
    );
    syncTemplatedCells(
      conferencesRoot,
      plate,
      plate.conferences ?? [],
      plate.conferenceTemplate,
      "conference",
    );
    syncTemplatedCells(
      recreationsRoot,
      plate,
      plate.recreations ?? [],
      plate.recreationTemplate,
      "recreation",
    );
    syncTemplatedCells(
      librariesRoot,
      plate,
      plate.libraries ?? [],
      plate.libraryTemplate,
      "library",
    );
    for (const child of looseRoot.children) {
      if (child.userData?.item) applyItemTransform(child, child.userData.item, plate);
    }
    for (const child of avatarsRoot.children) {
      if (child.userData?.avatar) {
        applyAvatarTransform(child, child.userData.avatar, plate);
      }
    }
    placeCellHighlight();
  };

  const placeCellHighlight = () => {
    if (
      !selectedCell ||
      selectedCell.col < 0 ||
      selectedCell.row < 0 ||
      selectedCell.col >= plate.grid.cols ||
      selectedCell.row >= plate.grid.rows
    ) {
      cellHighlight.visible = false;
      return;
    }
    const room = roomAtCell(selectedCell.col, selectedCell.row);
    const cols = room?.instance.cols ?? 1;
    const rows = room?.instance.rows ?? 1;
    const originCol = room?.instance.col ?? selectedCell.col;
    const originRow = room?.instance.row ?? selectedCell.row;
    const cell = plate.grid.cellSize * SCALE;
    const [wx, , wz] = cellToWorld(originCol, originRow, plate);
    cellHighlight.geometry.dispose();
    cellHighlight.geometry = new THREE.PlaneGeometry(
      cell * cols - 0.06,
      cell * rows - 0.06,
    );
    cellHighlight.position.set(
      wx + (cell * cols) / 2,
      0.02,
      wz + (cell * rows) / 2,
    );
    cellHighlight.visible = true;
  };

  const selectCell = (col: number, row: number) => {
    selectedCell = { col, row };
    placeCellHighlight();
    renderGridPanel();
  };

  const roomAtCell = (col: number, row: number) => {
    const match = (
      list: OfficeInstance[] | undefined,
      kind: "office" | "cubicle" | "conference" | "recreation" | "library",
      root: THREE.Group,
    ) => {
      const instance = list?.find((item) => {
        const w = item.cols ?? 1;
        const h = item.rows ?? 1;
        return col >= item.col && col < item.col + w && row >= item.row && row < item.row + h;
      });
      return instance ? { instance, kind, root } : null;
    };
    return (
      match(plate.offices, "office", officesRoot) ??
      match(plate.cubicles, "cubicle", cubiclesRoot) ??
      match(plate.conferences, "conference", conferencesRoot) ??
      match(plate.recreations, "recreation", recreationsRoot) ??
      match(plate.libraries, "library", librariesRoot)
    );
  };

  const rotateSelectedRoom = (delta: number) => {
    if (!selectedCell) return;
    const room = roomAtCell(selectedCell.col, selectedCell.row);
    if (!room) return;
    pushUndo();
    room.instance.rot = (((room.instance.rot + delta) % 360) + 360) % 360;
    const group = room.root.getObjectByName(room.instance.id);
    if (group) group.rotation.y = ROOM_ROT_Y[room.instance.rot] ?? 0;
    renderGridPanel();
  };

  const pickTile = () => {
    const tiles = ground.getObjectByName("tiles");
    if (!tiles) return null;
    raycaster.setFromCamera(pointer, camera);
    const hits = raycaster.intersectObjects(tiles.children, false);
    return hits[0]?.object ?? null;
  };

  const applyPaintAtPointer = () => {
    if (!paintKind) return;
    const tile = pickTile();
    if (!tile) return;
    const { col, row } = tile.userData as { col: number; row: number };
    selectCell(col, row);
    paintCell(plate, col, row, paintKind);
    const mat = (tile as THREE.Mesh).material as THREE.MeshStandardMaterial;
    mat.color.setHex(TILE[paintKind]);
    tile.userData.kind = paintKind;
    syncTemplatedCells(
      officesRoot,
      plate,
      plate.offices ?? [],
      plate.officeTemplate,
      "office",
    );
    syncTemplatedCells(
      cubiclesRoot,
      plate,
      plate.cubicles ?? [],
      plate.cubicleTemplate,
      "cubicle",
    );
    syncTemplatedCells(
      conferencesRoot,
      plate,
      plate.conferences ?? [],
      plate.conferenceTemplate,
      "conference",
    );
    syncTemplatedCells(
      recreationsRoot,
      plate,
      plate.recreations ?? [],
      plate.recreationTemplate,
      "recreation",
    );
    syncTemplatedCells(
      librariesRoot,
      plate,
      plate.libraries ?? [],
      plate.libraryTemplate,
      "library",
    );
  };

  const setPaintKind = (kind: CellKind | null) => {
    paintKind = kind;
    controls.enabled = !kind && tool === "orbit" && !dragging && !gizmo.dragging;
    renderGridPanel();
    toolHud.innerHTML = kind
      ? `<b>paint ${kind}</b> · click tiles · Esc to stop`
      : `<b>${tool}</b> · Tab PRS · ⌃Z undo · ⌃S save · ⌃C/V copy · Del delete`;
  };

  const renderGridPanel = () => {
    const brushes = PAINT_KINDS.map(({ kind, label }) => {
      const active = paintKind === kind ? " active" : "";
      const color = `#${TILE[kind].toString(16).padStart(6, "0")}`;
      return `<button type="button" class="paint${active}" data-kind="${kind}">
        <span class="chip" style="background:${color}"></span>${label}
      </button>`;
    }).join("");
    const cellKind = selectedCell
      ? kindAt(plate, selectedCell.col, selectedCell.row)
      : null;
    const room = selectedCell
      ? roomAtCell(selectedCell.col, selectedCell.row)
      : null;
    const span = room
      ? `${room.instance.cols ?? 1}×${room.instance.rows ?? 1}`
      : "";
    const cellLabel = selectedCell
      ? `cell (${selectedCell.col}, ${selectedCell.row}) · ${cellKind ?? "empty"}${span ? ` ${span}` : ""}`
      : "click a cell, then + row / + col / rotate";
    const rotRow = room
      ? `<div class="grid-ops">
          <button type="button" data-op="rot-ccw">↺ parent</button>
          <button type="button" data-op="rot-cw">↻ parent</button>
        </div>
        <div class="hint">room rot ${room.instance.rot}° · [ ] or Q/E</div>
        <label class="row toggle"><input id="grid-sync-siblings" type="checkbox"${syncSiblings ? " checked" : ""}>move all children</label>
        <label class="row toggle"><input id="grid-paste-siblings" type="checkbox"${pasteSiblings ? " checked" : ""}>paste all children</label>
        <label class="row toggle"><input id="grid-delete-siblings" type="checkbox"${deleteSiblings ? " checked" : ""}>delete all children</label>
        <div class="hint">drop a model into this ${room.kind} to add it everywhere</div>`
      : selectedCell
        ? `<div class="hint">no room parent to rotate</div>`
        : "";
    gridPanel.innerHTML = `
      <div class="hint">${cellLabel}</div>
      <div class="grid-ops">
        <button type="button" data-op="add-row">+ row</button>
        <button type="button" data-op="add-col">+ col</button>
        <button type="button" data-op="del-row">− row</button>
        <button type="button" data-op="del-col">− col</button>
      </div>
      ${rotRow}
      <div class="paint-list">${brushes}</div>
    `;
    gridPanel.querySelectorAll<HTMLButtonElement>("[data-op]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const op = btn.dataset.op;
        if (op === "add-row" || op === "add-col" || op === "del-row" || op === "del-col") {
          pushUndo();
        }
        if (op === "add-row") addRow(plate, selectedCell?.row);
        else if (op === "add-col") addCol(plate, selectedCell?.col);
        else if (op === "del-row") removeRow(plate, selectedCell?.row);
        else if (op === "del-col") removeCol(plate, selectedCell?.col);
        else if (op === "rot-ccw") {
          rotateSelectedRoom(-90);
          return;
        } else if (op === "rot-cw") {
          rotateSelectedRoom(90);
          return;
        }
        if (selectedCell) {
          selectedCell.col = Math.min(selectedCell.col, plate.grid.cols - 1);
          selectedCell.row = Math.min(selectedCell.row, plate.grid.rows - 1);
        }
        relayout();
        renderGridPanel();
      });
    });
    gridPanel.querySelectorAll<HTMLButtonElement>(".paint").forEach((btn) => {
      btn.addEventListener("click", () => {
        const kind = btn.dataset.kind as CellKind;
        setPaintKind(paintKind === kind ? null : kind);
      });
    });
    gridPanel.querySelector("#grid-sync-siblings")?.addEventListener("change", (event) => {
      syncSiblings = (event.target as HTMLInputElement).checked;
    });
    gridPanel.querySelector("#grid-paste-siblings")?.addEventListener("change", (event) => {
      pasteSiblings = (event.target as HTMLInputElement).checked;
    });
    gridPanel.querySelector("#grid-delete-siblings")?.addEventListener("change", (event) => {
      deleteSiblings = (event.target as HTMLInputElement).checked;
    });
  };

  const setTool = (next: Tool) => {
    tool = next;
    if (next !== "orbit") setPaintKind(null);
    controls.enabled = !paintKind && tool === "orbit" && !dragging && !gizmo.dragging;
    attachGizmo();
    if (!paintKind) {
      toolHud.innerHTML = `<b>${tool}</b> · Tab PRS · ⌃Z undo · ⌃S save · ⌃C/V copy · Del delete`;
    }
  };

  const selectObject = (obj: Editable | null) => {
    selected = obj;
    dragging = false;
    attachGizmo();
    if (selected) box.setFromObject(selected);
    box.visible = Boolean(selected);
    renderInspector();
    highlightList();
  };

  const renderInspector = () => {
    if (!selected) {
      panel.innerHTML = `<div class="hint">Drag a model from Models into the scene.<br/>Click to select · Tab for PRS gizmos</div>`;
      box.visible = false;
      return;
    }
    const avatar = selected.userData.avatar;
    if (avatar) {
      const item = selected.userData.item;
      const json = JSON.stringify(
        {
          id: avatar.id,
          pose: avatar.pose,
          x: round1(item.x),
          y: round1(item.y),
          facing: item.facing ?? 0,
        },
        null,
        2,
      );
      panel.innerHTML = `
        <div class="row"><b>player</b> <span class="muted">${avatar.id}</span></div>
        <div class="row muted">${avatar.pose}</div>
        <div class="row">x <input data-k="x" value="${round1(item.x)}"></div>
        <div class="row">y <input data-k="y" value="${round1(item.y)}"></div>
        <div class="row">facing <input data-k="facing" value="${item.facing ?? 0}"></div>
        <textarea id="copy-json" readonly>${json}</textarea>
        <button type="button" id="copy-btn">Copy JSON</button>
        <button type="button" id="pose-btn">Toggle sit / stand</button>
        <div class="hint">Q/E rotate · T sit/stand</div>
      `;
      bindInspectorInputs();
      panel.querySelector("#pose-btn")?.addEventListener("click", () => {
        if (!selected?.userData.avatar) return;
        pushUndo();
        setAvatarPose(selected, avatar.pose === "sit" ? "stand" : "sit");
        commit();
      });
      box.setFromObject(selected);
      box.visible = true;
      return;
    }
    const item = selected.userData.item;
    const kind = selected.userData.cellKind;
    const template: OfficeTemplate | undefined =
      kind === "cubicle" ? plate.cubicleTemplate : plate.officeTemplate;
    const json = JSON.stringify(
      {
        ...compactItem(item),
        local: Boolean(selected.userData.templateId),
      },
      null,
      2,
    );
    const allJson = template
      ? JSON.stringify(template.furniture.map(compactItem), null, 2)
      : JSON.stringify(
          plate.furniture.filter((entry) => plate.assets.types[entry.type]?.glb).map(compactItem),
          null,
          2,
        );
    const kindLabel = selected.userData.templateId
      ? kind === "cubicle"
        ? "cubicle template"
        : kind === "conference"
          ? "conference template"
          : kind === "library"
            ? "library template"
            : "office template"
      : "scene";
    const copyAllLabel = selected.userData.templateId
      ? "Copy all template JSON"
      : "Copy all scene JSON";
    panel.innerHTML = `
      <div class="row"><b>${prettyType(item.type)}</b> <span class="muted">${item.id ?? item._uid}</span></div>
      <div class="row muted">${kindLabel} · ${tool}</div>
      <div class="row">x <input data-k="x" value="${round1(item.x)}"></div>
      <div class="row">y <input data-k="y" value="${round1(item.y)}"></div>
      <div class="row">facing <input data-k="facing" value="${item.facing ?? 0}"></div>
      <div class="row">sx <input data-k="sx" value="${round2(item.sx ?? 1)}"></div>
      <div class="row">sy <input data-k="sy" value="${round2(item.sy ?? 1)}"></div>
      <div class="row">sz <input data-k="sz" value="${round2(item.sz ?? 1)}"></div>
      ${
        kind
          ? `<label class="row toggle"><input id="sync-siblings" type="checkbox"${syncSiblings ? " checked" : ""}>move all children</label>
      <label class="row toggle"><input id="paste-siblings" type="checkbox"${pasteSiblings ? " checked" : ""}>paste all children</label>
      <label class="row toggle"><input id="delete-siblings" type="checkbox"${deleteSiblings ? " checked" : ""}>delete all children</label>
      <div class="hint">move / paste / delete the same piece in every ${kind}</div>`
          : ""
      }
      <textarea id="copy-json" readonly>${json}</textarea>
      <button type="button" id="copy-btn">Copy item JSON</button>
      <button type="button" id="copy-all-btn">${copyAllLabel}</button>
      <div class="hint">Tab PRS · ⌃C/V duplicate · Del remove scene items</div>
    `;
    bindInspectorInputs();
    panel.querySelector("#sync-siblings")?.addEventListener("change", (event) => {
      syncSiblings = (event.target as HTMLInputElement).checked;
    });
    panel.querySelector("#paste-siblings")?.addEventListener("change", (event) => {
      pasteSiblings = (event.target as HTMLInputElement).checked;
    });
    panel.querySelector("#delete-siblings")?.addEventListener("change", (event) => {
      deleteSiblings = (event.target as HTMLInputElement).checked;
    });
    panel.querySelector("#copy-all-btn")?.addEventListener("click", () => {
      void navigator.clipboard.writeText(allJson);
    });
    box.setFromObject(selected);
    box.visible = true;
  };

  const bindInspectorInputs = () => {
    panel.querySelectorAll("input").forEach((input) => {
      if (
        input.id === "sync-siblings" ||
        input.id === "paste-siblings" ||
        input.id === "delete-siblings"
      ) {
        return;
      }
      input.addEventListener("change", () => {
        const key = input.dataset.k as "x" | "y" | "facing" | "sx" | "sy" | "sz";
        const value = Number(input.value);
        if (!Number.isFinite(value) || !selected) return;
        pushUndo();
        if (key === "facing" || key === "sx" || key === "sy" || key === "sz") {
          selected.userData.item[key] = value;
        } else {
          selected.userData.item[key] = value;
        }
        commit();
      });
    });
    panel.querySelector("#copy-btn")?.addEventListener("click", () => {
      const text = (panel.querySelector("#copy-json") as HTMLTextAreaElement).value;
      void navigator.clipboard.writeText(text);
    });
  };

  const looseItems = () =>
    looseRoot.children.filter(
      (node) => node.userData?.editable && node.userData.item && !node.userData.templateId,
    ) as Editable[];

  const highlightList = () => {
    const id = selected?.userData.item?._uid;
    sceneList.querySelectorAll("[data-uid]").forEach((row) => {
      row.classList.toggle("active", row.getAttribute("data-uid") === id);
    });
  };

  const renderSceneList = () => {
    const rows = looseItems();
    if (rows.length === 0) {
      sceneList.innerHTML = `<div class="hint">No scene items yet. Drop a model to start.</div>`;
      return;
    }
    sceneList.innerHTML = rows
      .map((node) => {
        const item = node.userData.item;
        return `<div class="list-row" data-uid="${item._uid}">
          <button type="button" class="list-pick">${prettyType(item.type)}</button>
          <button type="button" class="list-x" title="Delete">×</button>
        </div>`;
      })
      .join("");
    sceneList.querySelectorAll<HTMLElement>(".list-row").forEach((row) => {
      const uid = row.dataset.uid;
      const node = rows.find((entry) => entry.userData.item._uid === uid);
      row.querySelector(".list-pick")?.addEventListener("click", () => {
        if (node) selectObject(node);
      });
      row.querySelector(".list-x")?.addEventListener("click", (event) => {
        event.stopPropagation();
        if (node) deleteLoose(node);
      });
    });
    highlightList();
  };

  let paletteFilter = "";
  const renderPalette = () => {
    const types = Object.entries(plate.assets.types)
      .filter(([type, spec]) => {
        if (type === "wall" || type === "door" || type === "window") return false;
        if (!spec.glb && !spec.procedural) return false;
        const q = paletteFilter.trim().toLowerCase();
        if (!q) return true;
        return type.replace(/_/g, " ").includes(q) || type.includes(q);
      })
      .map(([type]) => type);
    const groups = groupedTypes(types);
    palette.innerHTML = `<input class="palette-filter" type="search" placeholder="search ${Object.keys(plate.assets.types).length} models" value="${paletteFilter.replace(/"/g, "&quot;")}" />${groups
      .map((group) => {
        const swatches = group.types
          .map((type) => {
            const color = FURNITURE_TINT[type] ?? GROUP_SWATCH[catalogGroup(type)] ?? "#6a6578";
            return `<div class="swatch" draggable="true" data-type="${type}">
          <span class="chip" style="background:${color}"></span>
          ${prettyType(type)}
        </div>`;
          })
          .join("");
        return `<div class="palette-group"><div class="palette-label">${group.label}</div>${swatches}</div>`;
      })
      .join("")}`;
    const filter = palette.querySelector<HTMLInputElement>(".palette-filter");
    filter?.addEventListener("input", () => {
      paletteFilter = filter.value;
      const start = filter.selectionStart;
      renderPalette();
      const next = palette.querySelector<HTMLInputElement>(".palette-filter");
      if (next) {
        next.focus();
        if (start !== null) next.setSelectionRange(start, start);
      }
    });
    palette.querySelectorAll<HTMLElement>(".swatch").forEach((btn) => {
      btn.addEventListener("dragstart", (event) => {
        const type = btn.dataset.type ?? "";
        event.dataTransfer?.setData("text/plain", type);
        event.dataTransfer?.setData("application/x-furniture", type);
        if (event.dataTransfer) event.dataTransfer.effectAllowed = "copy";
      });
    });
  };

  const doorFrameMat = new THREE.MeshStandardMaterial({
    color: 0x4a3421,
    roughness: 0.88,
  });
  const doorLeafMat = new THREE.MeshStandardMaterial({
    color: 0x7c5330,
    roughness: 0.74,
  });

  const spawnIntoRoom = async (
    item: FurnitureItem,
    parent: THREE.Object3D,
    inst: OfficeInstance,
    kind: NonNullable<Editable["userData"]["cellKind"]>,
  ) => {
    const rlp = localPlateFor(plate, inst.cols ?? 1, inst.rows ?? 1);
    let mesh: THREE.Object3D | null = null;
    if (item.type === "door") {
      mesh = createHingedDoor(item, rlp, doorFrameMat, doorLeafMat);
      mesh.userData = {
        item,
        editable: true,
        isDoor: true,
        cellKind: kind,
        officeId: inst.id,
      };
    } else {
      mesh = await spawnFurniture(item.type, item, rlp);
      if (!mesh) return null;
      mesh.userData.item = item;
      mesh.userData.editable = true;
      mesh.userData.cellKind = kind;
      mesh.userData.officeId = inst.id;
    }
    parent.add(mesh);
    inst.furniture = inst.furniture ?? [];
    inst.furniture.push(item);
    return mesh;
  };

  const dropTypeAt = async (type: string, world: THREE.Vector3) => {
    const spec = plate.assets.types[type];
    if (!spec?.glb && !spec?.procedural) return;
    pushUndo();
    const fp = spec.footprint ?? [40, 40];
    const room =
      selectedCell ? roomAtCell(selectedCell.col, selectedCell.row) : null;
    const parent = room ? room.root.getObjectByName(room.instance.id) : null;
    if (room && parent) {
      const local = localFromWorld(parent, world);
      const item: FurnitureItem = {
        _uid: nextUid(type),
        type,
        x: round1(local.x - (fp[0] ?? 40) / 2),
        y: round1(local.y - (fp[1] ?? 40) / 2),
        w: fp[0],
        h: fp[1],
        facing: 0,
        sx: 1,
        sy: 1,
        sz: 1,
      };
      const mesh = await spawnIntoRoom(item, parent, room.instance, room.kind);
      await replicatePaste(item, room.instance, room.kind);
      if (mesh) selectObject(asEditable(mesh));
      return;
    }
    const canvasPt = fromWorld(world.x, world.z, plate);
    const item: FurnitureItem = {
      _uid: nextUid(type),
      type,
      x: round1(canvasPt.x - (fp[0] ?? 40) / 2),
      y: round1(canvasPt.y - (fp[1] ?? 40) / 2),
      w: fp[0],
      h: fp[1],
      facing: 0,
      sx: 1,
      sy: 1,
      sz: 1,
    };
    const group = await spawnFurniture(type, item, plate);
    if (!group) return;
    plate.furniture.push(item);
    looseRoot.add(group);
    selectObject(asEditable(group));
    renderSceneList();
  };

  const duplicateSelected = async () => {
    if (!selected || selected.userData.avatar) return;
    pushUndo();
    const src = selected.userData.item;
    const item: FurnitureItem = {
      ...src,
      _uid: nextUid(src.type),
      id: undefined,
      x: round1(src.x + 16),
      y: round1(src.y + 16),
    };
    const parent = cellGroupOf(selected);
    const inst = roomInstanceOf(selected);
    const kind = selected.userData.cellKind;
    if (parent && inst && kind) {
      const mesh = await spawnIntoRoom(item, parent, inst, kind);
      await replicatePaste(item, inst, kind);
      if (mesh) selectObject(asEditable(mesh));
      return;
    }
    const world = new THREE.Vector3();
    selected.getWorldPosition(world);
    const canvasPt = fromWorld(world.x, world.z, plate);
    item.x = round1(canvasPt.x + 16);
    item.y = round1(canvasPt.y + 16);
    const group = await spawnFurniture(item.type, item, plate);
    if (!group) return;
    plate.furniture.push(item);
    looseRoot.add(group);
    selectObject(asEditable(group));
    renderSceneList();
  };

  const deleteLoose = (node: Editable) => {
    if (node.userData.avatar) return;
    pushUndo();
    const inst = roomInstanceOf(node);
    const parent = cellGroupOf(node);
    if (inst) {
      replicateDelete(node);
      const uid = node.userData.item._uid;
      inst.furniture = (inst.furniture ?? []).filter((entry) => entry._uid !== uid);
      node.parent?.remove(node);
      if ((node.userData.isDoor || node.userData.item.type === "door") && parent) {
        rebuildConferenceShell(parent, inst, plate);
      }
    } else {
      if (node.userData.templateId) return;
      const uid = node.userData.item._uid;
      plate.furniture = plate.furniture.filter((entry) => entry._uid !== uid);
      node.parent?.remove(node);
    }
    if (selected === node) {
      gizmo.detach();
      selectObject(null);
    }
    renderSceneList();
    renderInspector();
  };

  gizmo.addEventListener("dragging-changed", (event) => {
    const draggingGizmo = Boolean((event as { value?: boolean }).value);
    controls.enabled = tool === "orbit" && !draggingGizmo;
    if (draggingGizmo) pushUndo();
    if (!draggingGizmo) {
      writeGizmoToItem();
      commit();
    }
  });
  gizmo.addEventListener("objectChange", () => {
    writeGizmoToItem();
    if (selected && syncSiblings) applySyncSiblings(selected);
    if (selected) box.setFromObject(selected);
  });

  canvas.addEventListener("pointerdown", (event) => {
    if (!editing) return;
    if (event.button !== 0) return;
    if (gizmo.axis) return;
    setPointer(event);
    if (paintKind) {
      paintingGrid = true;
      pushUndo();
      applyPaintAtPointer();
      controls.enabled = false;
      canvas.setPointerCapture(event.pointerId);
      return;
    }
    const picked = pickEditable();
    if (!picked) {
      selectObject(null);
      const tile = pickTile();
      if (tile) {
        const { col, row } = tile.userData as { col: number; row: number };
        selectCell(col, row);
      }
      return;
    }
    selectObject(picked);
    const room = cellGroupOf(picked);
    const inst =
      room?.userData?.office ??
      room?.userData?.cubicle ??
      room?.userData?.conference ??
      room?.userData?.recreation ??
      room?.userData?.library;
    if (inst && typeof inst.col === "number" && typeof inst.row === "number") {
      selectCell(inst.col, inst.row);
    }
    if (tool !== "orbit") return;
    const world = groundAtPointer();
    const cellGroup = cellGroupOf(selected);
    if (world && cellGroup && selected && usesLocal(selected)) {
      const local = localFromWorld(cellGroup, world);
      dragOffset.x = selected.userData.item.x - local.x;
      dragOffset.y = selected.userData.item.y - local.y;
    } else if (world && selected) {
      const canvasPt = fromWorld(world.x, world.z, plate);
      dragOffset.x = selected.userData.item.x - canvasPt.x;
      dragOffset.y = selected.userData.item.y - canvasPt.y;
    }
    dragging = true;
    controls.enabled = false;
    canvas.setPointerCapture(event.pointerId);
  });

  canvas.addEventListener("pointermove", (event) => {
    if (!editing) return;
    if (paintingGrid && paintKind) {
      setPointer(event);
      applyPaintAtPointer();
      return;
    }
    if (!dragging || !selected || tool !== "orbit") return;
    if (!strokeUndo) {
      pushUndo();
      strokeUndo = true;
    }
    setPointer(event);
    const world = groundAtPointer();
    if (!world) return;
    const cellGroup = cellGroupOf(selected);
    if (cellGroup && usesLocal(selected)) {
      const local = localFromWorld(cellGroup, world);
      selected.userData.item.x = round1(local.x + dragOffset.x);
      selected.userData.item.y = round1(local.y + dragOffset.y);
    } else {
      const canvasPt = fromWorld(world.x, world.z, plate);
      selected.userData.item.x = round1(canvasPt.x + dragOffset.x);
      selected.userData.item.y = round1(canvasPt.y + dragOffset.y);
    }
    commit();
  });

  const stopDrag = (event: PointerEvent) => {
    if (paintingGrid) {
      paintingGrid = false;
      controls.enabled = !paintKind && tool === "orbit";
      try {
        canvas.releasePointerCapture(event.pointerId);
      } catch {
        /* already released */
      }
      return;
    }
    if (!dragging) return;
    dragging = false;
    strokeUndo = false;
    controls.enabled = !paintKind && tool === "orbit";
    try {
      canvas.releasePointerCapture(event.pointerId);
    } catch {
      /* already released */
    }
  };
  canvas.addEventListener("pointerup", stopDrag);
  canvas.addEventListener("pointercancel", stopDrag);

  const dropOnCanvas = (event: DragEvent) => {
    if (!editing) return;
    event.preventDefault();
    const type =
      event.dataTransfer?.getData("application/x-furniture") ||
      event.dataTransfer?.getData("text/plain");
    const spec = type ? plate.assets.types[type] : undefined;
    if (!type || (!spec?.glb && !spec?.procedural)) return;
    setPointer(event as unknown as PointerEvent);
    const world = groundAtPointer() ?? new THREE.Vector3();
    void dropTypeAt(type, world);
  };
  canvas.addEventListener("dragover", (event) => {
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
  });
  canvas.addEventListener("drop", dropOnCanvas);

  const saveStatus = document.querySelector("#save-status");
  const plateJson = () => JSON.stringify(plate, null, 2) + "\n";

  const downloadJson = (json: string) => {
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "floor-plate.json";
    link.click();
    URL.revokeObjectURL(url);
  };

  const savePlate = async () => {
    const json = plateJson();
    if (saveStatus) saveStatus.textContent = "saving…";
    try {
      const res = await fetch("/__floor-plate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: json,
      });
      if (res.ok) {
        if (saveStatus) saveStatus.textContent = "saved data/floor-plate.json";
        return;
      }
    } catch {
      /* no save endpoint — download instead */
    }
    downloadJson(json);
    if (saveStatus) saveStatus.textContent = "downloaded floor-plate.json";
  };

  document.querySelector("#save-json")?.addEventListener("click", () => {
    void savePlate();
  });

  window.addEventListener("keydown", (event) => {
    if (!editing) return;
    const cmd = event.metaKey || event.ctrlKey;
    if (cmd && (event.key === "s" || event.key === "S")) {
      event.preventDefault();
      void savePlate();
      return;
    }
    if (cmd && (event.key === "z" || event.key === "Z")) {
      if (isTypingTarget(event.target)) return;
      event.preventDefault();
      if (event.shiftKey) void redo();
      else void undo();
      return;
    }
    if (cmd && (event.key === "y" || event.key === "Y")) {
      if (isTypingTarget(event.target)) return;
      event.preventDefault();
      void redo();
      return;
    }
    if (event.key === "Escape") {
      if (paintKind) {
        event.preventDefault();
        setPaintKind(null);
      }
      return;
    }
    if (event.key === "Tab") {
      if (isTypingTarget(event.target)) return;
      event.preventDefault();
      const idx = TOOLS.indexOf(tool);
      setTool(TOOLS[(idx + 1) % TOOLS.length]);
      return;
    }
    if (isTypingTarget(event.target)) return;
    if (cmd && (event.key === "c" || event.key === "C")) {
      if (!selected || selected.userData.avatar) return;
      clipboard = { ...selected.userData.item };
      void navigator.clipboard.writeText(
        JSON.stringify(compactItem(selected.userData.item), null, 2),
      );
      event.preventDefault();
      return;
    }
    if (cmd && (event.key === "v" || event.key === "V")) {
      event.preventDefault();
      void duplicateSelected();
      return;
    }
    if ((event.key === "Delete" || event.key === "Backspace") && selected) {
      event.preventDefault();
      deleteLoose(selected);
      return;
    }
    if (event.key === "[" || event.key === "]") {
      if (!selectedCell) return;
      event.preventDefault();
      rotateSelectedRoom(event.key === "]" ? 90 : -90);
      return;
    }
    if (!selected) {
      if ((event.key === "q" || event.key === "Q") && selectedCell) {
        event.preventDefault();
        rotateSelectedRoom(-90);
      } else if ((event.key === "e" || event.key === "E") && selectedCell) {
        event.preventDefault();
        rotateSelectedRoom(90);
      }
      return;
    }
    const item = selected.userData.item;
    const step = event.shiftKey ? 10 : 1;
    const rotate = event.key === "q" || event.key === "Q" || event.key === "e" || event.key === "E";
    const pose = (event.key === "t" || event.key === "T") && selected.userData.avatar;
    const nudge =
      event.shiftKey &&
      (event.key === "ArrowLeft" ||
        event.key === "ArrowRight" ||
        event.key === "ArrowUp" ||
        event.key === "ArrowDown");
    if (!rotate && !pose && !nudge) return;
    pushUndo();
    if (event.key === "q" || event.key === "Q") {
      item.facing = ((item.facing ?? 0) + 270) % 360;
    } else if (event.key === "e" || event.key === "E") {
      item.facing = ((item.facing ?? 0) + 90) % 360;
    } else if (event.key === "t" || event.key === "T") {
      const avatar = selected.userData.avatar;
      if (avatar) setAvatarPose(selected, avatar.pose === "sit" ? "stand" : "sit");
    } else if (event.key === "ArrowLeft") {
      item.x = round1(item.x - step);
    } else if (event.key === "ArrowRight") {
      item.x = round1(item.x + step);
    } else if (event.key === "ArrowUp") {
      item.y = round1(item.y - step);
    } else if (event.key === "ArrowDown") {
      item.y = round1(item.y + step);
    }
    event.preventDefault();
    commit();
  });

  const duplicateFromClipboard = async (src: FurnitureItem) => {
    pushUndo();
    const item: FurnitureItem = {
      ...src,
      _uid: nextUid(src.type),
      id: undefined,
      x: round1(src.x + 16),
      y: round1(src.y + 16),
    };
    const group = await spawnFurniture(item.type, item, plate);
    if (!group) return;
    plate.furniture.push(item);
    looseRoot.add(group);
    selectObject(asEditable(group));
    renderSceneList();
  };

  document.querySelector("#editor-dock")?.addEventListener(
    "wheel",
    (event) => event.stopPropagation(),
    { passive: true },
  );

  const accordions = Array.from(
    document.querySelectorAll<HTMLElement>("#editor-accordions .acc"),
  );
  accordions.forEach((item) => {
    item.querySelector(".acc-head")?.addEventListener("click", () => {
      const opening = !item.classList.contains("open");
      accordions.forEach((other) => other.classList.toggle("open", opening && other === item));
    });
  });

  renderPalette();
  renderSceneList();
  renderGridPanel();
  setTool("orbit");
  renderInspector();

  const setEnabled = (on: boolean) => {
    editing = on;
    if (!on) {
      paintingGrid = false;
      dragging = false;
      setPaintKind(null);
      setTool("orbit");
      selectObject(null);
      gizmo.detach();
      gizmo.enabled = false;
      box.visible = false;
      cellHighlight.visible = false;
      controls.enabled = true;
    } else {
      controls.enabled = tool === "orbit" && !dragging && !gizmo.dragging;
      attachGizmo();
    }
  };

  return {
    busy: () =>
      Boolean(
        editing && (paintKind || dragging || paintingGrid || gizmo.dragging || tool !== "orbit"),
      ),
    enabled: () => editing,
    setEnabled,
  };
}
