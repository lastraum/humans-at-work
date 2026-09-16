import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import {
  FURNITURE_SCALE,
  FURNITURE_TINT,
  FURNITURE_Y_OFFSET,
  SCALE,
  getItemSize,
  itemRotation,
  toWorld,
} from "./coords";
import type { FloorPlate, FurnitureItem } from "./types";

const loader = new GLTFLoader();
const cache = new Map<string, Promise<THREE.Group>>();

function loadGlb(url: string) {
  const hit = cache.get(url);
  if (hit) return hit;
  const pending = loader.loadAsync(url).then((gltf) => gltf.scene);
  cache.set(url, pending);
  return pending;
}

function tint(root: THREE.Object3D, type: string) {
  const hex = FURNITURE_TINT[type];
  if (!hex) return;
  const tintColor = new THREE.Color(hex);
  root.traverse((child) => {
    if (!(child as THREE.Mesh).isMesh) return;
    const mesh = child as THREE.Mesh;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    const mapped = mats.map((material) => {
      const next = (material as THREE.MeshStandardMaterial).clone();
      if ("color" in next) next.color.lerp(tintColor, 0.8);
      if ("roughness" in next) next.roughness = 0.65;
      if ("metalness" in next) next.metalness = 0.08;
      return next;
    });
    mesh.material = Array.isArray(mesh.material) ? mapped : mapped[0];
    mesh.castShadow = true;
    mesh.receiveShadow = true;
  });
}

export function applyItemTransform(
  group: THREE.Object3D,
  item: FurnitureItem,
  plate: FloorPlate,
) {
  const [wx, , wz] = toWorld(item.x, item.y, plate);
  const y = (FURNITURE_Y_OFFSET[item.type] ?? 0) + (item.elevation ?? 0);
  group.position.set(wx, y, wz);
  group.rotation.set(0, 0, 0);
  group.scale.set(1, 1, 1);
  const inner = group.children[0];
  if (inner) {
    inner.rotation.set(
      ((item.pitch ?? 0) * Math.PI) / 180,
      itemRotation(item),
      ((item.roll ?? 0) * Math.PI) / 180,
    );
    inner.scale.set(item.sx ?? 1, item.sy ?? 1, item.sz ?? 1);
  }
}

function mesh(
  geo: THREE.BufferGeometry,
  color: number,
  opts: { roughness?: number; metalness?: number; emissive?: number; emissiveIntensity?: number } = {},
) {
  const mat = new THREE.MeshStandardMaterial({
    color,
    roughness: opts.roughness ?? 0.6,
    metalness: opts.metalness ?? 0.08,
    emissive: opts.emissive ?? 0x000000,
    emissiveIntensity: opts.emissiveIntensity ?? 0,
  });
  const out = new THREE.Mesh(geo, mat);
  out.castShadow = true;
  out.receiveShadow = true;
  return out;
}

function createProcedural(type: string): THREE.Group {
  const root = new THREE.Group();
  if (type === "projection_screen") {
    const frame = mesh(new THREE.BoxGeometry(1.9, 1.12, 0.06), 0x1c1c22, { roughness: 0.55 });
    frame.position.y = 0.72;
    const panel = new THREE.Mesh(
      new THREE.PlaneGeometry(1.72, 0.96),
      new THREE.MeshStandardMaterial({
        color: 0xd8e8f4,
        emissive: 0x7aa0c4,
        emissiveIntensity: 0.45,
        roughness: 0.25,
      }),
    );
    panel.position.set(0, 0.72, 0.034);
    const stand = mesh(new THREE.BoxGeometry(0.12, 0.2, 0.12), 0x2a2a32, { roughness: 0.7 });
    stand.position.y = 0.1;
    root.add(frame, panel, stand);
  } else if (type === "whiteboard") {
    const board = mesh(new THREE.BoxGeometry(0.04, 0.92, 1.42), 0xf4f6fa, { roughness: 0.35 });
    board.position.y = 0.72;
    const frame = mesh(new THREE.BoxGeometry(0.05, 0.98, 1.48), 0x2a2c32, { roughness: 0.7 });
    frame.position.y = 0.72;
    const tray = mesh(new THREE.BoxGeometry(0.1, 0.03, 1.3), 0x3a3c44);
    tray.position.set(0.04, 0.24, 0);
    root.add(frame, board, tray);
  } else if (type === "beanbag") {
    const bag = mesh(new THREE.SphereGeometry(0.34, 18, 12), 0xc45a3a, { roughness: 0.9 });
    bag.scale.set(1, 0.62, 1);
    bag.position.y = 0.2;
    root.add(bag);
  } else if (type === "ping_pong") {
    const top = mesh(new THREE.BoxGeometry(1.98, 0.05, 1.08), 0x2e6b4a, { roughness: 0.45 });
    top.position.y = 0.76;
    const rail = mesh(new THREE.BoxGeometry(2.0, 0.03, 1.1), 0x1a1a1e);
    rail.position.y = 0.79;
    const net = mesh(new THREE.BoxGeometry(0.02, 0.16, 1.08), 0xf0f0f4, { roughness: 0.5 });
    net.position.y = 0.88;
    for (const [x, z] of [
      [-0.88, -0.46],
      [0.88, -0.46],
      [-0.88, 0.46],
      [0.88, 0.46],
    ] as const) {
      const leg = mesh(new THREE.BoxGeometry(0.06, 0.74, 0.06), 0x2a2a32);
      leg.position.set(x, 0.37, z);
      root.add(leg);
    }
    root.add(top, rail, net);
  } else if (type === "vending") {
    const body = mesh(new THREE.BoxGeometry(0.72, 1.46, 0.52), 0xc43a3a, { roughness: 0.45, metalness: 0.2 });
    body.position.y = 0.73;
    const glass = new THREE.Mesh(
      new THREE.BoxGeometry(0.5, 0.9, 0.04),
      new THREE.MeshStandardMaterial({
        color: 0x88c8e8,
        transparent: true,
        opacity: 0.35,
        roughness: 0.1,
        metalness: 0.2,
        depthWrite: false,
      }),
    );
    glass.position.set(0, 0.88, 0.26);
    const kick = mesh(new THREE.BoxGeometry(0.74, 0.16, 0.54), 0x222228, { roughness: 0.7 });
    kick.position.y = 0.08;
    const stripe = mesh(new THREE.BoxGeometry(0.74, 0.08, 0.54), 0xf0f0f4);
    stripe.position.y = 1.38;
    root.add(body, kick, stripe, glass);
  } else {
    const fallback = mesh(new THREE.BoxGeometry(0.5, 0.5, 0.5), 0x6a6578);
    fallback.position.y = 0.25;
    root.add(fallback);
  }
  return root;
}

function placeItem(item: FurnitureItem, plate: FloorPlate, mesh: THREE.Group) {
  const { width, height } = getItemSize(item, plate);
  const scale = FURNITURE_SCALE[item.type] ?? [1, 1, 1];
  const pivotX = width * SCALE * 0.5;
  const pivotZ = height * SCALE * 0.5;

  const group = new THREE.Group();
  group.userData.item = item;
  group.userData.editable = true;
  const inner = new THREE.Group();
  inner.name = "pivot";
  inner.position.set(pivotX, 0, pivotZ);
  mesh.position.set(-pivotX, 0, -pivotZ);
  mesh.scale.set(scale[0], scale[1], scale[2]);
  inner.add(mesh);
  group.add(inner);
  applyItemTransform(group, item, plate);
  return group;
}

export async function loadFurnitureFromItems(
  items: FurnitureItem[],
  plate: FloorPlate,
) {
  const root = new THREE.Group();
  const byType = new Map<string, FurnitureItem[]>();
  for (const item of items) {
    const spec = plate.assets.types[item.type];
    if (!spec?.glb && !spec?.procedural) continue;
    const list = byType.get(item.type) ?? [];
    list.push(item);
    byType.set(item.type, list);
  }

  await Promise.all(
    [...byType.entries()].map(async ([type, list]) => {
      const spec = plate.assets.types[type];
      if (spec?.procedural) {
        for (const item of list) root.add(placeItem(item, plate, createProcedural(type)));
        return;
      }
      if (!spec?.glb) return;
      const url = `${plate.assets.baseUrl}/${spec.glb}`;
      const template = await loadGlb(url);
      for (const item of list) {
        const clone = template.clone(true);
        tint(clone, type);
        root.add(placeItem(item, plate, clone));
      }
    }),
  );

  return root;
}

export async function loadFurniture(plate: FloorPlate) {
  const root = await loadFurnitureFromItems(plate.furniture, plate);
  root.name = "furniture";
  return root;
}

export async function spawnFurniture(
  type: string,
  item: FurnitureItem,
  plate: FloorPlate,
) {
  const spec = plate.assets.types[type];
  if (spec?.procedural) return placeItem(item, plate, createProcedural(type));
  if (!spec?.glb) return null;
  const template = await loadGlb(`${plate.assets.baseUrl}/${spec.glb}`);
  const clone = template.clone(true);
  tint(clone, type);
  return placeItem(item, plate, clone);
}
