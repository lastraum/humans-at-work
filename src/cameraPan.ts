import * as THREE from "three";

function panDir(key: string) {
  if (key === "w" || key === "W" || key === "ArrowUp") return "w";
  if (key === "s" || key === "S" || key === "ArrowDown") return "s";
  if (key === "a" || key === "A" || key === "ArrowLeft") return "a";
  if (key === "d" || key === "D" || key === "ArrowRight") return "d";
  return null;
}

function isTyping(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || target.isContentEditable;
}

export function attachCameraPan(opts: {
  camera: THREE.Camera;
  controls: { target: THREE.Vector3; update: () => void };
  pad: HTMLElement | null;
}) {
  const { camera, controls, pad } = opts;
  const held = new Set<string>();
  const look = new THREE.Vector3();
  const right = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  const offset = new THREE.Vector3();

  window.addEventListener("keydown", (event) => {
    if (isTyping(event.target)) return;
    if (event.shiftKey && event.key.startsWith("Arrow")) return;
    const dir = panDir(event.key);
    if (!dir) return;
    held.add(dir);
    event.preventDefault();
  });
  window.addEventListener("keyup", (event) => {
    const dir = panDir(event.key);
    if (dir) held.delete(dir);
  });

  if (pad) {
    pad.querySelectorAll<HTMLElement>("[data-cam]").forEach((btn) => {
      const dir = btn.dataset.cam ?? "";
      const on = (event: Event) => {
        event.preventDefault();
        held.add(dir);
      };
      const off = () => held.delete(dir);
      btn.addEventListener("pointerdown", on);
      btn.addEventListener("pointerup", off);
      btn.addEventListener("pointerleave", off);
      btn.addEventListener("pointercancel", off);
    });
  }

  return {
    update(dt: number) {
      if (!held.size) return;
      offset.copy(camera.position).sub(controls.target);
      look.set(-offset.x, 0, -offset.z);
      if (look.lengthSq() < 1e-6) look.set(0, 0, -1);
      look.normalize();
      right.crossVectors(look, up).normalize();
      const speed = 14 * dt;
      if (held.has("w")) controls.target.addScaledVector(look, speed);
      if (held.has("s")) controls.target.addScaledVector(look, -speed);
      if (held.has("d")) controls.target.addScaledVector(right, speed);
      if (held.has("a")) controls.target.addScaledVector(right, -speed);
      camera.position.copy(controls.target).add(offset);
    },
  };
}
