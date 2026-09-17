import * as THREE from "three";

const AD_NAME = "office-ad";
const MULLION = 0.04;
const OUTSET = 0.014;

function exteriorGlasses(group: THREE.Object3D): THREE.Mesh[] {
  const list: THREE.Mesh[] = [];
  group.traverse((node) => {
    if (!(node instanceof THREE.Mesh) || !node.userData?.windowGlass) return;
    if (node.userData.windowEdge !== "s") return;
    list.push(node);
  });
  const local = new THREE.Vector3();
  const scratch = new THREE.Vector3();
  list.sort((a, b) => {
    a.getWorldPosition(local);
    group.worldToLocal(local);
    const ax = local.x;
    b.getWorldPosition(scratch);
    group.worldToLocal(scratch);
    return ax - scratch.x;
  });
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
  const zOut = glassTh / 2 + OUTSET;
  if (split) {
    const paneW = Math.max((glassW - MULLION) / 2, 0.06);
    const offset = paneW / 2 + MULLION / 2;
    if (alongX) {
      addPane(root, mat, paneW, glassH, -offset, 0, zOut, 0, 0, 0.5);
      addPane(root, mat, paneW, glassH, offset, 0, zOut, 0, 0.5, 1);
    } else {
      addPane(root, mat, paneW, glassH, zOut, 0, -offset, Math.PI / 2, 0, 0.5);
      addPane(root, mat, paneW, glassH, zOut, 0, offset, Math.PI / 2, 0.5, 1);
    }
  } else if (alongX) {
    addPane(root, mat, glassW, glassH, 0, 0, zOut, 0, u0, u1);
  } else {
    addPane(root, mat, glassW, glassH, zOut, 0, 0, Math.PI / 2, u0, u1);
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
  const rightTwo = glasses.length >= 2 ? glasses.slice(-2) : glasses;
  const splitOne = rightTwo.length === 1;
  if (splitOne) {
    decorateGlass(rightTwo[0], adMaterial(tex), 0, 1, true);
    return;
  }
  const shared = adMaterial(tex);
  decorateGlass(rightTwo[0], shared, 0, 0.5, false);
  decorateGlass(rightTwo[1], shared, 0.5, 1, false);
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
  if (prev === url && group.getObjectByName(AD_NAME)) return;
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
