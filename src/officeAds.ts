import * as THREE from "three";

const AD_NAME = "office-ad";
const MULLION = 0.04;
const OUTSET = 0.014;
const _world = new THREE.Vector3();

function localX(group: THREE.Object3D, node: THREE.Object3D) {
  node.getWorldPosition(_world);
  group.worldToLocal(_world);
  return _world.x;
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

/**
 * Door wall is template north (`windowEdge === "n"`). From outside looking at
 * that wall (local +Z), right is −X — the panes to the right of the door.
 */
function exteriorGlasses(group: THREE.Object3D): THREE.Mesh[] {
  const door = officeDoor(group);
  const doorX = door ? localX(group, door) : Number.POSITIVE_INFINITY;
  const onDoorWall: THREE.Mesh[] = [];
  group.traverse((node) => {
    if (!(node instanceof THREE.Mesh) || !node.userData?.windowGlass) return;
    if (node.userData.windowEdge !== "n") return;
    onDoorWall.push(node);
  });
  const rightOfDoor = onDoorWall.filter((glass) => localX(group, glass) < doorX - 0.02);
  const list = rightOfDoor.length ? rightOfDoor : onDoorWall;
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
    side: THREE.FrontSide,
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

function decorateGlass(glass: THREE.Mesh, mat: THREE.MeshStandardMaterial, u0: number, u1: number, split: boolean) {
  const geo = glass.geometry as THREE.BoxGeometry;
  const params = geo.parameters;
  if (!params?.width || !params.height) return;
  const alongX = params.depth <= params.width;
  const glassW = alongX ? params.width : params.depth;
  const glassH = params.height;
  const glassTh = alongX ? params.depth : params.width;
  const root = new THREE.Group();
  root.name = AD_NAME;
  root.userData.officeAd = true;
  const mag = glassTh / 2 + OUTSET;
  const edge = String(glass.userData.windowEdge ?? "n");
  // North/west exteriors face −Z / −X; south/east face +Z / +X.
  const outward = edge === "n" || edge === "w" ? -1 : 1;
  if (split) {
    const paneW = Math.max((glassW - MULLION) / 2, 0.06);
    const offset = paneW / 2 + MULLION / 2;
    if (alongX) {
      const z = outward * mag;
      const rotY = outward < 0 ? Math.PI : 0;
      if (outward < 0) {
        addPane(root, mat, paneW, glassH, -offset, 0, z, rotY, 0.5, 1);
        addPane(root, mat, paneW, glassH, offset, 0, z, rotY, 0, 0.5);
      } else {
        addPane(root, mat, paneW, glassH, -offset, 0, z, rotY, 0, 0.5);
        addPane(root, mat, paneW, glassH, offset, 0, z, rotY, 0.5, 1);
      }
    } else {
      const x = outward * mag;
      const rotY = outward < 0 ? -Math.PI / 2 : Math.PI / 2;
      if (outward < 0) {
        addPane(root, mat, paneW, glassH, x, 0, -offset, rotY, 0.5, 1);
        addPane(root, mat, paneW, glassH, x, 0, offset, rotY, 0, 0.5);
      } else {
        addPane(root, mat, paneW, glassH, x, 0, -offset, rotY, 0, 0.5);
        addPane(root, mat, paneW, glassH, x, 0, offset, rotY, 0.5, 1);
      }
    }
  } else if (alongX) {
    const z = outward * mag;
    const rotY = outward < 0 ? Math.PI : 0;
    addPane(root, mat, glassW, glassH, 0, 0, z, rotY, u0, u1);
  } else {
    const x = outward * mag;
    const rotY = outward < 0 ? -Math.PI / 2 : Math.PI / 2;
    addPane(root, mat, glassW, glassH, x, 0, 0, rotY, u0, u1);
  }
  glass.add(root);
}

function mountAd(group: THREE.Object3D, tex: THREE.Texture) {
  const glasses = exteriorGlasses(group);
  if (!glasses.length) {
    tex.dispose();
    return;
  }
  clearOfficeAd(group);
  const rightTwo = glasses.length >= 2 ? glasses.slice(0, 2) : glasses;
  const splitOne = rightTwo.length === 1;
  if (splitOne) {
    decorateGlass(rightTwo[0], adMaterial(tex), 0, 1, true);
    return;
  }
  const shared = adMaterial(tex);
  // Lowest local X is rightmost from outside on the door wall.
  decorateGlass(rightTwo[0], shared, 0.5, 1, false);
  decorateGlass(rightTwo[1], shared, 0, 0.5, false);
}

function mountedOnTargets(group: THREE.Object3D, glasses: THREE.Mesh[]) {
  return glasses.some((glass) => Boolean(glass.getObjectByName(AD_NAME)));
}

const loader = new THREE.TextureLoader();

export function applyOfficeAd(group: THREE.Object3D, url: string | null) {
  const prev = group.userData.officeAdUrl as string | undefined;
  if (!url) {
    group.userData.officeAdUrl = undefined;
    group.userData.officeAdGen = (Number(group.userData.officeAdGen) || 0) + 1;
    clearOfficeAd(group);
    return;
  }
  const targets = exteriorGlasses(group);
  if (prev === url && group.getObjectByName(AD_NAME) && mountedOnTargets(group, targets)) return;
  const gen = (Number(group.userData.officeAdGen) || 0) + 1;
  group.userData.officeAdGen = gen;
  group.userData.officeAdUrl = url;
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
