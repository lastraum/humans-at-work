import "./style.css";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import plateJson from "../data/floor-plate.json";
import { createAvatar, createAvatars, setAvatarName, setNameTagVisible } from "./createAvatars";
import {
  createConferences,
  createCubicles,
  createLibraries,
  createOffices,
  createRecreations,
} from "./createOffice";
import { createGround, createWallsAndDoors } from "./createPlate";
import { attachCameraPan } from "./cameraPan";
import { attachDesks, type Desk } from "./desks";
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
import type { Privacy } from "./protocol";
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
  conferenceAtCell,
  nextBookingLabel,
  pickConferenceGroup,
  ptDayKey,
  shareTimezone,
} from "./conferenceReserve";
import { compressOfficeAd } from "./officeAdImage";
import type { ConferenceReservation, OfficeAd } from "./protocol";
import { connectWorldChat } from "./worldChat";
import { libraryAtCell, poseInQuietZone, setAmbientSilent } from "./quietZone";
import type { Avatar, FloorPlate } from "./types";

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
const editToggle = document.querySelector<HTMLButtonElement>("#edit-toggle")!;
const zoomReadout = document.querySelector("#zoom-readout")!;
const peekEl = document.querySelector<HTMLElement>("#mac-peek")!;
const peekTitle = document.querySelector("#mac-peek-title")!;
const peekName = document.querySelector("#mac-peek-name")!;
const peekMeta = document.querySelector("#mac-peek-meta")!;
const personCard = document.querySelector<HTMLElement>("#person-card")!;
const personCardTitle = document.querySelector("#person-card-title")!;
const personCardName = document.querySelector("#person-card-name")!;
const personCardMeta = document.querySelector<HTMLElement>("#person-card-meta")!;
const personCardNote = document.querySelector<HTMLElement>("#person-card-note")!;
const personCardActions = document.querySelector<HTMLElement>("#person-card-actions")!;
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
camera.position.set(52, 58, -52);
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
  goSit: (seat: { x: number; y: number; facing: number }) => void;
  goTo: (x: number, y: number, force?: boolean) => boolean;
  stand: () => void;
  moving: () => boolean;
} | null = null;
let camCtl: { update: (dt: number) => void } | null = null;
let clickVfx: { spawn: (x: number, z: number) => void; update: (dt: number) => void } | null =
  null;
let promptCtl: ReturnType<typeof attachOfficePrompt> | null = null;
let livePlate: FloorPlate | null = null;
let leaveArmed = false;
let pendingKnock: Desk | null = null;
let botWaiting = false;
let onBotArrived: (() => void) | null = null;
const BOT_ID = "debug-bot";
let elevX = 0;
let elevZ = 0;
let clockOut: ((home?: boolean) => void) | null = null;
let macCtl: ReturnType<typeof attachMac> | null = null;
let worldChatCtl: ReturnType<typeof connectWorldChat> | null = null;
let remotesCtl: {
  update: (dt: number) => void;
  poses: () => { id: string; name: string; x: number; y: number; col?: number; row?: number }[];
  avatars: () => { id: string; group: THREE.Object3D; col?: number; row?: number }[];
  moving: (id: string) => boolean;
  spawn: (peer: import("./protocol").Peer) => void;
  walkTo: (id: string, x: number, y: number) => void;
  walkToSit: (id: string, seat: { x: number; y: number; facing: number }) => void;
  remove: (id: string) => void;
  clear: () => void;
  pick: (
    camera: THREE.Camera,
    pointer: THREE.Vector2,
  ) => { id: string; name: string; x: number; y: number; distance: number } | null;
} | null = null;
let desksCtl: ReturnType<typeof attachDesks> | null = null;
let projectConfBadges: (() => void) | null = null;
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

    let session = await restoreAccount();
    if (!session) clearAccountEmail();
    const identity = session ? applyAccount(session.user) : ensureIdentity();
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
    selfSignedIn = Boolean(identity.email);
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
    };
    const you = createAvatar(youAvatar, plate, {
      editable: false,
      label: identity.name,
    });
    avatarsRoot.add(you);

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
    const elev = elevatorSpawn(plate);
    const [ex, , ez] = toWorld(elev.x, elev.y, plate);
    elevX = ex;
    elevZ = ez;

    let worldChat: ReturnType<typeof connectWorldChat> | null = null;
    let welcomed = false;
    const officeChatTargets = (deskId: string) => {
      const desk = desks.get(deskId);
      if (!desk) return [];
      const ids: string[] = [];
      for (const pose of remotes.poses()) {
        if (desks.contains(desk, pose) && pose.address) ids.push(pose.address);
      }
      return ids;
    };

    const isSignedIn = () => Boolean(identity.email);
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

    const applyDeskAd = (deskId: string, peerId: string, ad: OfficeAd | null) => {
      const claim = desks.claimOf(deskId);
      if (!claim || claim.peerId !== peerId) return;
      if (ad?.enabled && ad.url) claim.officeAd = ad;
      else delete claim.officeAd;
      desks.apply(claim);
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
    const badgeLayer = document.createElement("div");
    badgeLayer.id = "conf-badges";
    document.body.appendChild(badgeLayer);
    const badgeById = new Map<string, HTMLDivElement>();
    const scratchBox = new THREE.Box3();
    const scratchVec = new THREE.Vector3();
    const paintConfBadges = () => {
      for (const child of conferencesRoot.children) {
        const conf = child.userData?.conference as { id?: string } | undefined;
        if (!conf?.id) continue;
        const label = nextBookingLabel(reservations, conf.id);
        child.userData.confLabel = label;
        let el = badgeById.get(conf.id);
        if (!el) {
          el = document.createElement("div");
          el.className = "conf-badge";
          badgeLayer.appendChild(el);
          badgeById.set(conf.id, el);
        }
        el.textContent = label;
        el.hidden = !label;
        el.dataset.busy = label.startsWith("In use") ? "1" : "0";
      }
    };
    projectConfBadges = () => {
      if (editor.enabled()) {
        badgeLayer.hidden = true;
        return;
      }
      badgeLayer.hidden = false;
      const rect = canvas.getBoundingClientRect();
      const projectBadge = (child: THREE.Object3D, id: string) => {
        const el = badgeById.get(id);
        if (!el || el.hidden) return;
        scratchBox.setFromObject(child);
        scratchBox.getCenter(scratchVec);
        scratchVec.y = scratchBox.max.y + 0.15;
        scratchVec.project(camera);
        const behind = scratchVec.z > 1;
        el.style.display = behind ? "none" : "block";
        if (behind) return;
        const x = (scratchVec.x * 0.5 + 0.5) * rect.width + rect.left;
        const y = (-scratchVec.y * 0.5 + 0.5) * rect.height + rect.top;
        el.style.left = `${x}px`;
        el.style.top = `${y}px`;
      };
      for (const child of conferencesRoot.children) {
        const conf = child.userData?.conference as { id?: string } | undefined;
        if (conf?.id) projectBadge(child, conf.id);
      }
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

    const enterFloor = () => {
      shiftStartedAt = Date.now();
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
            }).then(async (result) => {
              if (!result.ok) {
                setJoinHint(result.error || "Google sign-in failed");
                return;
              }
              const wallet = await ensureSessionWallet(result.token, true);
              await bindSessionWallet(wallet.address);
              guest = wallet;
              session = {
                user: result.user,
                token: result.token,
                address: wallet.address,
                blocked: [...blocked],
                officeAd: officeAdState,
              };
              applyAccount(result.user);
              identity.id = result.user.id;
              identity.name = sanitizeName(result.user.name) || identity.name;
              identity.color = result.user.color || identity.color;
              identity.email = result.user.email;
              identity.address = wallet.address;
              youAvatar.id = identity.id;
              youAvatar.name = identity.name;
              youAvatar.color = identity.color;
              setAvatarName(you, identity.name);
              selfId = identity.id;
              selfName = identity.name;
              selfSignedIn = true;
              finish();
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
          }).then(async (result) => {
            joinVerify.disabled = false;
            if (!result.ok) {
              setJoinHint(result.error || "Couldn't sign in.");
              return;
            }
            const wallet = await ensureSessionWallet(result.token, true);
            await bindSessionWallet(wallet.address);
            guest = wallet;
            session = {
              user: result.user,
              token: result.token,
              address: wallet.address,
              blocked: [...blocked],
              officeAd: officeAdState,
            };
            applyAccount(result.user);
            identity.id = result.user.id;
            identity.name = sanitizeName(result.user.name) || identity.name;
            identity.color = result.user.color || identity.color;
            identity.email = result.user.email;
            identity.address = wallet.address;
            youAvatar.id = identity.id;
            youAvatar.name = identity.name;
            youAvatar.color = identity.color;
            setAvatarName(you, identity.name);
            selfId = identity.id;
            selfName = identity.name;
            selfSignedIn = true;
            finish();
          });
        });
      }
    });

    const room = connectRoom({
      roomId: plate.id,
      identity,
      getToken: () => readToken(),
      getPose: () => playerCtl?.pose() ?? youAvatar,
      onWelcome: (peers, self, claims, mineBlocked, mineBlockedBy, officeAds, floor, openMax, floors) => {
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
          chatAvailable.set(peer.id, Boolean(peer.chatAvailable));
        }
        desks.applyAll(claims);
        for (const ad of officeAds ?? []) applyDeskAd(ad.deskId, ad.peerId, ad);
        paintFloorRoster();
        syncMacDesk();
        paintFloorHud();
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
          chatAvailable.set(peer.id, Boolean(peer.chatAvailable));
        }
        desks.applyAll(view.claims);
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
      onProfile: (id, name) => {
        remotes.rename(id, name);
        desks.rename(id, name);
        mac.renameSpeaker(id, name);
        if (personCard.dataset.id === id) {
          personCard.dataset.name = name;
          personCardName.textContent = name;
        }
        paintFloorRoster();
      },
      onReservations: (list) => {
        reservations = list;
        paintConfBadges();
        confReserve?.refresh();
      },
      onReserve: (reservation) => {
        reservations = [
          ...reservations.filter((row) => row.id !== reservation.id),
          reservation,
        ];
        paintConfBadges();
        confReserve?.refresh();
        if (reservation.peerId === identity.id) {
          status.textContent = `booked ${reservation.day}`;
          confReserve?.hide();
        }
      },
      onCancelReserve: (id) => {
        reservations = reservations.filter((row) => row.id !== id);
        paintConfBadges();
        confReserve?.refresh();
        status.textContent = "reservation canceled";
      },
      onClaim: (claim) => {
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
        mac.addChat(name, text, id === identity.id, channel, deskId, id);
      },
      onChatAvailable: (id, on) => {
        chatAvailable.set(id, on);
        paintFloorRoster();
      },
      onWhisperRequest: (fromId, fromName, text) => {
        if (blocked.has(fromId) || isMuted(fromId)) return;
        mac.addWhisperRequest(fromId, fromName, text);
      },
      onWhisperOpen: (peerId, name) => {
        mac.openWhisper(peerId, name);
      },
      onWhisper: (id, name, text, peerId) => {
        if (isMuted(id) && id !== identity.id) return;
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
        if (peerId === identity.id && mine) {
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
        if (message === "not available to chat" || message === "not available for whispers") {
          macCtl?.failWhisper();
          personNote?.("they're not available for whispers");
          return;
        }
        status.textContent = message;
        const err = document.querySelector("#conf-reserve-error");
        if (err && confReserve?.isOpen()) err.textContent = message;
        confReserve?.refresh();
      },
      onStatus: (text) => {
        if (text === "offline") status.textContent = "offline";
      },
    });

    paintConfBadges();

    confReserve = attachConferenceReserve({
      getReservations: () => reservations,
      getPeerId: () => identity.id,
      isSignedIn,
      askSignIn: askAccount,
      onReserve: (roomId, day, startMin, durationMin) => {
        room.sendReserve(roomId, day, startMin, durationMin);
      },
      onCancel: (id) => {
        room.sendCancelReserve(id);
      },
      onStatus: (text) => {
        status.textContent = text;
      },
    });
    const openConference = (conf: { id: string; col: number; row: number; cols?: number; rows?: number }) => {
      confReserve!.open(conf as any);
      status.textContent = nextBookingLabel(reservations, conf.id) || "conference";
    };

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
      delete personCard.dataset.mode;
      delete personCard.dataset.id;
    };
    personNote = (text: string) => {
      personCardNote.hidden = false;
      personCardNote.textContent = text;
      status.textContent = text;
    };
    inspectPerson = (id: string, name: string) => {
      if (!id || id === identity.id) return;
      personCard.dataset.mode = "inspect";
      personCard.dataset.id = id;
      personCard.dataset.name = name;
      personCardTitle.textContent = "Person";
      personCardName.textContent = name;
      personCardMeta.hidden = true;
      personCardMeta.textContent = personProfile(id);
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
      personCardMeta.hidden = false;
      personCardMeta.textContent = personProfile(id);
      personCardNote.hidden = true;
    });
    document.querySelector("#person-card-whisper")?.addEventListener("click", () => {
      const id = personCard.dataset.id;
      const name = personCard.dataset.name ?? "";
      if (id) beginWhisper(id, name);
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
        editor.enabled() ||
        editor.busy() ||
        !claimShift.hidden ||
        !joinGate.hidden ||
        (!dayEnd.hidden && dayEndMode === "ask") ||
        Boolean(confReserve?.isOpen()),
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
        const sitHit = desks.pickSeat(camera, pointer);
        if (sitHit) {
          const lounge = !sitHit.desk;
          if (!lounge && !isSignedIn()) {
            askAccount("Sign in to sit in an office.");
            return true;
          }
          if (lounge) {
            const [wx, , wz] = toWorld(sitHit.seat.x, sitHit.seat.y, plate);
            prompt.showSit(null, sitHit.seat, wx, wz, sitHit.type);
            return true;
          }
          const desk = sitHit.desk;
          if (!desk) return false;
          const claim = desks.claimOf(desk.id);
          const guest = Boolean(
            claim &&
              claim.peerId !== identity.id &&
              claim.privacy === "open" &&
              !barredFrom(claim.peerId),
          );
          const mine = Boolean(claim && claim.peerId === identity.id);
          if (guest || mine) {
            const [wx, , wz] = toWorld(sitHit.seat.x, sitHit.seat.y, plate);
            prompt.showSit(desk, sitHit.seat, wx, wz, sitHit.type);
            return true;
          }
        }
        if (prompt.kind === "leave") leaveArmed = false;
        pendingKnock = null;
        prompt.hide();
        const confHit = pickConferenceGroup(camera, pointer, conferencesRoot);
        if (confHit) {
          openConference(confHit);
          return true;
        }
        return false;
      },
      consumeClick: ({ col, row, kind }) => {
        if (kind === "conference") {
          const conf = conferenceAtCell(plate, col, row);
          if (!conf) return false;
          openConference(conf);
          return true;
        }
        if (kind !== "office" && kind !== "cube") return false;
        const desk = desks.atCell(col, row);
        if (!desk) return false;
        if (desks.fixture(desk.id)) return false;
        if (!isSignedIn()) {
          askAccount("Sign in to take an office.");
          return true;
        }
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
        if (claim && claim.peerId === identity.id) return claimDesk(desk);
        if (desks.mine(identity.id)) return false;
        showClaimShift(desk);
        return true;
      },
    });
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
        });
        room.sendClaim(desk.id, tz);
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
      playerCtl?.stand();
      playerCtl?.goTo(spawn.x, spawn.y, true);
      const pose = playerCtl?.pose();
      if (pose) {
        const [wx, , wz] = toWorld(pose.x, pose.y, plateNow);
        centerCameraOn(wx, wz);
      }
      status.textContent = "headed home";
    };

    clockOut = (home = false) => {
      const mine = desks.mine(identity.id);
      if (mine) {
        room.sendRelease();
        desks.release(mine.deskId);
      }
      playerCtl?.stand();
      prompt.hide();
      leaveArmed = false;
      syncMacDesk();
      paintFloorRoster();
      if (home) {
        room.sendWhisperEnd();
        macCtl?.endAllWhispers();
        goHome?.();
        shiftStartedAt = null;
        dayEnd.hidden = true;
        document.querySelector("#mac")?.classList.add("collapsed");
        joinGate.hidden = false;
        joinAuth.hidden = true;
        joinActions.hidden = false;
        return;
      }
      dayEnd.hidden = true;
    };

    const syncMacDesk = () => {
      const mine = desks.mine(identity.id);
      mac.setHasDesk(Boolean(mine));
      mac.setPrivacy(mine?.privacy ?? "open");
    };

    const startBotKnock = () => {
      const mine = desks.mine(identity.id);
      const desk = mine ? desks.get(mine.deskId) : undefined;
      if (!mine || !desk) {
        status.textContent = "claim an office first";
        return;
      }
      if (mine.privacy === "open") {
        mine.privacy = "busy";
        desks.apply(mine);
        room.sendPrivacy("busy");
        syncMacDesk();
      }
      remotes.remove(BOT_ID);
      const spawn = elevatorSpawn(plate);
      remotes.spawn({
        id: BOT_ID,
        name: "Bot",
        color: "#8a9aaa",
        x: spawn.x,
        y: spawn.y,
        facing: 0,
        pose: "stand",
        col: spawn.col,
        row: spawn.row,
      });
      const at = desks.approach(desk);
      remotes.walkTo(BOT_ID, at.x, at.y);
      botWaiting = true;
    };

    const sendBotHome = () => {
      const spawn = elevatorSpawn(plate);
      remotes.walkTo(BOT_ID, spawn.x, spawn.y);
      window.setTimeout(() => remotes.remove(BOT_ID), 8000);
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
      const kickBot = hostId === identity.id;
      for (const pose of remotes.poses()) {
        if (pose.id === hostId) continue;
        const inside = desks.contains(desk, pose);
        if (!inside && !(kickBot && pose.id === BOT_ID)) continue;
        remotes.walkTo(pose.id, at.x, at.y);
        if (pose.id === BOT_ID) window.setTimeout(sendBotHome, 1500);
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

    const finishBotKnock = (accept: boolean) => {
      const mine = desks.mine(identity.id);
      const desk = mine ? desks.get(mine.deskId) : undefined;
      if (accept && mine && desk) {
        mine.privacy = "open";
        desks.apply(mine);
        room.sendPrivacy("open");
        syncMacDesk();
        const couch = desks.couchSeat(desk);
        if (couch) remotes.walkToSit(BOT_ID, couch);
        else {
          const inside = fromWorld(desk.group.position.x, desk.group.position.z, plate);
          remotes.walkTo(BOT_ID, inside.x, inside.y);
        }
      } else {
        sendBotHome();
      }
    };

    const paintSelf = () => {
      selfId = identity.id;
      selfName = identity.name;
      selfSignedIn = Boolean(identity.email);
      youAvatar.id = identity.id;
      youAvatar.name = identity.name;
      youAvatar.color = identity.color;
      setAvatarName(you, identity.name);
      macCtl?.setName(identity.name);
      macCtl?.setAccount(identity.email);
    };

    const becomeSignedIn = async (user: { id: string; email: string; name: string; color: string }, token: string) => {
      const oldId = identity.id;
      const wallet = await ensureSessionWallet(token, true);
      await bindSessionWallet(wallet.address);
      guest = wallet;
      session = { user, token, address: wallet.address, blocked: [...blocked], officeAd: officeAdState };
      identity.id = user.id;
      identity.name = sanitizeName(user.name) || identity.name;
      identity.color = user.color || identity.color;
      identity.email = user.email;
      identity.address = wallet.address;
      applyAccount(user);
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
    };

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
      onName: async (raw) => {
        const name = sanitizeName(raw) || identity.name;
        identity.name = name;
        youAvatar.name = name;
        selfName = name;
        saveIdentity(identity);
        setAvatarName(you, name);
        desks.rename(identity.id, name);
        room.sendProfile(name);
        mac.setName(name);
        mac.renameSpeaker(identity.id, name);
        worldChat?.setName(name);
        if (!identity.email) return true;
        const saved = await saveAccountName(name);
        return saved.ok;
      },
      getPrivacy: () => desks.mine(identity.id)?.privacy ?? "open",
      onPrivacy: (privacy: Privacy) => {
        const mine = desks.mine(identity.id);
        if (!mine) return;
        mine.privacy = privacy;
        desks.apply(mine);
        room.sendPrivacy(privacy);
        mac.setPrivacy(privacy);
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
          if (!here) return;
          const dest = officeChatTargets(here.id);
          if (worldChat?.sendChat(text, "office", dest, here.id)) {
            mac.addChat(identity.name, text, true, "office", here.id, identity.id);
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
        if (fromId === BOT_ID) {
          finishBotKnock(accept);
          return;
        }
        room.sendKnockReply(fromId, accept);
        if (accept) syncMacDesk();
      },
      onBlock: (id, on) => setBlock(id, on),
      onDebugKnock: () => startBotKnock(),
      onBoot: () => bootOffice(),
      officeAd: {
        get: () => ({ enabled: officeAdState.enabled, previewUrl: officeAdState.url }),
        setEnabled: async (on) => {
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
        mac.addChat(name, text, fromPeer === identity.id, channel, deskId, fromPeer);
      },
      onStatus: (text) => {
        status.textContent = text;
      },
    });
    worldChatCtl = worldChat;
    onBotArrived = () => {
      if (desks.mine(identity.id)?.privacy === "focus") {
        sendBotHome();
        return;
      }
      mac.showKnock("Bot", BOT_ID);
    };
    syncMacDesk();

    editToggle.addEventListener("click", () => {
      const on = !editor.enabled();
      editor.setEnabled(on);
      document.body.classList.toggle("editing", on);
      editToggle.textContent = on ? "Done" : "Edit";
    });
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
    macCtl?.setChatRoom(here ? here.id : null);
    const quiet = poseInQuietZone(livePlate, you);
    if (quiet !== lastQuiet) {
      lastQuiet = quiet;
      macCtl?.setQuiet(quiet);
      worldChatCtl?.setQuiet(quiet);
      setAmbientSilent(quiet);
    }
  }
  if (botWaiting && remotesCtl && !remotesCtl.moving(BOT_ID)) {
    botWaiting = false;
    onBotArrived?.();
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
    if (atElevator && !playerCtl.moving() && leaveArmed) {
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
  peekMeta.textContent = desksCtl?.mine(selfId) ? "You already have a desk" : "Click to claim · earns XP";
}

function tick(render: boolean) {
  const now = performance.now();
  let dt = (now - lastTick) / 1000;
  lastTick = now;
  if (dt > 8) dt = 8;
  simulate(dt);
  if (!render) return;
  resize();
  controls.update();
  if (playerCtl?.moving() && livePlate) {
    const pose = playerCtl.pose();
    const [wx, , wz] = toWorld(pose.x, pose.y, livePlate);
    centerCameraOn(wx, wz);
  }
  zoomReadout.textContent = `zoom ${camera.zoom.toFixed(2)}`;

  const tiles = scene.getObjectByName("tiles");
  if (tiles) {
    raycaster.setFromCamera(pointer, camera);
    const hit = raycaster.intersectObjects(tiles.children, false)[0];
    const kind = hit?.object.userData.kind as string | undefined;
    const col = hit?.object.userData.col as number | undefined;
    const row = hit?.object.userData.row as number | undefined;
    const desk = kind && col !== undefined && row !== undefined ? desksCtl?.atCell(col, row) : null;
    const personHover = remotesCtl?.pick(camera, pointer);
    if (personHover) {
      canvas.style.cursor = "pointer";
      status.textContent = personHover.name;
    } else {
      canvas.style.cursor = "";
    }
    const sitHover = desksCtl?.pickSeat(camera, pointer);
    const sitClaim = sitHover?.desk ? desksCtl?.claimOf(sitHover.desk.id) : undefined;
    const canSit = Boolean(
      sitHover &&
        (!sitHover.desk ||
          (sitClaim &&
            (sitClaim.peerId === selfId ||
              (sitClaim.peerId !== selfId &&
              sitClaim.privacy === "open" &&
              !blocked.has(sitClaim.peerId) &&
              !blockedBy.has(sitClaim.peerId))))),
    );
    if (personHover) {
      /* whisper hover already set */
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

  projectConfBadges?.();
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
