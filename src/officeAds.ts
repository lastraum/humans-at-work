import * as THREE from "three";
import { SCALE } from "./coords";
import type { OfficeInstance } from "./types";

const AD_NAME = "office-ad";
const OUTSET = 0.055;
const COVER_W = 1.08;
const COVER_H = 1.24;
const _world = new THREE.Vector3();

function localX(group: THREE.Object3D, node: THREE.Object3D) {
  node.getWorldPosition(_world);
  group.worldToLocal(_world);
  return _world.x;
}

/** Back wall is opposite the door (template south). */
function backWallGlasses(group: THREE.Object3D): THREE.Mesh[] {
  const list: THREE.Mesh[] = [];
  group.traverse((node) => {
    if (!(node instanceof THREE.Mesh) || !node.userData?.windowGlass) return;
    if (node.userData.windowEdge !== "s") return;
    list.push(node);
  });
  list.sort((a, b) => localX(group, a) - localX(group, b));
  return list;
}

function disposeObject(node: THREE.Object3D, seen: Set<THREE.Texture>) {
  node.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.geometry?.dispose();
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const mat of mats) {
      if (!mat) continue;
      const std = mat as THREE.MeshStandardMaterial;
      for (const tex of [std.map, std.emissiveMap]) {
        if (tex && !seen.has(tex)) {
          seen.add(tex);
          tex.dispose();
        }
      }
      mat.dispose();
    }
  });
  node.parent?.remove(node);
}

export function clearOfficeAd(root: THREE.Object3D) {
  const doomed: THREE.Object3D[] = [];
  root.traverse((node) => {
    if (node.name === AD_NAME) doomed.push(node);
  });
  const seen = new Set<THREE.Texture>();
  for (const node of doomed) disposeObject(node, seen);
}

function adMaterial(tex: THREE.Texture) {
  return new THREE.MeshStandardMaterial({
    map: tex,
    emissive: 0xffffff,
    emissiveMap: tex,
    emissiveIntensity: 0.42,
    roughness: 0.48,
    metalness: 0.04,
    toneMapped: true,
    side: THREE.DoubleSide,
    depthWrite: true,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
}

function paneGeometry(w: number, h: number, u0: number, u1: number) {
  const geo = new THREE.PlaneGeometry(w, h);
  const uv = geo.attributes.uv;
  for (let i = 0; i < uv.count; i++) {
    const u = uv.getX(i);
    uv.setX(i, u0 + u * (u1 - u0));
  }
  uv.needsUpdate = true;
  return geo;
}

function addPane(
  parent: THREE.Object3D,
  mat: THREE.Material,
  w: number,
  h: number,
  x: number,
  y: number,
  z: number,
  rotY: number,
  u0: number,
  u1: number,
) {
  const mesh = new THREE.Mesh(paneGeometry(w, h, u0, u1), mat);
  mesh.position.set(x, y, z);
  mesh.rotation.y = rotY;
  mesh.name = "office-ad-pane";
  mesh.userData.officeAd = true;
  parent.add(mesh);
}

function decorateGlass(glass: THREE.Mesh, mat: THREE.MeshStandardMaterial) {
  const geo = glass.geometry as THREE.BoxGeometry;
  const params = geo.parameters;
  if (!params?.width || !params.height) return;
  const alongX = params.depth <= params.width;
  const glassW = (alongX ? params.width : params.depth) * COVER_W;
  const glassH = params.height * COVER_H;
  const glassTh = alongX ? params.depth : params.width;
  const root = new THREE.Group();
  root.name = AD_NAME;
  root.userData.officeAd = true;
  root.visible = false;
  const mag = glassTh / 2 + OUTSET;
  const edge = String(glass.userData.windowEdge ?? "s");
  const outward = edge === "n" || edge === "w" ? -1 : 1;
  const dir = -outward;
  if (alongX) {
    const z = dir * mag;
    const rotY = dir < 0 ? Math.PI : 0;
    addPane(root, mat, glassW, glassH, 0, 0, z, rotY, 0, 1);
  } else {
    const x = dir * mag;
    const rotY = dir < 0 ? -Math.PI / 2 : Math.PI / 2;
    addPane(root, mat, glassW, glassH, x, 0, 0, rotY, 0, 1);
  }
  glass.add(root);
}

function mountInteriorBackWall(group: THREE.Object3D, tex: THREE.Texture) {
  const inst = group.userData.office as OfficeInstance | undefined;
  const cell = Number(group.userData.cellSize) || 179;
  const cols = inst?.cols ?? 1;
  const rows = inst?.rows ?? 1;
  const worldW = cols * cell * SCALE;
  const worldD = rows * cell * SCALE;
  const wall = 8 * SCALE;
  const w = worldW * 0.78;
  const h = 1.28;
  const z = worldD / 2 - wall - 0.05;
  const mat = adMaterial(tex);
  const root = new THREE.Group();
  root.name = AD_NAME;
  root.userData.officeAd = true;
  root.visible = false;
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
  mesh.name = "office-ad-pane";
  mesh.userData.officeAd = true;
  mesh.position.set(0, 0.72, z);
  mesh.rotation.y = Math.PI;
  root.add(mesh);
  group.add(root);
}

function mountAd(group: THREE.Object3D, tex: THREE.Texture) {
  clearOfficeAd(group);
  const glasses = backWallGlasses(group);
  if (glasses.length) {
    const mat = adMaterial(tex);
    for (const pane of glasses) decorateGlass(pane, mat);
    return;
  }
  mountInteriorBackWall(group, tex);
}

function mountedOnTargets(group: THREE.Object3D, glasses: THREE.Mesh[]) {
  return glasses.some((glass) => Boolean(glass.getObjectByName(AD_NAME)));
}

const loader = new THREE.TextureLoader();
export const FILL_AD_PREFIX = "fill-ad:";

const adRay = new THREE.Raycaster();

export function pickOfficeAd(
  camera: THREE.Camera,
  pointer: THREE.Vector2,
  roots: THREE.Object3D[],
): { deskId: string } | null {
  adRay.setFromCamera(pointer, camera);
  const hits = adRay.intersectObjects(roots, true);
  for (const hit of hits) {
    let node: THREE.Object3D | null = hit.object;
    let sawAd = false;
    while (node) {
      if (node.userData?.officeAd || node.name === AD_NAME || node.name === "office-ad-pane") {
        sawAd = true;
      }
      const office = node.userData?.office as OfficeInstance | undefined;
      if (sawAd && office?.id) return { deskId: office.id };
      node = node.parent;
    }
  }
  return null;
}

export function setOfficeAdVisible(group: THREE.Object3D, visible: boolean) {
  group.traverse((node) => {
    if (node.name === AD_NAME) node.visible = visible;
  });
}

function hashHue(value: string) {
  let h = 0;
  for (let i = 0; i < value.length; i++) h = (h * 31 + value.charCodeAt(i)) >>> 0;
  return h % 360;
}

function makeFillAdTexture(url: string) {
  const id = url.slice(FILL_AD_PREFIX.length) || "office";
  const hue = hashHue(id);
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }
  const g = ctx.createLinearGradient(0, 0, 80, 512);
  g.addColorStop(0, `hsl(${hue} 58% 44%)`);
  g.addColorStop(1, `hsl(${(hue + 38) % 360} 48% 16%)`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 512, 512);
  ctx.fillStyle = "rgba(244,240,232,0.12)";
  ctx.fillRect(28, 28, 456, 456);
  ctx.fillStyle = "#f4f0e8";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = "700 28px ui-sans-serif, system-ui, sans-serif";
  ctx.fillText("HUMANS AT WORK", 256, 188);
  ctx.font = "700 64px ui-sans-serif, system-ui, sans-serif";
  ctx.fillText(id.replace(/^office_/, "").toUpperCase().slice(0, 8), 256, 268);
  ctx.font = "600 22px ui-sans-serif, system-ui, sans-serif";
  ctx.fillText("window ad", 256, 338);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  return tex;
}

export function applyOfficeAd(group: THREE.Object3D, url: string | null) {
  const prev = group.userData.officeAdUrl as string | undefined;
  if (!url) {
    group.userData.officeAdUrl = undefined;
    group.userData.officeAdGen = (Number(group.userData.officeAdGen) || 0) + 1;
    clearOfficeAd(group);
    return;
  }
  const targets = backWallGlasses(group);
  if (prev === url && group.getObjectByName(AD_NAME) && (!targets.length || mountedOnTargets(group, targets))) {
    return;
  }
  const gen = (Number(group.userData.officeAdGen) || 0) + 1;
  group.userData.officeAdGen = gen;
  group.userData.officeAdUrl = url;
  if (url.startsWith(FILL_AD_PREFIX)) {
    mountAd(group, makeFillAdTexture(url));
    return;
  }
  loader.load(
    url,
    (tex) => {
      if (group.userData.officeAdGen !== gen || group.userData.officeAdUrl !== url) {
        tex.dispose();
        return;
      }
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = 4;
      tex.needsUpdate = true;
      mountAd(group, tex);
    },
    undefined,
    () => {
      if (group.userData.officeAdGen !== gen) return;
      clearOfficeAd(group);
    },
  );
}
