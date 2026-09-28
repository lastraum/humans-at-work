import "./style.css";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import plateJson from "../data/floor-plate.json";
import { clampLook, resolveLook, sameLook, type AvatarLook } from "./avatarLook";
import { createAvatar, createAvatars, restyleAvatar, setAvatarName, setNameTagVisible, updateAvatars } from "./createAvatars";
import {
  createConferences,
  createCubicles,
  createLibraries,
  createOffices,
  createRecreations,
} from "./createOffice";
import { cameraPanBounds, createGround, createWallsAndDoors, setHingedDoorOpen } from "./createPlate";
import { attachCameraPan } from "./cameraPan";
import { applyConferencePlate, attachDesks, type Desk } from "./desks";
import { pickOfficeAd } from "./officeAds";
import { attachEditor } from "./editor";
import { fromWorld, toWorld } from "./coords";
import { FIRST_FLOOR, floorName } from "./floors";
import { elevatorSpawn, ensureGridDefaults, inElevator, sidewalkSpawn, spreadConferenceFurniture, syncGridDerived } from "./grid";
import {
  bindSessionWallet,
  fetchAuthConfig,
  fetchOfficeAd,
  loginWithGoogle,
  logoutAccount,
  readToken,
  restoreAccount,
  saveAccountName,
  saveAccountProfile,
  saveBlock,
  saveOfficeAd,
  startEmailCode,
  verifyEmailCode,
  type OfficeAdProfile,
} from "./auth";
import { dropSessionWallet, ensureGuestWallet, ensureSessionWallet } from "./dcl/guestWallet";
import { DCL_WORLD } from "./dcl/worldHandshake";
import { addBlocked, readBlocked, removeBlocked, writeBlocked } from "./blocks";
import { applyAccount, clearAccountEmail, ensureIdentity, saveIdentity, sanitizeName } from "./identity";
import { attachMac } from "./mac";
import { clampCompany, clampProfileUrl, type Privacy } from "./protocol";
import { loadFurniture } from "./loadFurniture";
import { attachClickVfx } from "./clickVfx";
import { attachOfficePrompt } from "./officePrompt";
import { attachPlayer } from "./player";
import { attachRemoteHumans } from "./remoteHumans";
import type { Pose } from "./protocol";
import { connectRoom } from "./roomClient";
import {
  attachConferenceReserve,
  activeTimeZone,
  canEnterConference,
  conferenceApproach,
  conferenceAtCell,
  conferenceCenter,
  conferenceNotice,
  nextBookingLabel,
  pickConferenceGroup,
  pickConferenceNotice,
  prettyRoom,
  shareTimezone,
} from "./conferenceReserve";
import { compressOfficeAd } from "./officeAdImage";
import type { ConferenceReservation, OfficeAd } from "./protocol";
import { playChatSound, playChime } from "./chatSounds";
import { connectWorldChat } from "./worldChat";
import { libraryAtCell, poseInQuietZone, setAmbientSilent } from "./quietZone";
import { GUEST_SHIFT_MS, XP_PER_MINUTE } from "./xp";
import type { Avatar, FloorPlate, OfficeInstance } from "./types";

document.body.classList.add("ready");

function postLook(body: { id?: string; retire?: string }) {
  void fetch("/__presence/look", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    keepalive: true,
  }).catch(() => undefined);
}

async function loadPlate(): Promise<FloorPlate> {
  const urls = [`/floor-plate.json?t=${Date.now()}`, `/__floor-plate?t=${Date.now()}`];
  for (const url of urls) {
    try {
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) continue;
      const data = (await res.json()) as FloorPlate;
      if (data?.grid && Array.isArray(data.cells)) return data;
    } catch {
      /* try next source */
    }
  }
  return plateJson as unknown as FloorPlate;
}

const canvas = document.querySelector<HTMLCanvasElement>("#c")!;
const status = document.querySelector("#status")!;
const hudXp = document.querySelector<HTMLElement>("#hud-xp")!;
const hudClock = document.querySelector<HTMLElement>("#hud-clock")!;
const peekEl = document.querySelector<HTMLElement>("#mac-peek")!;
const peekTitle = document.querySelector("#mac-peek-title")!;
const peekName = document.querySelector("#mac-peek-name")!;
const peekMeta = document.querySelector("#mac-peek-meta")!;
const personCard = document.querySelector<HTMLElement>("#person-card")!;
const personCardTitle = document.querySelector("#person-card-title")!;
const personCardName = document.querySelector("#person-card-name")!;
const personCardPhoto = document.querySelector<HTMLImageElement>("#person-card-photo")!;
const personCardCompany = document.querySelector<HTMLElement>("#person-card-company")!;
const personCardLink = document.querySelector<HTMLAnchorElement>("#person-card-link")!;
const personCardMeta = document.querySelector<HTMLElement>("#person-card-meta")!;
const personCardNote = document.querySelector<HTMLElement>("#person-card-note")!;
const personCardActions = document.querySelector<HTMLElement>("#person-card-actions")!;
const adVisit = document.querySelector<HTMLElement>("#ad-visit")!;
const adVisitName = document.querySelector("#ad-visit-name")!;
const adVisitCompany = document.querySelector<HTMLElement>("#ad-visit-company")!;
const adVisitHint = document.querySelector<HTMLElement>("#ad-visit-hint")!;
const adVisitGo = document.querySelector<HTMLButtonElement>("#ad-visit-go")!;
let inspectPerson: ((id: string, name: string) => void) | null = null;
let hidePersonCard: (() => void) | null = null;
let personNote: ((text: string) => void) | null = null;
const dayEnd = document.querySelector<HTMLElement>("#day-end")!;
const claimShift = document.querySelector<HTMLElement>("#claim-shift")!;
const claimShiftHello = document.querySelector("#claim-shift-hello")!;
const claimShiftDesk = document.querySelector("#claim-shift-desk")!;
const dayEndHello = document.querySelector("#day-end-hello")!;
const dayEndIn = document.querySelector("#day-end-in")!;
const dayEndTime = document.querySelector("#day-end-time")!;
const dayEndShiftXp = document.querySelector("#day-end-shift-xp")!;
const dayEndTotalXp = document.querySelector("#day-end-total-xp")!;
const dayEndDesk = document.querySelector("#day-end-desk")!;
const dayEndGo = document.querySelector<HTMLButtonElement>("#day-end-go")!;
const dayEndHome = document.querySelector<HTMLButtonElement>("#day-end-home")!;
const dayEndStay = document.querySelector<HTMLButtonElement>("#day-end-stay")!;
const dayEndOk = document.querySelector<HTMLButtonElement>("#day-end-ok")!;
const dayEndWell = document.querySelector<HTMLElement>("#day-end-well")!;
const dayEndCopy = document.querySelector("#day-end-copy")!;
const dayEndTitle = document.querySelector("#day-end-title")!;
const dayEndFloors = document.querySelector<HTMLElement>("#day-end-floors")!;
const floorReadout = document.querySelector<HTMLElement>("#floor-readout");
let dayEndMode: "ask" | "done" = "ask";
let askClockOut: (() => void) | null = null;
let goHome: (() => void) | null = null;
let rideFloor: ((floor: number) => void) | null = null;
let viewFloor = FIRST_FLOOR;
let maxFloor = FIRST_FLOOR;
let openFloors = [FIRST_FLOOR];
let pendingFloorRide: number | null = null;
let shiftStartedAt: number | null = null;
let shiftPausedMs: number | null = null;
let bankedXp = 0;
let clockShown = "";
let guestShiftHeld = false;
let guestVisitSpent = false;
let guestHoldPending = false;
let holdGuestShift: (() => void) | null = null;
const GUEST_SPENT_KEY = "haw-guest-spent";

function markGuestSpent() {
  guestVisitSpent = true;
  try {
    localStorage.setItem(GUEST_SPENT_KEY, "1");
  } catch {
    /* private mode */
  }
}

function clearGuestSpent() {
  guestVisitSpent = false;
  try {
    localStorage.removeItem(GUEST_SPENT_KEY);
  } catch {
    /* private mode */
  }
}

function readGuestSpent() {
  try {
    return localStorage.getItem(GUEST_SPENT_KEY) === "1";
  } catch {
    return false;
  }
}
let onGuestExpired: (() => void) | null = null;
const guestOver = document.querySelector<HTMLElement>("#guest-over")!;
const guestOverActions = document.querySelector<HTMLElement>("#guest-over-actions")!;
const guestOverAuth = document.querySelector<HTMLElement>("#guest-over-auth")!;

function shiftElapsedMs() {
  if (shiftPausedMs != null) return shiftPausedMs;
  if (shiftStartedAt == null) return 0;
  return Math.max(0, Date.now() - shiftStartedAt);
}

function formatClock(ms: number) {
  const sec = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  const ss = String(s).padStart(2, "0");
  if (h) return `${h}:${String(m).padStart(2, "0")}:${ss}`;
  return `${m}:${ss}`;
}

function paintYouHud() {
  hudXp.textContent = `${bankedXp.toLocaleString("en-US")} XP`;
  const label = formatClock(shiftElapsedMs());
  if (label === clockShown) return;
  clockShown = label;
  hudClock.textContent = label;
}

function pauseShiftClock() {
  if (shiftPausedMs != null) return;
  shiftPausedMs = shiftStartedAt == null ? 0 : Math.max(0, Date.now() - shiftStartedAt);
  shiftStartedAt = null;
  clockShown = "";
  paintYouHud();
}

function resumeShiftClock() {
  if (shiftPausedMs == null) return;
  shiftStartedAt = Date.now() - shiftPausedMs;
  shiftPausedMs = null;
  clockShown = "";
  paintYouHud();
}

function clearShiftClock() {
  shiftStartedAt = null;
  shiftPausedMs = null;
  clockShown = "";
  paintYouHud();
}

function dismissGuestOver() {
  guestShiftHeld = false;
  guestOver.hidden = true;
  guestOverAuth.hidden = true;
  guestOverActions.hidden = false;
}

function releaseGuestHold() {
  const wasHeld = guestShiftHeld || shiftPausedMs != null;
  dismissGuestOver();
  clearGuestSpent();
  if (wasHeld) resumeShiftClock();
}

function setHudXp(xp: number) {
  bankedXp = Math.max(0, Math.floor(Number(xp) || 0));
  paintYouHud();
}

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.18;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x8ec8e8);
scene.fog = new THREE.Fog(0xb8d8c8, 70, 220);

const aspect = () => canvas.clientWidth / Math.max(1, canvas.clientHeight);
const frustum = 36;
const camera = new THREE.OrthographicCamera(
  -frustum * aspect(),
  frustum * aspect(),
  frustum,
  -frustum,
  0.1,
  400,
);
camera.position.set(52, 58, 52);
camera.lookAt(0, 0, 0);

const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.target.set(0, 0, 0);
camera.zoom = 6;
controls.minZoom = 2.84;
controls.maxZoom = 14;
controls.zoomSpeed = 0.7;
controls.enablePan = true;
controls.enableRotate = true;
canvas.addEventListener("contextmenu", (event) => event.preventDefault());
const polar = Math.acos(58 / Math.hypot(52, 58, 52));
controls.minPolarAngle = polar;
controls.maxPolarAngle = polar;

const camOffset = new THREE.Vector3();
function centerCameraOn(wx: number, wz: number) {
  camOffset.copy(camera.position).sub(controls.target);
  controls.target.set(wx, 0, wz);
  camera.position.copy(controls.target).add(camOffset);
}

/** Place the camera on one side of the target. `w` looks from the hallway into east offices (door side). */
function lookFrom(dir: "w" | "e" | "s" | "n") {
  const h = 56;
  const d = 62;
  const iso = 34;
  if (dir === "w") camOffset.set(-d, h, iso);
  else if (dir === "e") camOffset.set(d, h, iso);
  else if (dir === "n") camOffset.set(iso, h, -d);
  else camOffset.set(iso, h, d);
  camera.position.copy(controls.target).add(camOffset);
  camera.lookAt(controls.target);
}

const filmParams = new URLSearchParams(location.search);
const shotName = (filmParams.get("shot") ?? "").trim().toLowerCase();
const filmQuery = filmParams.get("film");
const filmFollowName = (filmParams.get("follow") ?? "").trim();
const wantFilm = filmParams.has("film") || Boolean(shotName) || Boolean(filmFollowName);
const filmActor =
  wantFilm && (location.hostname === "127.0.0.1" || location.hostname === "localhost");
type FilmMode = "off" | "hide" | "chat" | "hud";
const filmOrder: FilmMode[] = ["off", "hide", "chat", "hud"];
let filmMode: FilmMode = "off";
let filmFollow = filmFollowName;

function isTypingTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || target.isContentEditable;
}

function setFilmMode(mode: FilmMode) {
  filmMode = mode;
  document.body.classList.toggle("film", mode === "hide" || mode === "chat" || mode === "hud");
  document.body.classList.toggle("film-chat", mode === "chat");
  document.body.classList.toggle("film-hud", mode === "hud");
}

if (wantFilm) setFilmMode(filmQuery === "chat" || shotName === "chat" ? "chat" : "hide");

window.addEventListener("keydown", (event) => {
  if (event.repeat || event.metaKey || event.ctrlKey || event.altKey) return;
  if (isTypingTarget(event.target)) return;
  if (event.key !== "h" && event.key !== "H") return;
  const next = filmOrder[(filmOrder.indexOf(filmMode) + 1) % filmOrder.length] ?? "off";
  setFilmMode(next);
  event.preventDefault();
});

const TEASER_SHOTS: Record<
  string,
  { x: number; y: number; zoom: number; film?: FilmMode; look?: "w" | "e" | "s" | "n" }
> = {
  elevator: { x: 448, y: 1214, zoom: 8 },
  kitchen: { x: 455, y: 1495, zoom: 8.6 },
  hall: { x: 300, y: 1580, zoom: 6.8 },
  rec: { x: 620, y: 2188, zoom: 8.3 },
  door: { x: 205, y: 1342, zoom: 9.2 },
  office: { x: 95, y: 1343, zoom: 10.2 },
  window: { x: 18, y: 1408, zoom: 8.4 },
  "lina-inside": { x: 95, y: 1343, zoom: 10.2, film: "chat" },
  "ash-inside": { x: 1288, y: 1343, zoom: 9.6, look: "w" },
  "ash-window": { x: 1288, y: 1343, zoom: 8.4, look: "w" },
  chat: { x: 455, y: 1495, zoom: 8.2, film: "chat" },
  whisper: { x: 455, y: 1495, zoom: 8.2, film: "chat" },
  focus: { x: 1288, y: 1343, zoom: 8.8, look: "w" },
  xp: { x: 360, y: 1520, zoom: 6.3, film: "hud" },
  clockout: { x: 448, y: 1214, zoom: 8 },
};

function applyTeaserShot(plate: FloorPlate, name = shotName) {
  const shot = TEASER_SHOTS[name] ?? (wantFilm && !name ? TEASER_SHOTS.kitchen : null);
  if (!shot) return;
  const [wx, , wz] = toWorld(shot.x, shot.y, plate);
  camera.zoom = shot.zoom;
  camera.updateProjectionMatrix();
  centerCameraOn(wx, wz);
  if (shot.look) lookFrom(shot.look);
  controls.update();
}

declare global {
  interface Window {
    hawShot?: (name: string) => void;
    hawFollow?: (name: string | null) => void;
    hawFilm?: (mode: FilmMode) => void;
    hawGo?: (x: number, y: number) => void;
    hawMoving?: () => boolean;
    hawOpenClaim?: (deskId: string) => void;
    hawMac?: (panel: string) => void;
    hawLook?: (dir: "w" | "e" | "s" | "n") => void;
  }
}

scene.add(new THREE.AmbientLight(0xfff4e8, 0.62));
const hemi = new THREE.HemisphereLight(0xe7f3ff, 0x6b8f4a, 0.82);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xfff6dd, 1.45);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -50;
sun.shadow.camera.right = 50;
sun.shadow.camera.top = 80;
sun.shadow.camera.bottom = -80;
sun.shadow.camera.far = 140;
sun.position.set(32, 48, -22);
scene.add(sun);

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
let playerCtl: {
  update: (dt: number) => void;
  pose: () => Pose;
  goSit: (seat: { x: number; y: number; facing: number; seatId?: string; seatY?: number }) => void;
  goTo: (x: number, y: number, force?: boolean) => boolean;
  stand: () => void;
  moving: () => boolean;
  setCellBlocked: (fn: ((col: number, row: number) => boolean) | null) => void;
} | null = null;
let camCtl: { update: (dt: number) => void; rotating?: () => boolean; clamp?: () => void } | null = null;
let clickVfx: { spawn: (x: number, z: number) => void; update: (dt: number) => void } | null =
  null;
let promptCtl: ReturnType<typeof attachOfficePrompt> | null = null;
let livePlate: FloorPlate | null = null;
let leaveArmed = false;
let pendingKnock: Desk | null = null;
let elevX = 0;
let elevZ = 0;
let clockOut: ((home?: boolean) => void) | null = null;
let macCtl: ReturnType<typeof attachMac> | null = null;
let worldChatCtl: ReturnType<typeof connectWorldChat> | null = null;
let remotesCtl: {
  update: (dt: number) => void;
  poses: () => {
    id: string;
    name: string;
    x: number;
    y: number;
    col?: number;
    row?: number;
    pose?: "sit" | "stand";
    seatId?: string;
  }[];
  avatars: () => { id: string; group: THREE.Object3D; col?: number; row?: number }[];
  moving: (id: string) => boolean;
  spawn: (peer: import("./protocol").Peer) => void;
  walkTo: (id: string, x: number, y: number) => void;
  walkToSit: (
    id: string,
    seat: { x: number; y: number; facing: number; seatId?: string; seatY?: number },
  ) => void;
  remove: (id: string) => void;
  clear: () => void;
  pick: (
    camera: THREE.Camera,
    pointer: THREE.Vector2,
  ) => { id: string; name: string; x: number; y: number; distance: number } | null;
} | null = null;
let desksCtl: ReturnType<typeof attachDesks> | null = null;
let syncConferencePresence:
  | ((you: { x: number; y: number; col?: number; row?: number }) => void)
  | null = null;
let confHoverLabel: ((col: number, row: number) => string | null) | null = null;
let selfId = "";
let selfName = "";
let selfSignedIn = false;
let blocked = new Set<string>();
let blockedBy = new Set<string>();
const chatAvailable = new Map<string, boolean>();
let lastTick = performance.now();
let lastFloorPaint = 0;
let lastQuiet = false;
let raf = 0;
let bgTick = 0;

canvas.addEventListener("pointermove", (event) => {
  const rect = canvas.getBoundingClientRect();
  pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
});

status.textContent = "loading plate…";

loadPlate()
  .then((loaded) => {
    const plate = loaded;
    ensureGridDefaults(plate);
    syncGridDerived(plate);
    spreadConferenceFurniture(plate);
    const ground = createGround(plate);
    scene.add(ground);
    const structure = createWallsAndDoors(plate);
    scene.add(structure);
    status.textContent = "loading furniture…";
    return Promise.all([
      Promise.resolve(plate),
      Promise.resolve(ground),
      Promise.resolve(structure),
      createOffices(plate),
      createCubicles(plate),
      createConferences(plate),
      createRecreations(plate),
      createLibraries(plate),
      loadFurniture(plate),
    ]);
  })
  .then(async ([plate, ground, structure, officesRoot, cubiclesRoot, conferencesRoot, recreationsRoot, librariesRoot, loose]) => {
    const avatarsRoot = createAvatars(plate, officesRoot);
    const editRoot = new THREE.Group();
    editRoot.add(officesRoot);
    editRoot.add(cubiclesRoot);
    editRoot.add(conferencesRoot);
    editRoot.add(recreationsRoot);
    editRoot.add(librariesRoot);
    editRoot.add(loose);
    editRoot.add(avatarsRoot);
    scene.add(editRoot);
    const n = plate.offices?.length ?? 0;
    const c = plate.cubicles?.length ?? 0;
    status.textContent = `${n} offices · ${c} cubicles · click a desk to check in`;
    const desks = attachDesks({
      plate,
      officesRoot,
      cubiclesRoot,
      recreationsRoot,
      librariesRoot,
      conferencesRoot,
      looseRoot: loose,
    });
    desksCtl = desks;
    const prompt = attachOfficePrompt(scene);
    promptCtl = prompt;
    clickVfx = attachClickVfx(scene);
    camCtl = attachCameraPan({
      camera,
      controls,
      pad: document.querySelector("#cam-pad"),
      getBounds: () => (livePlate ? cameraPanBounds(livePlate) : null),
    });

    const editor = attachEditor({
      camera,
      canvas,
      scene,
      controls,
      plate,
      furnitureRoot: editRoot,
      officesRoot,
      cubiclesRoot,
      conferencesRoot,
      recreationsRoot,
      librariesRoot,
      looseRoot: loose,
      avatarsRoot,
      ground,
      panel: document.querySelector("#inspector")!,
      palette: document.querySelector("#palette")!,
      sceneList: document.querySelector("#scene-list")!,
      gridPanel: document.querySelector("#grid-panel")!,
      toolHud: document.querySelector("#tool-hud")!,
    });
    editor.setEnabled(false);

    let session = filmActor ? null : await restoreAccount();
    if (!session) clearAccountEmail();
    const identity = session ? applyAccount(session.user) : ensureIdentity();
    if (filmActor) {
      identity.id = "bot-teaser-you";
      identity.name = "Ash";
      identity.email = undefined;
      identity.look = {
        gender: "m",
        skin: "#c68642",
        hair: "#2a2118",
        eyes: "#3d6cb5",
        shirt: "#80b918",
        pants: "#2c3340",
      };
      identity.color = identity.look.shirt;
    }
    postLook({ id: identity.id });
    let guest = session
      ? await ensureSessionWallet(session.token)
      : await ensureGuestWallet(identity.id);
    identity.address = guest.address;
    if (session && guest.address !== session.address) {
      void bindSessionWallet(guest.address);
    }
    const authConfig = await fetchAuthConfig();
    blocked = new Set(session?.blocked?.length ? session.blocked : readBlocked());
    writeBlocked([...blocked]);
    selfId = identity.id;
    selfName = identity.name;
    selfSignedIn = Boolean(identity.email) || filmActor;
    let officeAdState: OfficeAdProfile = session?.officeAd ?? {
      enabled: false,
      hasImage: false,
      rev: 0,
    };

    const spawn = elevatorSpawn(plate);
    const youAvatar: Avatar = {
      id: identity.id,
      name: identity.name,
      pose: "stand",
      facing: 0,
      x: spawn.x,
      y: spawn.y,
      col: spawn.col,
      row: spawn.row,
      color: identity.color,
      look: identity.look,
    };
    const you = createAvatar(youAvatar, plate, {
      editable: false,
      label: identity.name,
    });
    avatarsRoot.add(you);

    const wornLook = () => resolveLook(identity);
    const showLook = () => {
      youAvatar.look = identity.look;
      youAvatar.color = identity.color;
      restyleAvatar(you);
      macCtl?.setLook(wornLook());
    };
    const adoptUser = (user: {
      id: string;
      name: string;
      color: string;
      email: string;
      company?: string;
      profileUrl?: string;
      look?: AvatarLook;
    }) => {
      const previous = identity.id;
      const look = clampLook(user.look) ?? identity.look;
      identity.id = user.id;
      identity.name = sanitizeName(user.name) || identity.name;
      identity.email = user.email;
      identity.company = user.company;
      identity.profileUrl = user.profileUrl;
      identity.look = look;
      identity.color = look?.shirt || user.color || identity.color;
      applyAccount({
        id: identity.id,
        name: identity.name,
        email: identity.email,
        color: identity.color,
        company: identity.company,
        profileUrl: identity.profileUrl,
        look,
      });
      youAvatar.id = identity.id;
      youAvatar.name = identity.name;
      showLook();
      if (previous !== identity.id) postLook({ retire: previous, id: identity.id });
    };

    const remotes = attachRemoteHumans({
      plate,
      root: avatarsRoot,
      colliderRoots: [editRoot, structure],
    });
    remotesCtl = remotes;

    const setFixtureAvatarsVisible = (on: boolean) => {
      for (const avatar of plate.avatars ?? []) {
        if (!avatar.id || avatar.id === "you") continue;
        const mesh = avatarsRoot.getObjectByName(`avatar-${avatar.id}`);
        if (mesh) mesh.visible = on;
      }
    };
    const paintFloorHud = () => {
      if (!floorReadout) return;
      const listed = openFloors.includes(viewFloor);
      const many = openFloors.length > 1 || viewFloor > FIRST_FLOOR;
      floorReadout.hidden = !many;
      if (!listed && viewFloor > FIRST_FLOOR) {
        floorReadout.textContent = `floor ${viewFloor} · empty`;
      } else {
        floorReadout.textContent = many ? `floor ${viewFloor}` : "floor 1";
      }
    };

    livePlate = plate;
    window.hawShot = (name: string) => {
      filmFollow = "";
      const shot = TEASER_SHOTS[name];
      setFilmMode(shot?.film ?? "hide");
      applyTeaserShot(plate, name);
    };
    window.hawFollow = (name) => {
      filmFollow = name?.trim() ?? "";
      if (filmFollow) {
        camera.zoom = 7.2;
        camera.updateProjectionMatrix();
      }
    };
    window.hawFilm = (mode) => {
      if (mode === "hide" || mode === "chat" || mode === "off" || mode === "hud") setFilmMode(mode);
    };
    window.hawGo = (x, y) => {
      playerCtl?.goTo(x, y);
    };
    window.hawMoving = () => Boolean(playerCtl?.moving());
    window.hawMac = (panel) => {
      setFilmMode("chat");
      document.querySelector("#mac")?.classList.remove("collapsed");
      const btn = document.querySelector<HTMLButtonElement>(`[data-mac="${panel}"]`);
      btn?.click();
    };
    window.hawLook = (dir) => {
      lookFrom(dir);
      camera.zoom = 9.4;
      camera.updateProjectionMatrix();
    };
    const elev = elevatorSpawn(plate);
    const [ex, , ez] = toWorld(elev.x, elev.y, plate);
    elevX = ex;
    elevZ = ez;

    let worldChat: ReturnType<typeof connectWorldChat> | null = null;
    let welcomed = false;
    const pendingWhisperSound = new Map<string, string>();
    const inConferencePose = (
      conf: { col: number; row: number; cols?: number; rows?: number },
      pose: { col?: number; row?: number; x: number; y: number },
    ) => {
      const col = pose.col ?? Math.floor(pose.x / plate.grid.cellSize);
      const row = pose.row ?? Math.floor(pose.y / plate.grid.cellSize);
      const w = conf.cols ?? 1;
      const h = conf.rows ?? 1;
      return col >= conf.col && col < conf.col + w && row >= conf.row && row < conf.row + h;
    };
    const officeChatTargets = (deskId: string) => {
      const desk = desks.get(deskId);
      const ids: string[] = [];
      if (desk) {
        for (const pose of remotes.poses()) {
          if (desks.contains(desk, pose) && pose.address) ids.push(pose.address);
        }
        return ids;
      }
      const conf = (plate.conferences ?? []).find((room) => room.id === deskId);
      if (!conf) return [];
      for (const pose of remotes.poses()) {
        if (inConferencePose(conf, pose) && pose.address) ids.push(pose.address);
      }
      return ids;
    };

    const isSignedIn = () => Boolean(identity.email) || filmActor;
    const askAccount = (reason: string) => {
      macCtl?.askSignIn(reason);
      status.textContent = reason;
    };
    const isMuted = (id: string) => {
      if (blocked.has(id)) return true;
      return remotes.poses().some((pose) => pose.address === id && blocked.has(pose.id));
    };
    const barredFrom = (peerId: string) => blocked.has(peerId) || blockedBy.has(peerId);
    const leaveBlockedOffice = (byId: string) => {
      const you = playerCtl?.pose();
      if (!you) return;
      const col = you.col ?? Math.floor(you.x / plate.grid.cellSize);
      const row = you.row ?? Math.floor(you.y / plate.grid.cellSize);
      const desk = desks.atCell(col, row);
      const claim = desk ? desks.claimOf(desk.id) : undefined;
      if (!desk || !claim || claim.peerId !== byId || claim.peerId === identity.id) return;
      const at = desks.approach(desk);
      prompt.hide();
      playerCtl?.goTo(at.x, at.y, true);
      status.textContent = "asked to leave";
    };
    const kickFromMyOffice = (peerId: string) => {
      const mine = desks.mine(identity.id);
      const desk = mine ? desks.get(mine.deskId) : undefined;
      if (!mine || !desk) return;
      const at = desks.approach(desk);
      for (const pose of remotes.poses()) {
        if (pose.id !== peerId) continue;
        if (desks.contains(desk, pose)) remotes.walkTo(peerId, at.x, at.y);
      }
    };
    const setBlock = (id: string, on: boolean) => {
      if (!id || id === identity.id) return;
      if (on) {
        blocked.add(id);
        addBlocked(id);
        mac.hideKnock();
        kickFromMyOffice(id);
        status.textContent = "blocked";
      } else {
        blocked.delete(id);
        removeBlocked(id);
        status.textContent = "unblocked";
      }
      writeBlocked([...blocked]);
      room.sendBlock(id, on);
      if (isSignedIn()) void saveBlock(id, on);
      paintFloorRoster();
    };

    const faces = new Map<string, { company?: string; profileUrl?: string; image?: string }>();
    const rememberFace = (
      id: string,
      patch: { company?: string; profileUrl?: string; image?: string },
      fill = false,
    ) => {
      if (!id) return;
      const prev = faces.get(id) ?? {};
      const next = { ...prev };
      if (patch.company !== undefined && (!fill || patch.company)) next.company = patch.company || undefined;
      if (patch.profileUrl !== undefined && (!fill || patch.profileUrl)) {
        next.profileUrl = patch.profileUrl || undefined;
      }
      if (patch.image !== undefined) next.image = patch.image || undefined;
      faces.set(id, next);
    };
    const faceOf = (id: string) => {
      const claim = desks.mine(id);
      const saved = faces.get(id);
      const remote = remotes.profile(id);
      const ad = claim?.officeAd;
      return {
        company: claim?.company || saved?.company || remote?.company || "",
        profileUrl: claim?.profileUrl || saved?.profileUrl || remote?.profileUrl || "",
        image: (ad?.enabled && ad.url) || saved?.image || "",
      };
    };
    const notePeer = (peer: { id: string; company?: string; profileUrl?: string }) => {
      rememberFace(peer.id, { company: peer.company ?? "", profileUrl: peer.profileUrl ?? "" }, true);
    };
    const noteClaim = (claim: { peerId: string; company?: string; profileUrl?: string; officeAd?: OfficeAd }) => {
      rememberFace(claim.peerId, {
        company: claim.company ?? "",
        profileUrl: claim.profileUrl ?? "",
        image: claim.officeAd?.enabled && claim.officeAd.url ? claim.officeAd.url : undefined,
      });
    };

    const applyDeskAd = (deskId: string, peerId: string, ad: OfficeAd | null) => {
      const claim = desks.claimOf(deskId);
      if (!claim || claim.peerId !== peerId) return;
      if (ad?.enabled && ad.url) claim.officeAd = ad;
      else delete claim.officeAd;
      desks.apply(claim);
      rememberFace(peerId, { image: ad?.enabled && ad.url ? ad.url : "" });
      if (!personCard.hidden && personCard.dataset.id === peerId) paintPersonPhoto(peerId);
    };
    const paintPersonPhoto = (peerId: string) => {
      const src = faceOf(peerId).image;
      if (!src) {
        personCardPhoto.hidden = true;
        personCardPhoto.removeAttribute("src");
        personCardPhoto.alt = "";
        return;
      }
      personCardPhoto.alt = desks.mine(peerId)?.name || "Profile";
      if (personCardPhoto.getAttribute("src") !== src) personCardPhoto.src = src;
      personCardPhoto.hidden = false;
    };
    const paintOwnOfficeAd = () => {
      const mine = desks.mine(identity.id);
      if (!mine || mine.kind !== "office") return;
      if (officeAdState.enabled && officeAdState.url) {
        applyDeskAd(mine.deskId, identity.id, {
          deskId: mine.deskId,
          peerId: identity.id,
          enabled: true,
          url: officeAdState.url,
        });
        return;
      }
      applyDeskAd(mine.deskId, identity.id, null);
    };

    let reservations: ConferenceReservation[] = [];
    let confReserve: ReturnType<typeof attachConferenceReserve> | null = null;
    const confGroup = (id: string) =>
      [...conferencesRoot.children].find((child) => child.userData?.conference?.id === id) ?? null;
    const paintConfDoors = () => {
      for (const child of conferencesRoot.children) {
        const conf = child.userData?.conference as { id?: string } | undefined;
        if (!conf?.id) continue;
        let door: THREE.Object3D | null = null;
        child.traverse((node) => {
          if (door) return;
          const item = node.userData?.item as { type?: string } | undefined;
          if (node.userData?.isDoor || item?.type === "door") door = node;
        });
        if (door) {
          const open = canEnterConference(reservations, conf.id, identity.id);
          setHingedDoorOpen(door, open ? 0.38 : 0);
        }
      }
    };
    const paintConfBadges = () => {
      for (const child of conferencesRoot.children) {
        const conf = child.userData?.conference as { id?: string } | undefined;
        if (!conf?.id) continue;
        const notice = conferenceNotice(reservations, conf.id);
        child.userData.confLabel = nextBookingLabel(reservations, conf.id);
        applyConferencePlate(child, notice);
      }
      paintConfDoors();
    };
    const conferenceBlocked = (col: number, row: number) => {
      const conf = conferenceAtCell(plate, col, row);
      if (!conf) return false;
      return !canEnterConference(reservations, conf.id, identity.id);
    };
    confHoverLabel = (col, row) => {
      if (libraryAtCell(plate, col, row)) return "Library";
      const conf = conferenceAtCell(plate, col, row);
      if (!conf) return null;
      const label = nextBookingLabel(reservations, conf.id);
      return label ? `conference · ${label}` : "conference";
    };

    const joinGate = document.querySelector<HTMLElement>("#join-gate")!;
    const joinHello = document.querySelector("#join-hello")!;
    const joinActions = document.querySelector<HTMLElement>("#join-actions")!;
    const joinAuth = document.querySelector<HTMLElement>("#join-auth")!;
    const joinEnter = document.querySelector<HTMLButtonElement>("#join-enter")!;
    const joinGuest = document.querySelector<HTMLButtonElement>("#join-guest")!;
    const joinSignin = document.querySelector<HTMLButtonElement>("#join-signin")!;
    const joinBack = document.querySelector<HTMLButtonElement>("#join-back")!;
    const joinEmail = document.querySelector<HTMLInputElement>("#join-email")!;
    const joinEmailSend = document.querySelector<HTMLButtonElement>("#join-email-send")!;
    const joinCodeWrap = document.querySelector<HTMLElement>("#join-email-code-wrap")!;
    const joinCode = document.querySelector<HTMLInputElement>("#join-email-code")!;
    const joinVerify = document.querySelector<HTMLButtonElement>("#join-email-verify")!;
    const joinHint = document.querySelector<HTMLElement>("#join-auth-hint")!;
    const joinGoogleWrap = document.querySelector<HTMLElement>("#join-google-wrap")!;
    const joinGoogle = document.querySelector<HTMLElement>("#join-google")!;

    const setJoinHint = (text: string) => {
      joinHint.textContent = text;
    };

    const loadJoinGoogle = (onCredential: (cred: string) => void) => {
      const clientId = authConfig.googleClientId;
      if (!clientId || !joinGoogle) return;
      const render = () => {
        const gsi = window.google?.accounts?.id;
        if (!gsi) return;
        gsi.initialize({
          client_id: clientId,
          callback: (response) => onCredential(response.credential),
          auto_select: false,
          cancel_on_tap_outside: true,
        });
        joinGoogle.replaceChildren();
        gsi.renderButton(joinGoogle, {
          type: "standard",
          theme: "outline",
          size: "medium",
          text: "continue_with",
          width: 320,
        });
        joinGoogleWrap.hidden = false;
      };
      if (window.google?.accounts?.id) {
        render();
        return;
      }
      const existing = document.querySelector<HTMLScriptElement>("script[data-gsi]");
      if (existing) {
        existing.addEventListener("load", render, { once: true });
        return;
      }
      const script = document.createElement("script");
      script.src = "https://accounts.google.com/gsi/client";
      script.async = true;
      script.defer = true;
      script.dataset.gsi = "1";
      script.addEventListener("load", render, { once: true });
      document.head.appendChild(script);
    };

    let parkedOutside = false;
    let linkClockHeld = false;
    let identifyRoom: (() => void) | null = null;
    const holdLinkClock = () => {
      if (linkClockHeld || parkedOutside || guestShiftHeld || shiftStartedAt == null) return;
      linkClockHeld = true;
      pauseShiftClock();
    };
    const releaseLinkClock = () => {
      if (!linkClockHeld) return;
      linkClockHeld = false;
      if (parkedOutside || guestShiftHeld) return;
      resumeShiftClock();
    };

    const placeAt = (x: number, y: number) => {
      playerCtl?.stand();
      playerCtl?.goTo(x, y, true);
      const pose = playerCtl?.pose();
      if (!pose) return;
      const plateNow = livePlate ?? plate;
      const [wx, , wz] = toWorld(pose.x, pose.y, plateNow);
      centerCameraOn(wx, wz);
      controls.update();
    };

    const enterFloor = () => {
      parkedOutside = false;
      dismissGuestOver();
      shiftPausedMs = null;
      shiftStartedAt = Date.now();
      clockShown = "";
      paintYouHud();
      playChime("shift");
      joinGate.hidden = true;
      document.querySelector("#mac")?.classList.remove("collapsed");
      const spawn = elevatorSpawn(plate);
      playerCtl?.stand();
      playerCtl?.goTo(spawn.x, spawn.y, true);
      const pose = playerCtl?.pose();
      if (pose) {
        const [wx, , wz] = toWorld(pose.x, pose.y, plate);
        centerCameraOn(wx, wz);
      }
      if (filmActor) {
        filmFollow = "_self";
        camera.zoom = 7.2;
        camera.updateProjectionMatrix();
      } else if (filmFollow) {
        camera.zoom = 7;
        camera.updateProjectionMatrix();
      } else if (wantFilm) {
        applyTeaserShot(plate, shotName || "elevator");
      }
      if (isSignedIn()) clearGuestSpent();
      else if (guestVisitSpent || readGuestSpent()) {
        if (holdGuestShift) holdGuestShift();
        else guestHoldPending = true;
      }
    };

    await new Promise<void>((resolve) => {
      const finish = () => {
        enterFloor();
        resolve();
      };
      const showAuth = (on: boolean) => {
        joinActions.hidden = on;
        joinAuth.hidden = !on;
      };
      joinGuest.disabled = false;
      joinGuest.addEventListener("click", () => {
        void (async () => {
          if (session) {
            const token = session.token;
            if (token) dropSessionWallet(token);
            await logoutAccount();
            clearAccountEmail();
            session = null;
            identity.email = undefined;
            saveIdentity(identity);
            guest = await ensureGuestWallet(identity.id);
            identity.address = guest.address;
            selfSignedIn = false;
            youAvatar.id = identity.id;
            youAvatar.name = identity.name;
            setAvatarName(you, identity.name);
          }
          finish();
        })();
      });
      if (session) {
        joinHello.textContent = `Welcome back, ${identity.name}.`;
        joinEnter.hidden = false;
        joinEnter.disabled = false;
        joinEnter.textContent = `Clock in as ${identity.name}`;
        joinSignin.hidden = true;
        joinEnter.addEventListener("click", finish);
      } else {
        joinHello.textContent = "Clock in to walk the floor.";
        joinEnter.hidden = true;
        joinSignin.disabled = false;
        joinSignin.addEventListener("click", () => {
          showAuth(true);
          loadJoinGoogle((credential) => {
            setJoinHint("Signing in…");
            void loginWithGoogle({
              credential,
              guestId: identity.id,
              name: identity.name,
              color: identity.color,
              look: wornLook(),
            }).then(async (result) => {
              if (!result.ok) {
                setJoinHint(result.error || "Google sign-in failed");
                return;
              }
              const wallet = await ensureSessionWallet(result.token, true);
              await bindSessionWallet(wallet.address);
              guest = wallet;
              adoptUser(result.user);
              identity.address = wallet.address;
              session = {
                user: result.user,
                token: result.token,
                address: wallet.address,
                blocked: [...blocked],
                officeAd: officeAdState,
              };
              selfId = identity.id;
              selfName = identity.name;
              selfSignedIn = true;
              finish();
              identifyRoom?.();
            });
          });
        });
        joinBack.addEventListener("click", () => showAuth(false));
        joinEmailSend.addEventListener("click", () => {
          const email = joinEmail.value.trim();
          if (!email) {
            setJoinHint("Enter your email.");
            return;
          }
          joinEmailSend.disabled = true;
          setJoinHint("Sending code…");
          void startEmailCode(email).then((result) => {
            joinEmailSend.disabled = false;
            if (!result.ok) {
              setJoinHint(result.error || "Couldn't send a code.");
              return;
            }
            joinCodeWrap.hidden = false;
            setJoinHint(result.devCode ? `Dev code: ${result.devCode}` : "Check your email for a code.");
            joinCode.focus();
          });
        });
        joinVerify.addEventListener("click", () => {
          const email = joinEmail.value.trim();
          const code = joinCode.value.trim();
          if (!email || !code) {
            setJoinHint("Enter the code from your email.");
            return;
          }
          joinVerify.disabled = true;
          setJoinHint("Signing in…");
          void verifyEmailCode({
            email,
            code,
            guestId: identity.id,
            name: identity.name,
            color: identity.color,
            look: wornLook(),
          }).then(async (result) => {
            joinVerify.disabled = false;
            if (!result.ok) {
              setJoinHint(result.error || "Couldn't sign in.");
              return;
            }
            const wallet = await ensureSessionWallet(result.token, true);
            await bindSessionWallet(wallet.address);
            guest = wallet;
            adoptUser(result.user);
            identity.address = wallet.address;
            session = {
              user: result.user,
              token: result.token,
              address: wallet.address,
              blocked: [...blocked],
              officeAd: officeAdState,
            };
            selfId = identity.id;
            selfName = identity.name;
            selfSignedIn = true;
            finish();
            identifyRoom?.();
          });
        });
      }
    });

    const room = connectRoom({
      roomId: plate.id,
      identity,
      getToken: () => (filmActor ? "haw-fill-floor" : readToken()),
      getPose: () => playerCtl?.pose() ?? youAvatar,
      onWelcome: (peers, self, claims, mineBlocked, mineBlockedBy, officeAds, floor, openMax, floors, xp) => {
        if (mineBlocked?.length) {
          blocked = new Set(mineBlocked);
          writeBlocked(mineBlocked);
        }
        blockedBy = new Set(mineBlockedBy ?? []);
        viewFloor = floor ?? self.floor ?? FIRST_FLOOR;
        openFloors = floors?.length ? floors : [FIRST_FLOOR];
        maxFloor = openMax ?? openFloors[openFloors.length - 1] ?? FIRST_FLOOR;
        desks.setViewFloor(viewFloor);
        setFixtureAvatarsVisible(viewFloor === FIRST_FLOOR);
        remotes.clear();
        chatAvailable.clear();
        if (self.chatAvailable) chatAvailable.set(self.id, true);
        for (const peer of peers) {
          remotes.spawn(peer);
          notePeer(peer);
          chatAvailable.set(peer.id, Boolean(peer.chatAvailable));
        }
        desks.applyAll(claims);
        for (const claim of claims) noteClaim(claim);
        for (const ad of officeAds ?? []) applyDeskAd(ad.deskId, ad.peerId, ad);
        paintFloorRoster();
        syncMacDesk();
        paintFloorHud();
        setHudXp(xp ?? 0);
        releaseLinkClock();
        if (welcomed) return;
        welcomed = true;
        const mine = desks.mine(identity.id);
        if (mine) {
          const desk = desks.get(mine.deskId);
          if (desk) playerCtl?.goSit(desks.seat(desk));
        }
      },
      onFloors: (floor, openMax, floors) => {
        viewFloor = floor;
        openFloors = floors?.length ? floors : [FIRST_FLOOR];
        maxFloor = openMax ?? openFloors[openFloors.length - 1] ?? FIRST_FLOOR;
        paintFloorHud();
        if (!dayEnd.hidden && dayEndMode === "ask") paintElevatorFloors();
      },
      onFloorView: (view) => {
        const rode = pendingFloorRide != null && pendingFloorRide === view.floor;
        viewFloor = view.floor;
        openFloors = view.floors?.length ? view.floors : [FIRST_FLOOR];
        maxFloor = view.maxFloor ?? openFloors[openFloors.length - 1] ?? FIRST_FLOOR;
        desks.setViewFloor(viewFloor);
        setFixtureAvatarsVisible(viewFloor === FIRST_FLOOR);
        remotes.clear();
        for (const peer of view.peers) {
          remotes.spawn(peer);
          notePeer(peer);
          chatAvailable.set(peer.id, Boolean(peer.chatAvailable));
        }
        desks.applyAll(view.claims);
        for (const claim of view.claims) noteClaim(claim);
        for (const ad of view.officeAds ?? []) applyDeskAd(ad.deskId, ad.peerId, ad);
        paintFloorRoster();
        syncMacDesk();
        paintFloorHud();
        const mine = desks.mine(identity.id);
        if (!mine) playerCtl?.stand();
        if (rode) {
          const spawn = elevatorSpawn(plate);
          playerCtl?.stand();
          playerCtl?.goTo(spawn.x, spawn.y, true);
          leaveArmed = false;
          status.textContent = floorName(viewFloor);
        }
        pendingFloorRide = null;
      },
      onJoin: (peer) => {
        remotes.spawn(peer);
        notePeer(peer);
        chatAvailable.set(peer.id, Boolean(peer.chatAvailable));
        paintFloorRoster();
      },
      onLeave: (id) => {
        remotes.remove(id);
        chatAvailable.delete(id);
        macCtl?.endWhisper(id);
        paintFloorRoster();
      },
      onMove: (id, x, y) => remotes.walkTo(id, x, y),
      onState: (id, pose) => remotes.correct(id, pose),
      onXp: (xp) => {
        setHudXp(xp);
      },
      onProfile: (id, name, company, profileUrl, look) => {
        remotes.rename(id, name);
        desks.rename(id, name);
        const mine = desks.mine(id);
        rememberFace(id, { company: company || "", profileUrl: profileUrl || "" });
        remotes.setProfile(id, company, profileUrl);
        const worn = clampLook(look);
        if (worn) remotes.setLook(id, worn);
        if (mine) {
          mine.company = company || undefined;
          mine.profileUrl = profileUrl || undefined;
          desks.apply(mine);
        }
        mac.renameSpeaker(id, name);
        if (personCard.dataset.id === id) {
          personCard.dataset.name = name;
          personCardName.textContent = name;
          const companyName = company || "";
          personCardCompany.hidden = !companyName;
          personCardCompany.textContent = companyName;
          const url = profileUrl || "";
          if (url) {
            personCardLink.hidden = false;
            personCardLink.href = url;
            personCardLink.textContent = url.replace(/^https?:\/\//, "");
          } else {
            personCardLink.hidden = true;
            personCardLink.removeAttribute("href");
            personCardLink.textContent = "";
          }
        }
        paintFloorRoster();
      },
      onReservations: (list) => {
        reservations = list;
        paintConfBadges();
        playerCtl?.setCellBlocked(conferenceBlocked);
        confReserve?.refresh();
      },
      onReserve: (reservation) => {
        const prev = reservations.find((row) => row.id === reservation.id);
        reservations = [
          ...reservations.filter((row) => row.id !== reservation.id),
          {
            ...reservation,
            admitted: reservation.admitted || prev?.admitted,
            code: reservation.code ?? (reservation.peerId === identity.id ? prev?.code : undefined),
          },
        ];
        paintConfBadges();
        playerCtl?.setCellBlocked(conferenceBlocked);
        confReserve?.refresh();
        if (reservation.peerId === identity.id) {
          status.textContent =
            reservation.access === "code" && reservation.code
              ? `booked · code ${reservation.code}`
              : `booked ${reservation.day}`;
          if (reservation.access !== "code") confReserve?.hide();
        }
      },
      onCancelReserve: (id) => {
        reservations = reservations.filter((row) => row.id !== id);
        paintConfBadges();
        playerCtl?.setCellBlocked(conferenceBlocked);
        confReserve?.refresh();
        status.textContent = "reservation canceled";
      },
      onConfAdmit: (reservationId, roomId) => {
        reservations = reservations.map((row) =>
          row.id === reservationId ? { ...row, admitted: true } : row,
        );
        paintConfBadges();
        playerCtl?.setCellBlocked(conferenceBlocked);
        const room = (plate.conferences ?? []).find((item) => item.id === roomId);
        if (room) {
          const at = conferenceCenter(room, plate);
          playerCtl?.goTo(at.x, at.y);
        }
        confReserve?.hideJoin();
        status.textContent = "conference unlocked";
      },
      onConfKick: (roomId, reason) => {
        const group = confGroup(roomId);
        const at = group
          ? conferenceApproach(group, plate)
          : { x: 0, y: 0 };
        if (group) playerCtl?.goTo(at.x, at.y, true);
        playerCtl?.setCellBlocked(conferenceBlocked);
        paintConfBadges();
        status.textContent = reason === "ended" ? "conference ended" : "conference is locked";
      },
      onClaim: (claim) => {
        noteClaim(claim);
        desks.apply(claim);
        paintFloorRoster();
        syncMacDesk();
        if (claim.peerId !== identity.id) {
          const desk = desks.get(claim.deskId);
          if (desk) remotes.walkToSit(claim.peerId, desks.seat(desk));
        }
      },
      onRelease: (deskId) => {
        desks.release(deskId);
        paintFloorRoster();
        syncMacDesk();
      },
      onOfficeAd: (deskId, peerId, ad) => {
        applyDeskAd(deskId, peerId, ad);
      },
      onChat: (id, name, text, channel, deskId) => {
        if (isMuted(id)) return;
        const you = playerCtl?.pose();
        if (you && poseInQuietZone(plate, you)) return;
        const mine = id === identity.id;
        if (!mine) playChatSound(channel === "office" ? "office" : "floor");
        mac.addChat(name, text, mine, channel, deskId, id);
      },
      onChatAvailable: (id, on) => {
        chatAvailable.set(id, on);
        paintFloorRoster();
      },
      onWhisperRequest: (fromId, fromName, text) => {
        if (blocked.has(fromId) || isMuted(fromId)) return;
        pendingWhisperSound.set(fromId, text ?? "");
        playChatSound("whisper");
        mac.addWhisperRequest(fromId, fromName, text);
      },
      onWhisperOpen: (peerId, name) => {
        mac.openWhisper(peerId, name);
      },
      onWhisper: (id, name, text, peerId) => {
        if (isMuted(id) && id !== identity.id) return;
        if (id !== identity.id) {
          const echoed = pendingWhisperSound.get(id) === text;
          if (echoed) pendingWhisperSound.delete(id);
          else playChatSound("whisper");
        }
        mac.addWhisper(name, text, peerId, id === identity.id, id);
      },
      onWhisperEnd: (peerId, reason) => {
        mac.endWhisper(peerId);
        if (reason === "declined") status.textContent = "whisper declined";
        else if (reason === "left") status.textContent = "they left";
      },
      onKnock: (_deskId, fromId, fromName) => {
        if (blocked.has(fromId)) return;
        if (desks.mine(identity.id)?.privacy === "focus") return;
        mac.showKnock(fromName, fromId);
      },
      onKnockReply: (fromId, accept) => {
        if (fromId === identity.id) {
          status.textContent = accept ? "they opened the door" : "they declined";
        }
      },
      onBoot: (deskId, peerId) => {
        const mine = desks.mine(identity.id);
        if (peerId === identity.id && mine && mine.privacy === "open") {
          mine.privacy = "busy";
          desks.apply(mine);
          syncMacDesk();
        }
        evictDesk(deskId, peerId);
      },
      onBlocked: (byId) => {
        blockedBy.add(byId);
        leaveBlockedOffice(byId);
      },
      onUnblocked: (byId) => {
        blockedBy.delete(byId);
      },
      onError: (message, deskId) => {
        if (message === "sign-in") {
          askAccount(
            confReserve?.isOpen()
              ? "Sign in to reserve a conference room."
              : "Sign in to take an office.",
          );
          return;
        }
        if (message === "taken" && deskId) {
          desks.release(deskId);
          playerCtl?.stand();
          status.textContent = "that desk is taken";
          return;
        }
        if (message === "seat taken") {
          playerCtl?.stand();
          status.textContent = "that seat is taken";
          return;
        }
        if (message === "not available to chat" || message === "not available for whispers") {
          macCtl?.failWhisper();
          personNote?.("they're not available for whispers");
          return;
        }
        status.textContent = message;
        if (confReserve?.isJoinOpen()) confReserve.joinError(message);
        const err = document.querySelector("#conf-reserve-error");
        if (err && confReserve?.isOpen()) err.textContent = message;
        confReserve?.refresh();
      },
      onStatus: (text) => {
        if (text === "offline") {
          status.textContent = "offline";
          holdLinkClock();
        }
      },
    });
    identifyRoom = () => room.identify();

    paintConfBadges();

    confReserve = attachConferenceReserve({
      getReservations: () => reservations,
      getPeerId: () => identity.id,
      isSignedIn,
      askSignIn: askAccount,
      onReserve: (roomId, day, startMin, durationMin, access) => {
        room.sendReserve(roomId, day, startMin, durationMin, access);
      },
      onCancel: (id) => {
        room.sendCancelReserve(id);
      },
      onSetAccess: (id, access) => {
        room.sendConfAccess(id, access);
      },
      onJoin: (roomId, code) => {
        room.sendConfJoin(roomId, code);
      },
      getOccupants: (roomId) => {
        const conf = (plate.conferences ?? []).find((item) => item.id === roomId);
        if (!conf) return [];
        const rows: { id: string; name: string; self?: boolean }[] = [];
        const you = playerCtl?.pose();
        if (you && inConferencePose(conf, you)) {
          rows.push({ id: identity.id, name: identity.name, self: true });
        }
        for (const pose of remotes.poses()) {
          if (!inConferencePose(conf, pose)) continue;
          rows.push({ id: pose.id, name: pose.name || pose.id.slice(0, 8) });
        }
        return rows;
      },
      onBoot: (roomId, peerId) => {
        room.sendConfBoot(roomId, peerId);
      },
      onStatus: (text) => {
        status.textContent = text;
      },
    });
    const walkInConference = (conf: OfficeInstance) => {
      if (canEnterConference(reservations, conf.id, identity.id)) {
        const at = conferenceCenter(conf, plate);
        playerCtl?.goTo(at.x, at.y);
        status.textContent = nextBookingLabel(reservations, conf.id) || "conference";
        return;
      }
      const group = confGroup(conf.id);
      const at = group
        ? conferenceApproach(group, plate)
        : conferenceCenter(conf, plate);
      playerCtl?.goTo(at.x, at.y);
      confReserve!.openJoin(conf);
      status.textContent = "conference is locked";
    };

    const confAsk = document.querySelector<HTMLElement>("#conf-ask")!;
    const confAskTitle = document.querySelector("#conf-ask-title")!;
    const confAskHello = document.querySelector("#conf-ask-hello")!;
    const confAskCopy = document.querySelector("#conf-ask-copy")!;
    const confAskWalk = document.querySelector<HTMLButtonElement>("#conf-ask-walk")!;
    let pendingConf: OfficeInstance | null = null;

    const hideConfAsk = () => {
      pendingConf = null;
      confAsk.hidden = true;
    };

    const showConfAsk = (conf: OfficeInstance) => {
      prompt.hide();
      pendingConf = conf;
      const notice = conferenceNotice(reservations, conf.id);
      const allowed = canEnterConference(reservations, conf.id, identity.id);
      confAskTitle.textContent = prettyRoom(conf.id);
      confAskHello.textContent = notice.sub
        ? `${notice.title} · ${notice.sub}`
        : "Reserve this room?";
      confAskCopy.textContent = allowed
        ? notice.tone === "open"
          ? "Anyone on the floor can walk in. Reserve to take the next slot."
          : "Walk in, or reserve a slot. Open sessions let anyone in; code sessions need a door code."
        : "This meeting is code-only. Enter the door code, or reserve another time.";
      confAskWalk.textContent = allowed ? "Walk in" : "Enter code";
      confAsk.hidden = false;
      status.textContent = nextBookingLabel(reservations, conf.id) || "conference";
    };

    confAskWalk.addEventListener("click", () => {
      const conf = pendingConf;
      hideConfAsk();
      if (conf) walkInConference(conf);
    });
    document.querySelector("#conf-ask-go")?.addEventListener("click", () => {
      const conf = pendingConf;
      hideConfAsk();
      if (conf) confReserve?.open(conf);
    });
    document.querySelector("#conf-ask-no")?.addEventListener("click", hideConfAsk);
    document.querySelector("#conf-ask-close")?.addEventListener("click", hideConfAsk);
    confAsk.addEventListener("click", (event) => {
      if (event.target === confAsk) hideConfAsk();
    });
    window.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && !confAsk.hidden) hideConfAsk();
    });

    const personProfile = (peerId: string) => {
      const claim = desks.mine(peerId);
      const mode = claim
        ? claim.privacy === "focus"
          ? "Focus"
          : claim.privacy === "busy"
            ? "Busy"
            : "Open"
        : "Walking the floor";
      const desk = claim ? desks.get(claim.deskId) : undefined;
      const deskLabel = desk ? desks.pretty(desk) : "No desk";
      const available = chatAvailable.get(peerId) === true;
      const lines = [
        deskLabel,
        mode,
        available ? "Available for whispers" : "Not available for whispers",
      ];
      if (claim?.since) lines.push(workTime(claim.since));
      return lines.join(" · ");
    };

    const whisperBlockReason = (peerId: string) => {
      if (!peerId || peerId === identity.id) return "that's you";
      if (blocked.has(peerId) || blockedBy.has(peerId)) return "you can't whisper them";
      const claim = desks.mine(peerId);
      if (claim?.privacy === "busy" || claim?.privacy === "focus") return "they're not taking whispers";
      if (chatAvailable.get(peerId) !== true) return "they're not available for whispers";
      return null;
    };

    hidePersonCard = () => {
      personCard.hidden = true;
      personCardNote.hidden = true;
      personCardMeta.hidden = true;
      personCardCompany.hidden = true;
      personCardLink.hidden = true;
      personCardPhoto.hidden = true;
      personCardPhoto.removeAttribute("src");
      delete personCard.dataset.mode;
      delete personCard.dataset.id;
    };
    personNote = (text: string) => {
      personCardNote.hidden = false;
      personCardNote.textContent = text;
      status.textContent = text;
    };
    const paintPersonCard = (id: string, name: string) => {
      const face = faceOf(id);
      const company = face.company;
      const url = face.profileUrl;
      personCardName.textContent = name;
      paintPersonPhoto(id);
      if (company) {
        personCardCompany.hidden = false;
        personCardCompany.textContent = company;
      } else {
        personCardCompany.hidden = true;
        personCardCompany.textContent = "";
      }
      if (url) {
        personCardLink.hidden = false;
        personCardLink.href = url;
        personCardLink.textContent = url.replace(/^https?:\/\//, "");
      } else {
        personCardLink.hidden = true;
        personCardLink.removeAttribute("href");
        personCardLink.textContent = "";
      }
      personCardMeta.textContent = personProfile(id);
    };

    inspectPerson = (id: string, name: string) => {
      if (!id || id === identity.id) return;
      personCard.dataset.mode = "inspect";
      personCard.dataset.id = id;
      personCard.dataset.name = name;
      personCardTitle.textContent = "Person";
      paintPersonCard(id, name);
      personCardMeta.hidden = true;
      personCardNote.hidden = true;
      personCardActions.hidden = false;
      personCard.hidden = false;
    };

    const beginWhisper = (peerId: string, name: string) => {
      const why = whisperBlockReason(peerId);
      if (why) {
        if (personCard.hidden) inspectPerson?.(peerId, name);
        personNote?.(why);
        return true;
      }
      room.sendWhisper(peerId);
      macCtl?.composeWhisper(peerId, name, true);
      hidePersonCard?.();
      return true;
    };

    document.querySelector("#person-card-close")?.addEventListener("click", () => hidePersonCard?.());
    document.querySelector("#person-card-profile")?.addEventListener("click", () => {
      const id = personCard.dataset.id;
      if (!id) return;
      const url = faceOf(id).profileUrl;
      personCardMeta.hidden = false;
      personCardNote.hidden = true;
      if (url) window.open(url, "_blank", "noopener,noreferrer");
    });
    document.querySelector("#person-card-whisper")?.addEventListener("click", () => {
      const id = personCard.dataset.id;
      const name = personCard.dataset.name ?? "";
      if (id) beginWhisper(id, name);
    });

    const hideAdVisit = () => {
      adVisit.hidden = true;
      delete adVisit.dataset.url;
    };
    const showAdVisit = (deskId: string) => {
      const claim = desks.claimOf(deskId);
      if (!claim) return;
      adVisitName.textContent = claim.name || "Someone";
      const company = claim.company ?? "";
      adVisitCompany.hidden = !company;
      adVisitCompany.textContent = company;
      const url = claim.profileUrl ?? "";
      adVisit.dataset.url = url;
      adVisitGo.disabled = !url;
      adVisitHint.textContent = url ? "Visit their profile link?" : "No profile link yet.";
      hidePersonCard?.();
      prompt.hide();
      adVisit.hidden = false;
    };
    document.querySelector("#ad-visit-close")?.addEventListener("click", hideAdVisit);
    adVisitGo.addEventListener("click", () => {
      const url = adVisit.dataset.url;
      if (url) window.open(url, "_blank", "noopener,noreferrer");
      hideAdVisit();
    });

    playerCtl = attachPlayer({
      plate,
      canvas,
      camera,
      player: you,
      avatar: youAvatar,
      roof: ground.getObjectByName("roof") ?? null,
      ground,
      overlay: document.querySelector("#enter-overlay"),
      isBlocked: () =>
        parkedOutside ||
        guestShiftHeld ||
        editor.enabled() ||
        editor.busy() ||
        !claimShift.hidden ||
        !joinGate.hidden ||
        (!dayEnd.hidden && dayEndMode === "ask") ||
        Boolean(confReserve?.isOpen() || confReserve?.isJoinOpen()) ||
        !confAsk.hidden,
      colliderRoots: [editRoot, structure],
      onMove: (x, y, facing) => room.sendMove(x, y, facing),
      onClickFx: (wx, wz) => clickVfx?.spawn(wx, wz),
      onPose: (pose) => room.sendState(pose),
      pickFirst: (pointer) => {
        const hit = prompt.pick(camera, pointer);
        if (hit === "yes" && prompt.kind === "leave") {
          clockOut?.();
          return true;
        }
        if (hit === "yes" && prompt.kind === "sit" && prompt.seat) {
          if (prompt.desk && !isSignedIn()) {
            prompt.hide();
            askAccount("Sign in to sit in an office.");
            return true;
          }
          playerCtl?.goSit(prompt.seat);
          prompt.hide();
          return true;
        }
        if (hit === "yes" && prompt.kind === "knock" && prompt.desk) {
          if (!isSignedIn()) {
            prompt.hide();
            askAccount("Sign in to knock.");
            return true;
          }
          const desk = prompt.desk;
          prompt.hide();
          room.sendKnock(desk.id);
          status.textContent = "knocked";
          return true;
        }
        if (hit === "yes" && prompt.desk) {
          if (!isSignedIn()) {
            prompt.hide();
            askAccount("Sign in to take an office.");
            return true;
          }
          const desk = prompt.desk;
          prompt.hide();
          claimDesk(desk);
          return true;
        }
        if (hit === "no" || hit === "bubble") {
          if (hit === "no") {
            if (prompt.kind === "leave") leaveArmed = false;
            prompt.hide();
          }
          return true;
        }
        const person = remotes.pick(camera, pointer);
        if (person) {
          inspectPerson?.(person.id, person.name);
          return true;
        }
        const adHit = pickOfficeAd(camera, pointer, [officesRoot]);
        if (adHit) {
          showAdVisit(adHit.deskId);
          return true;
        }
        const sitHit = desks.pickSeat(camera, pointer, (seatId) => {
          const who = seatTakenBy(seatId);
          return Boolean(who && who !== selfId && who !== "you");
        });
        if (sitHit) {
          const visitClaim = sitHit.desk ? desks.claimOf(sitHit.desk.id) : undefined;
          const openVisit = Boolean(
            visitClaim &&
              visitClaim.peerId !== identity.id &&
              visitClaim.privacy === "open" &&
              !barredFrom(visitClaim.peerId),
          );
          if (openVisit) return false;
          if (sitHit.occupied) {
            status.textContent = "that seat is taken";
            return true;
          }
          const seatCol = Math.floor(sitHit.seat.x / plate.grid.cellSize);
          const seatRow = Math.floor(sitHit.seat.y / plate.grid.cellSize);
          const seatConf = conferenceAtCell(plate, seatCol, seatRow);
          if (seatConf && !canEnterConference(reservations, seatConf.id, identity.id)) {
            showConfAsk(seatConf);
            return true;
          }
          const lounge = !sitHit.desk;
          if (lounge) {
            const [wx, , wz] = toWorld(sitHit.seat.x, sitHit.seat.y, plate);
            prompt.showSit(null, sitHit.seat, wx, wz, sitHit.type);
            return true;
          }
          const desk = sitHit.desk;
          if (!desk) return false;
          const claim = desks.claimOf(desk.id);
          const mine = Boolean(claim && claim.peerId === identity.id);
          if (mine && !isSignedIn()) {
            askAccount("Sign in to sit in an office.");
            return true;
          }
          if (mine) {
            const [wx, , wz] = toWorld(sitHit.seat.x, sitHit.seat.y, plate);
            prompt.showSit(desk, sitHit.seat, wx, wz, sitHit.type);
            return true;
          }
        }
        if (prompt.kind === "leave") leaveArmed = false;
        pendingKnock = null;
        prompt.hide();
        const confNotice = pickConferenceNotice(camera, pointer, conferencesRoot);
        if (confNotice) {
          showConfAsk(confNotice);
          return true;
        }
        const confHit = pickConferenceGroup(camera, pointer, conferencesRoot);
        if (confHit) {
          showConfAsk(confHit);
          return true;
        }
        return false;
      },
      consumeClick: ({ col, row, kind }) => {
        if (kind === "conference") {
          const conf = conferenceAtCell(plate, col, row);
          if (!conf) return false;
          showConfAsk(conf);
          return true;
        }
        if (kind !== "office" && kind !== "cube") return false;
        const desk = desks.atCell(col, row);
        if (!desk) return false;
        if (desks.fixture(desk.id)) return false;
        const claim = desks.claimOf(desk.id);
        if (claim && claim.peerId !== identity.id) {
          if (barredFrom(claim.peerId) || claim.privacy === "focus") {
            const at = desks.approach(desk);
            playerCtl?.goTo(at.x, at.y);
            pendingKnock = null;
            return true;
          }
          if (claim.privacy === "busy") {
            const at = desks.approach(desk);
            const you = playerCtl?.pose();
            const dx = (you?.x ?? 0) - at.x;
            const dy = (you?.y ?? 0) - at.y;
            if (you && !playerCtl?.moving() && dx * dx + dy * dy < 28 * 28) {
              if (!isSignedIn()) {
                askAccount("Sign in to knock.");
                pendingKnock = null;
                return true;
              }
              const [wx, , wz] = toWorld(at.x, at.y, plate);
              prompt.showKnock(desk, wx, wz);
              pendingKnock = null;
              return true;
            }
            playerCtl?.goTo(at.x, at.y);
            pendingKnock = desk;
            return true;
          }
          pendingKnock = null;
          return false;
        }
        if (!isSignedIn()) {
          askAccount("Sign in to take an office.");
          return true;
        }
        if (claim && claim.peerId === identity.id) return claimDesk(desk);
        if (desks.mine(identity.id)) return false;
        showClaimShift(desk);
        return true;
      },
    });
    playerCtl.setCellBlocked(conferenceBlocked);
    syncConferencePresence = (you) => {
      const col = you.col ?? Math.floor(you.x / plate.grid.cellSize);
      const row = you.row ?? Math.floor(you.y / plate.grid.cellSize);
      const here = desks.atCell(col, row);
      const conf = conferenceAtCell(plate, col, row);
      const chatId =
        here?.id ??
        (conf && canEnterConference(reservations, conf.id, identity.id) ? conf.id : null);
      macCtl?.setChatRoom(chatId);
      if (
        conf &&
        !canEnterConference(reservations, conf.id, identity.id) &&
        playerCtl &&
        !playerCtl.moving()
      ) {
        const group = confGroup(conf.id);
        if (group) {
          const at = conferenceApproach(group, plate);
          playerCtl.goTo(at.x, at.y, true);
        }
      }
      if (confReserve?.isOpen()) confReserve.refreshPeople();
    };
    {
      const spawnPose = playerCtl.pose();
      const [sx, , sz] = toWorld(spawnPose.x, spawnPose.y, plate);
      centerCameraOn(sx, sz);
    }

    let pendingClaim: Desk | null = null;
    const hideClaimShift = () => {
      pendingClaim = null;
      claimShift.hidden = true;
    };

    const showClaimShift = (desk: Desk) => {
      prompt.hide();
      pendingClaim = desk;
      claimShiftHello.textContent = desk.kind === "cubicle" ? "This cubicle is vacant." : "This office is vacant.";
      claimShiftDesk.textContent = desks.pretty(desk);
      claimShift.hidden = false;
    };
    window.hawOpenClaim = (deskId) => {
      const desk = desks.get(deskId);
      if (desk) showClaimShift(desk);
    };

    const claimDesk = (desk: Desk) => {
      if (!isSignedIn()) {
        askAccount("Sign in to take an office.");
        return false;
      }
      if (desks.fixture(desk.id)) return false;
      const claim = desks.claimOf(desk.id);
      if (claim && claim.peerId !== identity.id) return false;
      if (claim && playerCtl?.pose().pose === "sit") return true;
      if (!claim) {
        const tz = shareTimezone() ? activeTimeZone() : undefined;
        desks.apply({
          deskId: desk.id,
          kind: desk.kind,
          peerId: identity.id,
          name: identity.name,
          privacy: "open",
          since: Date.now(),
          timezone: tz,
          company: identity.company,
          profileUrl: identity.profileUrl,
        });
        room.sendClaim(desk.id, tz);
        playChime("claim");
      }
      playerCtl?.goSit(desks.seat(desk));
      syncMacDesk();
      return true;
    };

    claimShift.querySelector("#claim-shift-go")?.addEventListener("click", () => {
      const desk = pendingClaim;
      hideClaimShift();
      if (desk) claimDesk(desk);
    });
    claimShift.querySelector("#claim-shift-no")?.addEventListener("click", hideClaimShift);
    claimShift.querySelector("#claim-shift-close")?.addEventListener("click", hideClaimShift);
    claimShift.addEventListener("click", (event) => {
      if (event.target === claimShift) hideClaimShift();
    });
    window.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && !claimShift.hidden) hideClaimShift();
      if (event.key === "Escape" && !dayEnd.hidden && dayEndMode === "ask") {
        dayEnd.hidden = true;
        leaveArmed = false;
      }
    });

    rideFloor = (floor) => {
      if (floor === viewFloor) return;
      if (!openFloors.includes(floor)) {
        status.textContent = "that floor is gone";
        return;
      }
      pendingFloorRide = floor;
      room.sendFloor(floor);
      status.textContent = `riding to ${floorName(floor)}`;
    };

    askClockOut = () => {
      const mine = desks.mine(identity.id);
      const desk = mine ? desks.get(mine.deskId) : undefined;
      prompt.hide();
      showClockOutAsk({
        name: identity.name,
        hasDesk: Boolean(mine),
        since: shiftStartedAt ?? mine?.since,
        desk: desk ? desks.pretty(desk) : "",
      });
    };

    goHome = () => {
      const plateNow = livePlate ?? plate;
      const spawn = sidewalkSpawn(plateNow);
      placeAt(spawn.x, spawn.y);
      status.textContent = "headed home";
    };

    clockOut = (home = false) => {
      const mine = desks.mine(identity.id);
      const desk = mine ? desks.get(mine.deskId) : undefined;
      const you = playerCtl?.pose();
      const insideOffice = Boolean(desk && you && desks.contains(desk, you));
      if (mine) {
        room.sendRelease();
        desks.release(mine.deskId);
      }
      prompt.hide();
      leaveArmed = false;
      syncMacDesk();
      paintFloorRoster();
      if (home) {
        parkedOutside = true;
        playChime("clockout");
        room.sendWhisperEnd();
        macCtl?.endAllWhispers();
        goHome?.();
        dismissGuestOver();
        clearShiftClock();
        dayEnd.hidden = true;
        document.querySelector("#mac")?.classList.add("collapsed");
        joinGate.hidden = false;
        joinAuth.hidden = true;
        joinActions.hidden = false;
        return;
      }
      if (insideOffice && desk) {
        const at = desks.approach(desk);
        placeAt(at.x, at.y);
      } else {
        playerCtl?.stand();
      }
      dayEnd.hidden = true;
    };

    const syncMacDesk = () => {
      const mine = desks.mine(identity.id);
      mac.setHasDesk(Boolean(mine));
      mac.setPrivacy(mine?.privacy ?? "open");
    };

    const evictDesk = (deskId: string, hostId: string) => {
      const desk = desks.get(deskId);
      if (!desk) return;
      const at = desks.approach(desk);
      const you = playerCtl?.pose();
      if (you && hostId !== identity.id && desks.contains(desk, you)) {
        prompt.hide();
        playerCtl?.goTo(at.x, at.y, true);
        status.textContent = "asked to leave";
      }
      for (const pose of remotes.poses()) {
        if (pose.id === hostId) continue;
        if (!desks.contains(desk, pose)) continue;
        remotes.walkTo(pose.id, at.x, at.y);
      }
    };

    const bootOffice = () => {
      const mine = desks.mine(identity.id);
      if (!mine) return;
      mine.privacy = "busy";
      desks.apply(mine);
      room.sendBoot();
      syncMacDesk();
      evictDesk(mine.deskId, identity.id);
      status.textContent = "door closed";
    };

    const paintSelf = () => {
      selfId = identity.id;
      selfName = identity.name;
      selfSignedIn = Boolean(identity.email);
      youAvatar.id = identity.id;
      youAvatar.name = identity.name;
      youAvatar.color = identity.color;
      youAvatar.look = identity.look;
      setAvatarName(you, identity.name);
      showLook();
      macCtl?.setName(identity.name);
      macCtl?.setCompany(identity.company ?? "");
      macCtl?.setProfileUrl(identity.profileUrl ?? "");
      macCtl?.setAccount(identity.email);
      if (filmActor) macCtl?.setAccount("ash@humansat.work");
    };

    const becomeSignedIn = async (
      user: {
        id: string;
        email: string;
        name: string;
        color: string;
        company?: string;
        profileUrl?: string;
        look?: AvatarLook;
      },
      token: string,
    ) => {
      const oldId = identity.id;
      const wallet = await ensureSessionWallet(token, true);
      await bindSessionWallet(wallet.address);
      guest = wallet;
      session = { user, token, address: wallet.address, blocked: [...blocked], officeAd: officeAdState };
      adoptUser(user);
      identity.address = wallet.address;
      if (oldId !== identity.id) {
        const mine = desks.mine(oldId);
        if (mine) {
          mine.peerId = identity.id;
          mine.name = identity.name;
          desks.apply(mine);
        }
      } else {
        desks.rename(identity.id, identity.name);
      }
      paintSelf();
      const savedAd = await fetchOfficeAd();
      if (savedAd.ok) {
        officeAdState = savedAd.officeAd;
        session.officeAd = officeAdState;
        macCtl?.setOfficeAd({ enabled: officeAdState.enabled, previewUrl: officeAdState.url });
      }
      room.identify();
      await worldChat?.reconnect(wallet.identity, wallet.address);
      releaseGuestHold();
    };

    const guestEmail = document.querySelector<HTMLInputElement>("#guest-over-email")!;
    const guestEmailSend = document.querySelector<HTMLButtonElement>("#guest-over-email-send")!;
    const guestCodeWrap = document.querySelector<HTMLElement>("#guest-over-code-wrap")!;
    const guestCode = document.querySelector<HTMLInputElement>("#guest-over-code")!;
    const guestVerify = document.querySelector<HTMLButtonElement>("#guest-over-verify")!;
    const guestHint = document.querySelector<HTMLElement>("#guest-over-hint")!;
    const guestGoogleWrap = document.querySelector<HTMLElement>("#guest-over-google-wrap")!;
    const guestGoogle = document.querySelector<HTMLElement>("#guest-over-google")!;
    const setGuestHint = (text: string) => {
      guestHint.textContent = text;
    };
    const showGuestAuth = (on: boolean) => {
      guestOverActions.hidden = on;
      guestOverAuth.hidden = !on;
    };
    let guestGoogleReady = false;
    const loadGuestGoogle = () => {
      const clientId = authConfig.googleClientId;
      if (!clientId || guestGoogleReady) return;
      const render = () => {
        const gsi = window.google?.accounts?.id;
        if (!gsi) return;
        gsi.initialize({
          client_id: clientId,
          callback: (response) => {
            setGuestHint("Signing in…");
            void loginWithGoogle({
              credential: response.credential,
              guestId: identity.id,
              name: identity.name,
              color: identity.color,
              look: wornLook(),
            }).then(async (result) => {
              if (!result.ok) {
                setGuestHint(result.error || "Google sign-in failed");
                return;
              }
              await becomeSignedIn(result.user, result.token);
            });
          },
          auto_select: false,
          cancel_on_tap_outside: true,
        });
        guestGoogle.replaceChildren();
        gsi.renderButton(guestGoogle, {
          type: "standard",
          theme: "outline",
          size: "medium",
          text: "continue_with",
          width: 320,
        });
        guestGoogleWrap.hidden = false;
        guestGoogleReady = true;
      };
      if (window.google?.accounts?.id) {
        render();
        return;
      }
      const existing = document.querySelector<HTMLScriptElement>("script[data-gsi]");
      if (existing) {
        existing.addEventListener("load", render, { once: true });
        return;
      }
      const script = document.createElement("script");
      script.src = "https://accounts.google.com/gsi/client";
      script.async = true;
      script.defer = true;
      script.dataset.gsi = "1";
      script.addEventListener("load", render, { once: true });
      document.head.appendChild(script);
    };

    holdGuestShift = () => {
      if (guestShiftHeld || isSignedIn() || parkedOutside) return;
      guestShiftHeld = true;
      markGuestSpent();
      pauseShiftClock();
      room.sendShiftHold();
      prompt.hide();
      claimShift.hidden = true;
      if (dayEndMode === "ask") dayEnd.hidden = true;
      confAsk.hidden = true;
      confReserve?.hide();
      confReserve?.hideJoin();
      hidePersonCard?.();
      adVisit.hidden = true;
      leaveArmed = false;
      const spawn = elevatorSpawn(livePlate ?? plate);
      placeAt(spawn.x, spawn.y);
      showGuestAuth(false);
      guestOver.hidden = false;
    };
    if (guestHoldPending) {
      guestHoldPending = false;
      holdGuestShift();
    }
    onGuestExpired = () => {
      if (guestShiftHeld || parkedOutside || isSignedIn() || !joinGate.hidden) return;
      if (shiftStartedAt == null) return;
      if (Date.now() - shiftStartedAt < GUEST_SHIFT_MS) return;
      holdGuestShift?.();
    };
    document.querySelector("#guest-over-signin")?.addEventListener("click", () => {
      showGuestAuth(true);
      loadGuestGoogle();
      guestEmail.focus();
    });
    document.querySelector("#guest-over-back")?.addEventListener("click", () => showGuestAuth(false));
    document.querySelector("#guest-over-leave")?.addEventListener("click", () => clockOut?.(true));
    guestEmailSend.addEventListener("click", () => {
      const email = guestEmail.value.trim();
      if (!email) {
        setGuestHint("Enter your email.");
        return;
      }
      guestEmailSend.disabled = true;
      setGuestHint("Sending code…");
      void startEmailCode(email).then((result) => {
        guestEmailSend.disabled = false;
        if (!result.ok) {
          setGuestHint(result.error || "Couldn't send a code.");
          return;
        }
        guestCodeWrap.hidden = false;
        setGuestHint(result.devCode ? `Dev code: ${result.devCode}` : "Check your email for a code.");
        guestCode.focus();
      });
    });
    guestVerify.addEventListener("click", () => {
      const email = guestEmail.value.trim();
      const code = guestCode.value.trim();
      if (!email || !code) {
        setGuestHint("Enter the code from your email.");
        return;
      }
      guestVerify.disabled = true;
      setGuestHint("Signing in…");
      void verifyEmailCode({
        email,
        code,
        guestId: identity.id,
        name: identity.name,
        color: identity.color,
        look: wornLook(),
      }).then(async (result) => {
        guestVerify.disabled = false;
        if (!result.ok) {
          setGuestHint(result.error || "Couldn't sign in.");
          return;
        }
        await becomeSignedIn(result.user, result.token);
      });
    });

    const becomeGuest = async () => {
      room.sendWhisperEnd();
      macCtl?.endAllWhispers();
      macCtl?.setChatAvailable(false);
      const mine = desks.mine(identity.id);
      if (mine) {
        room.sendRelease();
        desks.release(mine.deskId);
        playerCtl?.stand();
        syncMacDesk();
        paintFloorRoster();
      }
      const token = session?.token;
      if (token) dropSessionWallet(token);
      await logoutAccount();
      clearAccountEmail();
      session = null;
      officeAdState = { enabled: false, hasImage: false, rev: 0 };
      macCtl?.setOfficeAd({ enabled: false, previewUrl: null });
      identity.email = undefined;
      saveIdentity(identity);
      guest = await ensureGuestWallet(identity.id);
      identity.address = guest.address;
      paintSelf();
      room.identify();
      await worldChat?.reconnect(guest.identity, guest.address);
    };

    const mac = attachMac({
      root: document.querySelector("#mac")!,
      getName: () => identity.name,
      getCompany: () => identity.company ?? "",
      getProfileUrl: () => identity.profileUrl ?? "",
      getLook: () => wornLook(),
      onLook: (look) => {
        const next = clampLook(look);
        if (!next || sameLook(next, wornLook())) return;
        identity.look = next;
        identity.color = next.shirt;
        saveIdentity(identity);
        showLook();
        room.sendProfile(identity.name, identity.company ?? "", identity.profileUrl ?? "", next);
        if (!identity.email) return;
        void saveAccountProfile({
          name: identity.name,
          company: identity.company,
          profileUrl: identity.profileUrl,
          look: next,
        });
      },
      onName: async (raw) => {
        const name = sanitizeName(raw) || identity.name;
        identity.name = name;
        youAvatar.name = name;
        selfName = name;
        saveIdentity(identity);
        setAvatarName(you, name);
        desks.rename(identity.id, name);
        room.sendProfile(name, identity.company, identity.profileUrl);
        mac.setName(name);
        mac.renameSpeaker(identity.id, name);
        worldChat?.setName(name);
        if (!identity.email) return true;
        const saved = await saveAccountName(name);
        return saved.ok;
      },
      onSaveProfile: async ({ name: raw, company: rawCompany, profileUrl: rawUrl }) => {
        const name = sanitizeName(raw) || identity.name;
        const company = clampCompany(rawCompany);
        const profileUrl = clampProfileUrl(rawUrl);
        if (rawUrl.trim() && !profileUrl) return false;
        identity.name = name;
        identity.company = company || undefined;
        identity.profileUrl = profileUrl || undefined;
        youAvatar.name = name;
        selfName = name;
        saveIdentity(identity);
        setAvatarName(you, name);
        desks.rename(identity.id, name);
        const mine = desks.mine(identity.id);
        if (mine) {
          mine.company = identity.company;
          mine.profileUrl = identity.profileUrl;
          desks.apply(mine);
        }
        room.sendProfile(name, identity.company ?? "", identity.profileUrl ?? "");
        mac.setName(name);
        mac.setCompany(company);
        mac.setProfileUrl(profileUrl);
        mac.renameSpeaker(identity.id, name);
        worldChat?.setName(name);
        paintFloorRoster();
        if (!identity.email) return true;
        const saved = await saveAccountProfile({
          name,
          company,
          profileUrl,
        });
        return saved.ok;
      },
      onGoTo: (deskId) => {
        const desk = desks.get(deskId);
        if (!desk) return;
        const at = desks.approach(desk);
        playerCtl?.goTo(at.x, at.y);
      },
      getPrivacy: () => desks.mine(identity.id)?.privacy ?? "open",
      onPrivacy: (privacy: Privacy) => {
        const mine = desks.mine(identity.id);
        if (!mine) return;
        mine.privacy = privacy;
        desks.apply(mine);
        room.sendPrivacy(privacy);
        mac.setPrivacy(privacy);
        if (privacy === "focus" || privacy === "busy") {
          evictDesk(mine.deskId, identity.id);
        }
      },
      hasDesk: () => Boolean(desks.mine(identity.id)),
      signedIn: isSignedIn,
      onInspectPerson: (peerId, name) => {
        inspectPerson?.(peerId, name);
      },
      onWhisper: (text, toId) => {
        const pose = playerCtl?.pose();
        if (pose && poseInQuietZone(plate, pose)) return;
        room.sendWhisper(toId, text);
      },
      onWhisperReply: (fromId, accept) => {
        room.sendWhisperReply(fromId, accept);
      },
      onWhisperEnd: (peerId) => {
        room.sendWhisperEnd(peerId);
      },
      onChatAvailable: (on) => {
        chatAvailable.set(identity.id, on);
        room.sendChatAvailable(on);
        paintFloorRoster();
      },
      onShareTz: (on) => {
        confReserve?.refresh();
        paintConfBadges();
        const mine = desks.mine(identity.id);
        if (!mine) return;
        mine.timezone = on ? activeTimeZone() : undefined;
        desks.apply(mine);
        room.sendTimezone(on ? activeTimeZone() : null);
      },
      onChat: (text, channel) => {
        const pose = playerCtl?.pose();
        if (pose && poseInQuietZone(plate, pose)) return;
        if (channel === "office") {
          const you = playerCtl?.pose();
          if (!you) return;
          const col = you.col ?? Math.floor(you.x / plate.grid.cellSize);
          const row = you.row ?? Math.floor(you.y / plate.grid.cellSize);
          const here = desks.atCell(col, row);
          const conf = conferenceAtCell(plate, col, row);
          const roomId =
            here?.id ??
            (conf && canEnterConference(reservations, conf.id, identity.id) ? conf.id : null);
          if (!roomId) return;
          const dest = officeChatTargets(roomId);
          if (worldChat?.sendChat(text, "office", dest, roomId)) {
            mac.addChat(identity.name, text, true, "office", roomId, identity.id);
            return;
          }
          room.sendChat(text, "office");
          return;
        }
        if (worldChat?.sendChat(text, "floor", [])) {
          mac.addChat(identity.name, text, true, "floor", undefined, identity.id);
          return;
        }
        room.sendChat(text, "floor");
      },
      onKnockReply: (fromId, accept) => {
        room.sendKnockReply(fromId, accept);
        if (accept) syncMacDesk();
      },
      onBlock: (id, on) => setBlock(id, on),
      onBoot: () => bootOffice(),
      officeAd: {
        get: () => ({ enabled: officeAdState.enabled, previewUrl: officeAdState.url }),
        setEnabled: async (on) => {
          if (filmActor) {
            officeAdState = { ...officeAdState, enabled: on };
            mac.setOfficeAd({ enabled: on, previewUrl: officeAdState.url });
            paintOwnOfficeAd();
            return;
          }
          if (!isSignedIn()) {
            askAccount("Sign in to set a window ad.");
            mac.setOfficeAd({ enabled: officeAdState.enabled, previewUrl: officeAdState.url });
            return;
          }
          const saved = await saveOfficeAd({ enabled: on });
          if (!saved.ok) {
            mac.setOfficeAd({ enabled: officeAdState.enabled, previewUrl: officeAdState.url });
            return;
          }
          officeAdState = saved.officeAd;
          mac.setOfficeAd({ enabled: officeAdState.enabled, previewUrl: officeAdState.url });
          paintOwnOfficeAd();
          room.sendOfficeAd(officeAdState.enabled);
        },
        setImage: async (file) => {
          if (filmActor) {
            try {
              const packed = await compressOfficeAd(file);
              officeAdState = {
                enabled: true,
                hasImage: true,
                rev: (officeAdState.rev || 0) + 1,
                url: packed.dataUrl,
              };
              mac.setOfficeAd({ enabled: true, previewUrl: packed.dataUrl });
              paintOwnOfficeAd();
              return { ok: true, previewUrl: packed.dataUrl };
            } catch (err) {
              return { ok: false, error: err instanceof Error ? err.message : "Couldn't save." };
            }
          }
          if (!isSignedIn()) {
            askAccount("Sign in to set a window ad.");
            return { ok: false, error: "Sign in first." };
          }
          try {
            const packed = await compressOfficeAd(file);
            const saved = await saveOfficeAd({
              image: packed.dataUrl,
              enabled: officeAdState.hasImage ? officeAdState.enabled : true,
            });
            if (!saved.ok) return { ok: false, error: saved.error || "Couldn't save." };
            officeAdState = saved.officeAd;
            mac.setOfficeAd({ enabled: officeAdState.enabled, previewUrl: officeAdState.url });
            paintOwnOfficeAd();
            room.sendOfficeAd(officeAdState.enabled);
            return { ok: true, previewUrl: officeAdState.url };
          } catch (err) {
            return { ok: false, error: err instanceof Error ? err.message : "Couldn't save." };
          }
        },
      },
      auth: {
        email: identity.email,
        googleClientId: authConfig.googleClientId,
        onEmailStart: (email) => startEmailCode(email),
        onEmailVerify: async (email, code) => {
          const result = await verifyEmailCode({
            email,
            code,
            guestId: identity.id,
            name: identity.name,
            color: identity.color,
            look: wornLook(),
          });
          if (!result.ok) return result;
          await becomeSignedIn(result.user, result.token);
          return result;
        },
        onGoogle: async (credential) => {
          const result = await loginWithGoogle({
            credential,
            guestId: identity.id,
            name: identity.name,
            color: identity.color,
            look: wornLook(),
          });
          if (!result.ok) return result;
          await becomeSignedIn(result.user, result.token);
          return result;
        },
        onLogout: async () => {
          await becomeGuest();
        },
      },
    });
    macCtl = mac;
    if (filmActor) macCtl.setAccount("ash@humansat.work");
    paintFloorRoster();
    worldChat = connectWorldChat({
      identity,
      address: guest.address,
      auth: guest.identity,
      worldName: DCL_WORLD,
      onChat: (id, name, text, channel, deskId) => {
        if (isMuted(id)) return;
        const you = playerCtl?.pose();
        if (you && poseInQuietZone(plate, you)) return;
        const fromPeer =
          id === identity.address || id === identity.id
            ? identity.id
            : remotes.poses().find((pose) => pose.address === id)?.id ?? id;
        if (fromPeer !== identity.id) playChatSound(channel === "office" ? "office" : "floor");
        mac.addChat(name, text, fromPeer === identity.id, channel, deskId, fromPeer);
      },
      onStatus: (text) => {
        status.textContent = text;
      },
    });
    worldChatCtl = worldChat;
    syncMacDesk();
  })
  .catch((err) => {
    console.error(err);
    status.textContent = "furniture failed to load (check GLBs)";
  });

function resize() {
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  renderer.setSize(w, h, false);
  const a = w / Math.max(1, h);
  camera.left = -frustum * a;
  camera.right = frustum * a;
  camera.top = frustum;
  camera.bottom = -frustum;
  camera.updateProjectionMatrix();
}

function simulate(dt: number) {
  camCtl?.update(Math.min(dt, 0.05));
  playerCtl?.update(dt);
  remotesCtl?.update(dt);
  updateAvatars(dt);
  clickVfx?.update(dt);
  if (!desksCtl) return;
  const poses = remotesCtl?.poses() ?? [];
  const you = playerCtl?.pose();
  if (you && selfId) {
    poses.push({
      id: selfId,
      name: selfName,
      x: you.x,
      y: you.y,
      col: you.col,
      row: you.row,
    });
  }
  desksCtl.refresh(poses);
  const t = performance.now();
  if (t - lastFloorPaint > 1000) {
    lastFloorPaint = t;
    paintFloorRoster();
  }
    if (you && livePlate) {
    const col = you.col ?? Math.floor(you.x / livePlate.grid.cellSize);
    const row = you.row ?? Math.floor(you.y / livePlate.grid.cellSize);
    const here = desksCtl.atCell(col, row);
    if (here) macCtl?.setChatRoom(here.id);
    else syncConferencePresence?.(you);
    const quiet = poseInQuietZone(livePlate, you);
    if (quiet !== lastQuiet) {
      lastQuiet = quiet;
      macCtl?.setQuiet(quiet);
      worldChatCtl?.setQuiet(quiet);
      setAmbientSilent(quiet);
    }
  }
  if (livePlate && playerCtl && promptCtl) {
    const pose = playerCtl.pose();
    const col = pose.col ?? Math.floor(pose.x / livePlate.grid.cellSize);
    const row = pose.row ?? Math.floor(pose.y / livePlate.grid.cellSize);
    const atElevator = inElevator(livePlate, col, row);
    if (pendingKnock && !playerCtl.moving()) {
      const desk = pendingKnock;
      pendingKnock = null;
      const claim = desksCtl.claimOf(desk.id);
      const at = desksCtl.approach(desk);
      const dx = pose.x - at.x;
      const dy = pose.y - at.y;
      if (claim && claim.peerId !== selfId && claim.privacy === "busy" && dx * dx + dy * dy < 28 * 28) {
        if (blocked.has(claim.peerId) || blockedBy.has(claim.peerId)) {
          promptCtl.hide();
        } else if (!selfSignedIn) {
          macCtl?.askSignIn("Sign in to knock.");
          status.textContent = "Sign in to knock.";
        } else {
          const [wx, , wz] = toWorld(at.x, at.y, livePlate);
          promptCtl.showKnock(desk, wx, wz);
        }
      }
    }
    if (guestShiftHeld) {
      leaveArmed = false;
      if (promptCtl.kind === "leave") promptCtl.hide();
    } else if (atElevator && !playerCtl.moving() && leaveArmed) {
      if (promptCtl.kind === "leave") promptCtl.hide();
      if (dayEnd.hidden) askClockOut?.();
    } else if (!atElevator) {
      leaveArmed = true;
      if (promptCtl.kind === "leave") promptCtl.hide();
      if (dayEndMode === "ask" && !dayEnd.hidden) dayEnd.hidden = true;
    }
  }
  const youMesh = scene.getObjectByName(`avatar-${selfId}`);
  if (youMesh) setNameTagVisible(youMesh, false);
  for (const remote of remotesCtl?.avatars() ?? []) {
    const mine = desksCtl.mine(remote.id);
    const here = desksCtl.atCell(remote.col ?? 0, remote.row ?? 0);
    setNameTagVisible(remote.group, !(mine && here?.id === mine.deskId));
  }
}

function seatTakenBy(seatId?: string) {
  if (!seatId) return null;
  const you = playerCtl?.pose();
  if (you?.pose === "sit" && you.seatId === seatId) return selfId || "you";
  for (const peer of remotesCtl?.poses() ?? []) {
    if (peer.pose === "sit" && peer.seatId === seatId) return peer.id;
  }
  return null;
}

function workTime(since: number) {
  const mins = Math.max(0, Math.floor((Date.now() - since) / 60000));
  if (mins < 1) return "just arrived";
  if (mins < 60) return `${mins}m at work`;
  const hours = Math.floor(mins / 60);
  const rest = mins % 60;
  return rest ? `${hours}h ${rest}m at work` : `${hours}h at work`;
}

function formatShift(since: number) {
  const sec = Math.max(0, Math.floor((Date.now() - since) / 1000));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  const parts: string[] = [];
  if (h) parts.push(h === 1 ? "1 hour" : `${h} hours`);
  if (m) parts.push(m === 1 ? "1 minute" : `${m} minutes`);
  if (!h && !m) parts.push(s === 1 ? "1 second" : `${s} seconds`);
  return parts.join(" ");
}

function fillTimesheet(since: number, desk: string) {
  dayEndIn.textContent = new Date(since).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
  dayEndTime.textContent = formatShift(since);
  dayEndDesk.textContent = desk || "—";
  const minutes = Math.floor(shiftElapsedMs() / 60000);
  dayEndShiftXp.textContent = `${(minutes * XP_PER_MINUTE).toLocaleString("en-US")} XP`;
  dayEndTotalXp.textContent = `${bankedXp.toLocaleString("en-US")} XP`;
}

function paintElevatorFloors() {
  dayEndFloors.innerHTML = "";
  const others = openFloors.filter((floor) => floor !== viewFloor);
  dayEndFloors.hidden = others.length === 0;
  const labeled = openFloors.length > 1 || viewFloor > FIRST_FLOOR;
  dayEndTitle.textContent = labeled ? `Elevator · Floor ${viewFloor}` : "Elevator";
  for (const floor of others) {
    const btn = document.createElement("button");
    btn.type = "button";
    if (floor === viewFloor + 1) btn.textContent = `Next floor (${floor})`;
    else if (floor === viewFloor - 1) btn.textContent = floor === FIRST_FLOOR ? "Go down to floor 1" : `Go to floor ${floor}`;
    else btn.textContent = `Go to floor ${floor}`;
    btn.addEventListener("click", () => {
      dayEnd.hidden = true;
      leaveArmed = false;
      rideFloor?.(floor);
    });
    dayEndFloors.appendChild(btn);
  }
}

function showClockOutAsk(opts: { name: string; hasDesk: boolean; since?: number; desk?: string }) {
  dayEndMode = "ask";
  const others = openFloors.filter((floor) => floor !== viewFloor);
  const moreFloors = others.length > 0 || viewFloor > FIRST_FLOOR;
  const next = others.find((floor) => floor > viewFloor);
  dayEndHello.textContent = moreFloors && viewFloor > FIRST_FLOOR
    ? `${opts.name}, ${floorName(viewFloor)}.`
    : opts.hasDesk
      ? `${opts.name}, ready to go?`
      : `${opts.name}, head home?`;
  if (opts.since) {
    fillTimesheet(opts.since, opts.desk ?? "");
    dayEndWell.hidden = false;
  } else {
    dayEndWell.hidden = true;
  }
  dayEndGo.hidden = !opts.hasDesk;
  if (opts.hasDesk) {
    dayEndCopy.textContent = moreFloors
      ? next && viewFloor === FIRST_FLOOR
        ? `${floorName(next)} is open. Ride up, leave your office, or end your shift.`
        : "Ride to another floor, leave your office, or end your shift."
      : "Leave office frees your desk and you stay on the floor. End shift clocks you out and takes you outside — come back later without closing the tab.";
  } else {
    dayEndCopy.textContent = moreFloors
      ? next && viewFloor === FIRST_FLOOR
        ? `${floorName(next)} is open. Ride up, or end your shift.`
        : "Ride to another floor, or end your shift and leave."
      : "You're on the clock even without a desk. End shift clocks you out and takes you outside — come back later without closing the tab.";
  }
  paintElevatorFloors();
  dayEndHome.hidden = false;
  dayEndStay.hidden = false;
  dayEndOk.hidden = true;
  dayEnd.hidden = false;
}

function showClockOutDone(name: string, since: number, desk: string, home: boolean) {
  dayEndMode = "done";
  fillTimesheet(since, desk);
  dayEndWell.hidden = false;
  dayEndGo.hidden = true;
  dayEndHome.hidden = true;
  dayEndStay.hidden = true;
  dayEndFloors.hidden = true;
  dayEndOk.hidden = false;
  dayEndTitle.textContent = "Elevator";
  if (home) {
    dayEndHello.textContent = `${name}, done for the day.`;
    dayEndCopy.textContent = "You're outside. Come back through the elevator when you want another shift.";
    dayEndOk.textContent = "See you tomorrow";
  } else {
    dayEndHello.textContent = `${name}, office is free.`;
    dayEndCopy.textContent = "You're still on the floor. Grab another desk whenever you're ready.";
    dayEndOk.textContent = "OK";
  }
  dayEnd.hidden = false;
}

function dismissClockOutAsk() {
  if (dayEndMode !== "ask") return;
  dayEnd.hidden = true;
  leaveArmed = false;
}

dayEndGo.addEventListener("click", () => clockOut?.(false));
dayEndHome.addEventListener("click", () => clockOut?.(true));
dayEndStay.addEventListener("click", dismissClockOutAsk);
dayEndOk.addEventListener("click", () => {
  dayEnd.hidden = true;
});
document.querySelector("#day-end-close")?.addEventListener("click", () => {
  if (dayEndMode === "ask") dismissClockOutAsk();
  else dayEnd.hidden = true;
});
dayEnd.addEventListener("click", (event) => {
  if (event.target !== dayEnd) return;
  if (dayEndMode === "ask") dismissClockOutAsk();
  else dayEnd.hidden = true;
});

function paintFloorRoster() {
  if (!desksCtl || !macCtl) return;
  macCtl.setFloor(
    desksCtl.roster().map((row) => ({
      ...row,
      time: workTime(row.since),
      self: row.peerId === selfId,
      blocked: blocked.has(row.peerId),
      chatAvailable: chatAvailable.get(row.peerId) === true,
    })),
  );
}

function updateOfficePeek(desk: Desk | null, kind?: string) {
  if (!desk || (kind !== "office" && kind !== "cube")) {
    peekEl.hidden = true;
    peekEl.classList.remove("vacant");
    return;
  }
  peekEl.hidden = false;
  peekTitle.textContent = desksCtl?.pretty(desk) ?? "Office";
  const claim = desksCtl?.claimOf(desk.id);
  const fixture = desksCtl?.fixture(desk.id);
  peekEl.classList.toggle("vacant", !claim && !fixture);
  if (claim) {
    const mode = claim.privacy === "focus" ? "Focus" : claim.privacy === "busy" ? "Busy" : "Open";
    peekName.textContent = claim.name;
    peekMeta.textContent = `${mode} · ${workTime(claim.since)}`;
    return;
  }
  if (fixture) {
    peekName.textContent = fixture;
    peekMeta.textContent = "In the office";
    return;
  }
  peekName.textContent = "Vacant";
  peekMeta.textContent = desksCtl?.mine(selfId) ? "You already have a desk" : "Click to claim";
}

function tick(render: boolean) {
  onGuestExpired?.();
  const now = performance.now();
  let dt = (now - lastTick) / 1000;
  lastTick = now;
  if (dt > 8) dt = 8;
  simulate(dt);
  if (!render) return;
  resize();
  if (livePlate && filmFollow === "_self" && playerCtl) {
    const pose = playerCtl.pose();
    const [wx, , wz] = toWorld(pose.x, pose.y, livePlate);
    centerCameraOn(wx, wz);
  } else if (livePlate && filmFollow) {
    const peer = remotesCtl?.poses().find((row) => row.name.toLowerCase() === filmFollow.toLowerCase());
    if (peer) {
      const [wx, , wz] = toWorld(peer.x, peer.y, livePlate);
      centerCameraOn(wx, wz);
    }
  } else if (playerCtl?.moving() && livePlate) {
    const pose = playerCtl.pose();
    const [wx, , wz] = toWorld(pose.x, pose.y, livePlate);
    centerCameraOn(wx, wz);
  }
  if (!camCtl?.rotating?.()) controls.update();
  camCtl?.clamp?.();
  paintYouHud();
  desksCtl?.cullLamps(controls.target);

  const tiles = scene.getObjectByName("tiles");
  if (tiles) {
    raycaster.setFromCamera(pointer, camera);
    const hit = raycaster.intersectObjects(tiles.children, false)[0];
    const kind = hit?.object.userData.kind as string | undefined;
    const col = hit?.object.userData.col as number | undefined;
    const row = hit?.object.userData.row as number | undefined;
    const desk = kind && col !== undefined && row !== undefined ? desksCtl?.atCell(col, row) : null;
    const personHover = remotesCtl?.pick(camera, pointer);
    const adHover =
      !personHover && desksCtl ? pickOfficeAd(camera, pointer, [scene.getObjectByName("offices") ?? scene]) : null;
    if (personHover) {
      canvas.style.cursor = "pointer";
      status.textContent = personHover.name;
    } else if (adHover) {
      canvas.style.cursor = "pointer";
      const who = desksCtl?.claimOf(adHover.deskId);
      status.textContent = who ? `${who.name}${who.company ? ` · ${who.company}` : ""} · visit` : "window ad";
    } else {
      canvas.style.cursor = "";
    }
    const sitHover = desksCtl?.pickSeat(camera, pointer, (seatId) => {
      const who = seatTakenBy(seatId);
      return Boolean(who && who !== selfId && who !== "you");
    });
    const sitClaim = sitHover?.desk ? desksCtl?.claimOf(sitHover.desk.id) : undefined;
    const openVisit = Boolean(
      sitClaim &&
        sitClaim.peerId !== selfId &&
        sitClaim.privacy === "open" &&
        !blocked.has(sitClaim.peerId) &&
        !blockedBy.has(sitClaim.peerId),
    );
    const canSit = Boolean(
      sitHover &&
        !sitHover.occupied &&
        !openVisit &&
        (!sitHover.desk || (sitClaim && sitClaim.peerId === selfId)),
    );
    if (personHover) {
      /* whisper hover already set */
    } else if (sitHover?.occupied && !openVisit) {
      status.textContent = "seat taken";
    } else if (canSit && sitHover) {
      status.textContent =
        sitHover.type === "beanbag"
          ? "beanbag · sit"
          : sitHover.type === "couch" || sitHover.type.includes("sofa")
            ? "couch · sit"
            : "chair · sit";
    } else if (hit && !status.textContent?.startsWith("loading")) {
      if ((kind === "conference" || kind === "library") && col !== undefined && row !== undefined) {
        status.textContent = confHoverLabel?.(col, row) ?? (kind === "library" ? "Library" : "conference");
      } else {
        const who = desk ? desksCtl?.label(desk) : null;
        status.textContent = who ? `${kind} · ${who}` : kind ?? "";
      }
    }
    updateOfficePeek(desk ?? null, kind);
  }

  renderer.render(scene, camera);
}

function loop() {
  tick(true);
  raf = requestAnimationFrame(loop);
}

function setBackgroundSim(on: boolean) {
  if (on) {
    if (!bgTick) bgTick = window.setInterval(() => tick(false), 250);
    return;
  }
  if (bgTick) {
    window.clearInterval(bgTick);
    bgTick = 0;
  }
}

document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    if (raf) {
      cancelAnimationFrame(raf);
      raf = 0;
    }
    setBackgroundSim(true);
    return;
  }
  setBackgroundSim(false);
  if (!raf) raf = requestAnimationFrame(loop);
});

loop();
