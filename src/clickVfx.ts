import * as THREE from "three";

type Burst = {
  ring: THREE.Mesh;
  fill: THREE.Mesh;
  age: number;
  life: number;
};

export function attachClickVfx(scene: THREE.Scene) {
  const root = new THREE.Group();
  root.name = "click-vfx";
  scene.add(root);
  const bursts: Burst[] = [];
  const ringGeo = new THREE.RingGeometry(0.12, 0.18, 28);
  const fillGeo = new THREE.CircleGeometry(0.1, 24);
  ringGeo.rotateX(-Math.PI / 2);
  fillGeo.rotateX(-Math.PI / 2);

  const spawn = (x: number, z: number) => {
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0xf4e4c1,
      transparent: true,
      opacity: 0.95,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const fillMat = new THREE.MeshBasicMaterial({
      color: 0xfff6dc,
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    const fill = new THREE.Mesh(fillGeo, fillMat);
    ring.position.set(x, 0.03, z);
    fill.position.set(x, 0.028, z);
    root.add(ring, fill);
    bursts.push({ ring, fill, age: 0, life: 0.42 });
  };

  return {
    spawn,
    update(dt: number) {
      for (let i = bursts.length - 1; i >= 0; i--) {
        const burst = bursts[i];
        burst.age += dt;
        const t = Math.min(1, burst.age / burst.life);
        const ease = 1 - (1 - t) * (1 - t);
        const s = 0.55 + ease * 1.8;
        burst.ring.scale.set(s, 1, s);
        burst.fill.scale.set(0.7 + ease * 1.1, 1, 0.7 + ease * 1.1);
        (burst.ring.material as THREE.MeshBasicMaterial).opacity = 0.95 * (1 - t);
        (burst.fill.material as THREE.MeshBasicMaterial).opacity = 0.5 * (1 - t) * (1 - t);
        if (t >= 1) {
          root.remove(burst.ring, burst.fill);
          (burst.ring.material as THREE.MeshBasicMaterial).dispose();
          (burst.fill.material as THREE.MeshBasicMaterial).dispose();
          bursts.splice(i, 1);
        }
      }
    },
  };
}
