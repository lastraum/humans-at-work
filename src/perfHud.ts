import type * as THREE from "three";

type NearStats = { on: number; wanted: number };

function heapMb() {
  const mem = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory;
  if (!mem) return null;
  return mem.usedJSHeapSize / (1024 * 1024);
}

export function attachPerfHud(opts: {
  el: HTMLElement;
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
}) {
  const { el, renderer, scene } = opts;
  let frames = 0;
  let stamp = performance.now();
  let fps = 0;
  let ms = 0;
  let t0 = 0;
  let lastPaint = 0;
  let lamps: NearStats = { on: 0, wanted: 0 };
  let ads: NearStats = { on: 0, wanted: 0 };
  let avatars = 0;

  const paint = () => {
    const info = renderer.info;
    let pointOn = 0;
    let pointAll = 0;
    scene.traverse((obj) => {
      const light = obj as THREE.Light & { isPointLight?: boolean };
      if (!light.isPointLight) return;
      pointAll += 1;
      if (light.visible) pointOn += 1;
    });
    const programs = info.programs?.length ?? 0;
    const heap = heapMb();
    const lines = [
      `${fps.toFixed(0)} fps  ${ms.toFixed(1)} ms`,
      `draw ${info.render.calls}  tris ${info.render.triangles}`,
      `pts ${pointOn}/${pointAll}  ads ${ads.on}/${ads.wanted}  want ${Math.max(lamps.wanted, ads.wanted)}`,
      `prog ${programs}  geo ${info.memory.geometries}  tex ${info.memory.textures}`,
      `avatars ${avatars}${heap != null ? `  heap ${heap.toFixed(0)}mb` : ""}`,
    ];
    el.textContent = lines.join("\n");
    el.classList.toggle("slow", fps < 50);
    el.classList.toggle("dead", fps < 28);
  };

  return {
    begin() {
      t0 = performance.now();
    },
    mark(next: { lamps?: NearStats; ads?: NearStats; avatars?: number }) {
      if (next.lamps) lamps = next.lamps;
      if (next.ads) ads = next.ads;
      if (next.avatars != null) avatars = next.avatars;
    },
    end() {
      const now = performance.now();
      ms = now - t0;
      frames += 1;
      if (now - stamp >= 400) {
        fps = (frames * 1000) / (now - stamp);
        frames = 0;
        stamp = now;
      }
      if (now - lastPaint < 250) return;
      lastPaint = now;
      paint();
    },
  };
}
