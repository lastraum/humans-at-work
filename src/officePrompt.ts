import * as THREE from "three";
import type { Desk } from "./desks";

function canvasTexture(w: number, h: number, draw: (ctx: CanvasRenderingContext2D) => void) {
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (ctx) draw(ctx);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

const BUBBLE_W = 512;
const BUBBLE_H = 320;
const YES = { x: BUBBLE_W / 2 - 62, y: 198, r: 34 };
const NO = { x: BUBBLE_W / 2 + 62, y: 198, r: 34 };

function sprite(tex: THREE.CanvasTexture, w: number, h: number, name: string) {
  const mat = new THREE.SpriteMaterial({
    map: tex,
    transparent: true,
    depthTest: false,
    depthWrite: false,
  });
  const s = new THREE.Sprite(mat);
  s.name = name;
  s.scale.set(w, h, 1);
  s.center.set(0.5, 0);
  s.renderOrder = 30;
  return s;
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  if (typeof ctx.roundRect === "function") {
    ctx.roundRect(x, y, w, h, r);
    return;
  }
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function drawCheck(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number) {
  ctx.fillStyle = "#2f9e5f";
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "#1c5c36";
  ctx.lineWidth = 5;
  ctx.stroke();
  ctx.strokeStyle = "#fff";
  ctx.lineWidth = 7;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  ctx.moveTo(cx - r * 0.42, cy + r * 0.02);
  ctx.lineTo(cx - r * 0.12, cy + r * 0.38);
  ctx.lineTo(cx + r * 0.46, cy - r * 0.36);
  ctx.stroke();
}

function drawCross(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number) {
  ctx.fillStyle = "#d4544a";
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "#7a241c";
  ctx.lineWidth = 5;
  ctx.stroke();
  ctx.strokeStyle = "#fff";
  ctx.lineWidth = 7;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(cx - r * 0.34, cy - r * 0.34);
  ctx.lineTo(cx + r * 0.34, cy + r * 0.34);
  ctx.moveTo(cx + r * 0.34, cy - r * 0.34);
  ctx.lineTo(cx - r * 0.34, cy + r * 0.34);
  ctx.stroke();
}

function drawBubble(ctx: CanvasRenderingContext2D, title: string, subtitle: string) {
  const w = ctx.canvas.width;
  const h = ctx.canvas.height;
  ctx.clearRect(0, 0, w, h);
  const x = 28;
  const y = 18;
  const bw = w - 56;
  const bh = h - 70;
  ctx.fillStyle = "rgba(20, 14, 28, 0.22)";
  ctx.beginPath();
  roundRect(ctx, x + 6, y + 8, bw, bh, 28);
  ctx.fill();
  ctx.fillStyle = "#fbf6ea";
  ctx.beginPath();
  roundRect(ctx, x, y, bw, bh, 28);
  ctx.fill();
  ctx.strokeStyle = "#2a2218";
  ctx.lineWidth = 6;
  ctx.stroke();
  ctx.fillStyle = "#fbf6ea";
  ctx.beginPath();
  ctx.moveTo(w / 2 - 28, y + bh - 2);
  ctx.lineTo(w / 2, h - 14);
  ctx.lineTo(w / 2 + 28, y + bh - 2);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = "#2a2218";
  ctx.beginPath();
  ctx.moveTo(w / 2 - 26, y + bh);
  ctx.lineTo(w / 2, h - 14);
  ctx.lineTo(w / 2 + 26, y + bh);
  ctx.stroke();
  ctx.fillStyle = "#2a2218";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = "700 34px ui-sans-serif, system-ui, sans-serif";
  ctx.fillText(title, w / 2, y + 52);
  ctx.font = "500 20px ui-sans-serif, system-ui, sans-serif";
  ctx.fillStyle = "#6a5a48";
  ctx.fillText(subtitle, w / 2, y + 92);
  drawCheck(ctx, YES.x, YES.y, YES.r);
  drawCross(ctx, NO.x, NO.y, NO.r);
}

export type Seat = { x: number; y: number; facing: number };
export type PromptKind = "claim" | "leave" | "sit" | "knock" | "whisper" | null;
export type PromptPeer = { id: string; name: string };

export function attachOfficePrompt(scene: THREE.Scene) {
  const root = new THREE.Group();
  root.name = "office-prompt";
  root.visible = false;
  const bubble = sprite(
    canvasTexture(BUBBLE_W, BUBBLE_H, (ctx) =>
      drawBubble(ctx, "Claim this office?", "Move in and sit down"),
    ),
    2.45,
    1.52,
    "prompt-bubble",
  );
  bubble.position.y = 0.12;
  root.add(bubble);
  scene.add(root);

  let desk: Desk | null = null;
  let kind: PromptKind = null;
  let seat: Seat | null = null;
  let peer: PromptPeer | null = null;
  const raycaster = new THREE.Raycaster();

  const paintCopy = (title: string, subtitle: string) => {
    const map = (bubble.material as THREE.SpriteMaterial).map;
    if (!map) return;
    const canvas = map.image as HTMLCanvasElement;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    drawBubble(ctx, title, subtitle);
    map.needsUpdate = true;
  };

  return {
    get desk() {
      return desk;
    },
    get kind() {
      return kind;
    },
    get seat() {
      return seat;
    },
    get peer() {
      return peer;
    },
    show(next: Desk) {
      desk = next;
      seat = null;
      peer = null;
      kind = "claim";
      paintCopy("Claim this office?", "Move in and sit down");
      root.position.copy(next.group.position);
      root.position.y = 2.35;
      root.visible = true;
    },
    showKnock(next: Desk, x: number, z: number) {
      desk = next;
      seat = null;
      peer = null;
      kind = "knock";
      paintCopy("Knock?", "See if they're free");
      root.position.set(x, 2.05, z);
      root.visible = true;
    },
    showSit(next: Desk | null, nextSeat: Seat, x: number, z: number, furn = "couch") {
      desk = next;
      seat = nextSeat;
      peer = null;
      kind = "sit";
      const on =
        furn === "beanbag"
          ? "Sit on the beanbag"
          : furn === "couch" || furn.includes("sofa")
            ? "Sit on the couch"
            : "Take a chair";
      paintCopy("Have a seat?", on);
      root.position.set(x, 2.05, z);
      root.visible = true;
    },
    showLeave(x: number, z: number) {
      desk = null;
      seat = null;
      peer = null;
      kind = "leave";
      paintCopy("Done for the day?", "Clock out and free your office");
      root.position.set(x, 2.2, z);
      root.visible = true;
    },
    showWhisper(next: PromptPeer, x: number, z: number) {
      desk = null;
      seat = null;
      peer = next;
      kind = "whisper";
      paintCopy("Whisper?", next.name);
      root.position.set(x, 2.2, z);
      root.visible = true;
    },
    hide() {
      desk = null;
      seat = null;
      peer = null;
      kind = null;
      root.visible = false;
    },
    pick(camera: THREE.Camera, pointer: THREE.Vector2): "yes" | "no" | "bubble" | null {
      if (!root.visible) return null;
      raycaster.setFromCamera(pointer, camera);
      const hit = raycaster.intersectObject(bubble, false)[0];
      if (!hit?.uv) return null;
      const x = hit.uv.x * BUBBLE_W;
      const y = (1 - hit.uv.y) * BUBBLE_H;
      const inYes = (x - YES.x) ** 2 + (y - YES.y) ** 2 <= YES.r ** 2;
      const inNo = (x - NO.x) ** 2 + (y - NO.y) ** 2 <= NO.r ** 2;
      if (inYes) return "yes";
      if (inNo) return "no";
      return "bubble";
    },
  };
}
