import { readFileSync } from "node:fs";
import type { IncomingMessage, Server } from "node:http";
import { dirname, resolve } from "node:path";
import type { Duplex } from "node:stream";
import { fileURLToPath } from "node:url";
import type { Plugin, ViteDevServer } from "vite";
import { WebSocket, WebSocketServer } from "ws";
import { clampLook } from "../src/avatarLook";
import {
  MAX_ID,
  MAX_NAME,
  ROOM_PATH,
  type ChatChannel,
  type Claim,
  type ClientMsg,
  type ConferenceReservation,
  type DeskKind,
  type OfficeAd,
  type Peer,
  type Pose,
  type ServerMsg,
  clampCompany,
  clampPrivacy,
  clampProfileUrl,
} from "../src/protocol";
import { FIRST_FLOOR, groupClaimsByFloor, selectableFloors, sameFloors } from "../src/floors";
import { officeAdForPeer, setUserBlock, userBlocks, userIdForToken, whoBlocked } from "./auth";
import { isDirectLoopback } from "./net";
import { PING_MS, RECOVERY_MS, nextPingSample } from "../src/linkHealth";
import { clockZone, countryFrom, holdShift, isFloorBot, noteClose, noteHello, noteShiftHold, startPresenceTick, stopPresenceTick } from "./presence";
import {
  joinReservation,
  knownConferenceIds,
  listReservations,
  liveReservation,
  tryCancel,
  tryReserve,
  trySetAccess,
  viewReservation,
} from "./reservations";

type Slot = {
  ws: WebSocket;
  peer: Peer;
  signedIn: boolean;
  blocked: Set<string>;
  chatAvailable: boolean;
};

type WhisperPair = {
  a: string;
  b: string;
  open: boolean;
  pendingFrom?: string;
  pendingName?: string;
  pendingText?: string;
};

const rooms = new Map<string, Map<string, Slot>>();
const claimsByRoom = new Map<string, Map<string, Claim>>();
const whispersByRoom = new Map<string, Map<string, WhisperPair>>();
const seatsByRoom = new Map<string, Map<string, string>>();
const REPLACED = 4001;

type DeskFootprint = { id: string; col: number; row: number; cols: number; rows: number };

function loadDeskFootprints(): {
  cell: number;
  desks: DeskFootprint[];
  officeIds: string[];
  fixtureIds: string[];
} {
  try {
    const raw = JSON.parse(
      readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "../data/floor-plate.json"), "utf8"),
    ) as {
      grid?: { cellSize?: number };
      offices?: DeskFootprint[];
      cubicles?: DeskFootprint[];
      avatars?: { officeId?: string }[];
    };
    const cell = Number(raw.grid?.cellSize) || 179;
    const offices = raw.offices ?? [];
    const desks = [...offices, ...(raw.cubicles ?? [])].map((desk) => ({
      id: String(desk.id),
      col: Number(desk.col) || 0,
      row: Number(desk.row) || 0,
      cols: Number(desk.cols) || 1,
      rows: Number(desk.rows) || 1,
    }));
    const officeIds = offices.map((desk) => String(desk.id)).filter(Boolean);
    const fixtureIds = (raw.avatars ?? [])
      .map((avatar) => String(avatar.officeId ?? ""))
      .filter((id) => id && officeIds.includes(id));
    return { cell, desks, officeIds, fixtureIds };
  } catch {
    return { cell: 179, desks: [], officeIds: [], fixtureIds: [] };
  }
}

const { cell: CELL, desks: DESKS, officeIds: OFFICE_IDS, fixtureIds: FIXTURE_IDS } = loadDeskFootprints();

type ConfFootprint = { id: string; col: number; row: number; cols: number; rows: number };

function loadConferenceFootprints(): ConfFootprint[] {
  try {
    const raw = JSON.parse(
      readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "../data/floor-plate.json"), "utf8"),
    ) as { conferences?: ConfFootprint[] };
    return (raw.conferences ?? [])
      .map((room) => ({
        id: String(room.id ?? ""),
        col: Number(room.col) || 0,
        row: Number(room.row) || 0,
        cols: Number(room.cols) || 1,
        rows: Number(room.rows) || 1,
      }))
      .filter((room) => room.id);
  } catch {
    return [];
  }
}

const CONFERENCES = loadConferenceFootprints();
/** buildingId → reservationId → peer ids who redeemed the code */
const confAdmitted = new Map<string, Map<string, Set<string>>>();
/** buildingId → conferenceId → last live reservation snapshot */
const confLastLive = new Map<string, Map<string, { id: string; access: "open" | "code" } | null>>();
let confSweep: ReturnType<typeof setInterval> | null = null;
let linkSweep: ReturnType<typeof setInterval> | null = null;

type LinkHealth = {
  alive: boolean;
  misses: number;
  lastPongAt: number;
  recovering: boolean;
  /** Close from a missed-pong recovery. Keep the shift until hello or the window ends. */
  quietClose: boolean;
};

type Recovery = {
  roomId: string;
  peerId: string;
  ws: WebSocket;
  until: number;
};

const linkHealth = new WeakMap<WebSocket, LinkHealth>();
const recoveries = new Map<string, Recovery>();

function healthOf(ws: WebSocket) {
  let health = linkHealth.get(ws);
  if (!health) {
    health = { alive: true, misses: 0, lastPongAt: Date.now(), recovering: false, quietClose: false };
    linkHealth.set(ws, health);
  }
  return health;
}

function noteSocketContact(ws: WebSocket) {
  const health = healthOf(ws);
  health.alive = true;
  health.misses = 0;
  health.lastPongAt = Date.now();
}

function recoveryKey(roomId: string, peerId: string) {
  return `${roomId}\0${peerId}`;
}

function loadQuietCells(): Set<string> {
  const cells = new Set<string>();
  const key = (col: number, row: number) => `${col},${row}`;
  try {
    const raw = JSON.parse(
      readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "../data/floor-plate.json"), "utf8"),
    ) as {
      cells?: string[];
      legend?: Record<string, string>;
      libraries?: { col?: number; row?: number; cols?: number; rows?: number }[];
    };
    const lines = raw.cells ?? [];
    for (let row = 0; row < lines.length; row++) {
      const line = lines[row] ?? "";
      for (let col = 0; col < line.length; col++) {
        const ch = line[col];
        if (ch === "L" || raw.legend?.[ch] === "library") cells.add(key(col, row));
      }
    }
    for (const room of raw.libraries ?? []) {
      const col0 = Number(room.col) || 0;
      const row0 = Number(room.row) || 0;
      const cols = Number(room.cols) || 1;
      const rows = Number(room.rows) || 1;
      for (let dc = 0; dc < cols; dc++) {
        for (let dr = 0; dr < rows; dr++) cells.add(key(col0 + dc, row0 + dr));
      }
    }
  } catch {
    /* plate missing */
  }
  return cells;
}

const QUIET_CELLS = loadQuietCells();

function peerCell(peer: Peer) {
  const col = peer.col ?? Math.floor(peer.x / CELL);
  const row = peer.row ?? Math.floor(peer.y / CELL);
  return { col, row };
}

function inQuietZone(peer: Peer) {
  const { col, row } = peerCell(peer);
  return QUIET_CELLS.has(`${col},${row}`);
}

function deskAt(col: number, row: number) {
  for (const desk of DESKS) {
    if (col >= desk.col && col < desk.col + desk.cols && row >= desk.row && row < desk.row + desk.rows) {
      return desk.id;
    }
  }
  return null;
}

function peerDesk(peer: Peer) {
  const col = peer.col ?? Math.floor(peer.x / CELL);
  const row = peer.row ?? Math.floor(peer.y / CELL);
  return deskAt(col, row);
}

function conferenceAt(col: number, row: number) {
  for (const room of CONFERENCES) {
    if (col >= room.col && col < room.col + room.cols && row >= room.row && row < room.row + room.rows) {
      return room;
    }
  }
  return null;
}

function peerConference(peer: Peer) {
  const { col, row } = peerCell(peer);
  return conferenceAt(col, row);
}

function peerChatRoom(peer: Peer) {
  return peerDesk(peer) ?? peerConference(peer)?.id ?? null;
}

function admittedOf(buildingId: string) {
  let map = confAdmitted.get(buildingId);
  if (!map) {
    map = new Map();
    confAdmitted.set(buildingId, map);
  }
  return map;
}

function admittedPeers(buildingId: string, reservationId: string) {
  const map = admittedOf(buildingId);
  let set = map.get(reservationId);
  if (!set) {
    set = new Set();
    map.set(reservationId, set);
  }
  return set;
}

function viewerAdmitted(buildingId: string, peerId: string) {
  const out = new Set<string>();
  for (const [reservationId, peers] of admittedOf(buildingId)) {
    if (peers.has(peerId)) out.add(reservationId);
  }
  return out;
}

function canStayInConference(buildingId: string, peer: Peer, confId: string) {
  const live = liveReservation(confId);
  if (!live) return true;
  if (live.access !== "code") return true;
  if (live.peerId === peer.id) return true;
  return admittedPeers(buildingId, live.id).has(peer.id);
}

function hallwayOf(conf: ConfFootprint) {
  return {
    x: (conf.col + conf.cols / 2) * CELL,
    y: (conf.row + conf.rows) * CELL + CELL / 2,
  };
}

function publishReservations(room: Map<string, Slot>, buildingId: string) {
  const list = listReservations();
  for (const dest of room.values()) {
    send(dest.ws, {
      type: "reservations",
      reservations: list.map((row) =>
        viewReservation(row, dest.peer.id, viewerAdmitted(buildingId, dest.peer.id)),
      ),
    });
  }
}

function publishReserve(room: Map<string, Slot>, buildingId: string, reservation: ConferenceReservation) {
  for (const dest of room.values()) {
    send(dest.ws, {
      type: "reserve",
      reservation: viewReservation(
        reservation,
        dest.peer.id,
        viewerAdmitted(buildingId, dest.peer.id),
      ),
    });
  }
}

function kickFromConference(
  room: Map<string, Slot>,
  buildingId: string,
  slot: Slot,
  conf: ConfFootprint,
  reason: "ended" | "denied",
) {
  releaseSeat(buildingId, slot.peer.id);
  const hall = hallwayOf(conf);
  slot.peer.x = hall.x;
  slot.peer.y = hall.y;
  slot.peer.col = Math.floor(hall.x / CELL);
  slot.peer.row = Math.floor(hall.y / CELL);
  slot.peer.pose = "stand";
  delete slot.peer.seatId;
  delete slot.peer.seatY;
  send(slot.ws, { type: "conf-kick", roomId: conf.id, reason });
  broadcastFloor(room, peerFloor(slot.peer), null, { type: "state", id: slot.peer.id, ...slot.peer });
}

function sweepConferenceRooms() {
  const list = listReservations();
  for (const [buildingId, room] of rooms) {
    let last = confLastLive.get(buildingId);
    if (!last) {
      last = new Map();
      confLastLive.set(buildingId, last);
    }
    for (const conf of CONFERENCES) {
      const live = liveReservation(conf.id, Date.now(), list);
      const prev = last.get(conf.id) ?? null;
      last.set(conf.id, live ? { id: live.id, access: live.access } : null);
      const codeEnded = Boolean(prev && prev.access === "code" && prev.id !== live?.id && !live);
      for (const slot of room.values()) {
        if (peerConference(slot.peer)?.id !== conf.id) continue;
        if (codeEnded) {
          kickFromConference(room, buildingId, slot, conf, "ended");
          continue;
        }
        if (!canStayInConference(buildingId, slot.peer, conf.id)) {
          kickFromConference(room, buildingId, slot, conf, "denied");
        }
      }
    }
  }
}

function admitPeopleInRoom(
  room: Map<string, Slot>,
  buildingId: string,
  reservation: ConferenceReservation,
) {
  const set = admittedPeers(buildingId, reservation.id);
  set.add(reservation.peerId);
  for (const slot of room.values()) {
    if (peerConference(slot.peer)?.id === reservation.roomId) set.add(slot.peer.id);
  }
}

function peerFloor(peer: Peer) {
  const n = Math.trunc(Number(peer.floor) || FIRST_FLOOR);
  return n >= FIRST_FLOOR ? n : FIRST_FLOOR;
}

function claimKey(floor: number, deskId: string) {
  return `${floor}:${deskId}`;
}

function sendToDesk(room: Map<string, Slot>, deskId: string, floor: number, msg: ServerMsg) {
  const raw = JSON.stringify(msg);
  for (const slot of room.values()) {
    if (peerFloor(slot.peer) !== floor) continue;
    if (peerDesk(slot.peer) !== deskId) continue;
    if (slot.ws.readyState === WebSocket.OPEN) slot.ws.send(raw);
  }
}

function sendToChatRoom(
  room: Map<string, Slot>,
  deskId: string,
  floor: number,
  buildingId: string,
  msg: ServerMsg,
) {
  const raw = JSON.stringify(msg);
  for (const slot of room.values()) {
    if (peerFloor(slot.peer) !== floor) continue;
    if (peerChatRoom(slot.peer) !== deskId) continue;
    const conf = peerConference(slot.peer);
    if (conf && !canStayInConference(buildingId, slot.peer, conf.id)) continue;
    if (slot.ws.readyState === WebSocket.OPEN) slot.ws.send(raw);
  }
}

function send(ws: WebSocket, msg: ServerMsg) {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}

function broadcast(room: Map<string, Slot>, skip: string | null, msg: ServerMsg) {
  const raw = JSON.stringify(msg);
  for (const [id, slot] of room) {
    if (skip && id === skip) continue;
    if (slot.ws.readyState === WebSocket.OPEN) slot.ws.send(raw);
  }
}

function broadcastFloor(room: Map<string, Slot>, floor: number, skip: string | null, msg: ServerMsg) {
  const raw = JSON.stringify(msg);
  for (const [id, slot] of room) {
    if (skip && id === skip) continue;
    if (peerFloor(slot.peer) !== floor) continue;
    if (slot.ws.readyState === WebSocket.OPEN) slot.ws.send(raw);
  }
}

function claimFloor(claim: Claim) {
  const n = Math.trunc(Number(claim.floor) || FIRST_FLOOR);
  return n >= FIRST_FLOOR ? n : FIRST_FLOOR;
}

function claimsOnFloor(claims: Map<string, Claim>, floor: number) {
  return [...claims.values()].filter((claim) => claimFloor(claim) === floor);
}

function catalogOf(claims: Map<string, Claim>) {
  const floors = selectableFloors(groupClaimsByFloor(claims.values()), OFFICE_IDS, FIXTURE_IDS);
  return { floors, maxFloor: floors[floors.length - 1] ?? FIRST_FLOOR };
}

function viewOf(room: Map<string, Slot>, claims: Map<string, Claim>, floor: number, selfId: string) {
  const peers = [...room.values()]
    .filter((slot) => slot.peer.id !== selfId && peerFloor(slot.peer) === floor)
    .map((slot) => slot.peer);
  const list = claimsOnFloor(claims, floor);
  return { peers, claims: list, officeAds: adsOf(list) };
}

function claimsOf(roomId: string) {
  let map = claimsByRoom.get(roomId);
  if (!map) {
    map = new Map();
    claimsByRoom.set(roomId, map);
  }
  return map;
}

function whispersOf(roomId: string) {
  let map = whispersByRoom.get(roomId);
  if (!map) {
    map = new Map();
    whispersByRoom.set(roomId, map);
  }
  return map;
}

function pairKey(a: string, b: string) {
  return a < b ? `${a}\n${b}` : `${b}\n${a}`;
}

function otherOf(pair: WhisperPair, id: string) {
  return pair.a === id ? pair.b : pair.a;
}

function claimOfPeer(roomId: string, peerId: string) {
  for (const claim of claimsOf(roomId).values()) {
    if (claim.peerId === peerId) return claim;
  }
  return undefined;
}

function canReceiveWhisper(slot: Slot, roomId: string, fromId: string) {
  if (!slot.chatAvailable) return false;
  if (slot.blocked.has(fromId)) return false;
  const claim = claimOfPeer(roomId, slot.peer.id);
  if (claim && (claim.privacy === "busy" || claim.privacy === "focus")) return false;
  return true;
}

function endWhispersFor(room: Map<string, Slot>, roomId: string, peerId: string, reason: "left" | "ended") {
  const pairs = whispersOf(roomId);
  for (const [key, pair] of [...pairs]) {
    if (pair.a !== peerId && pair.b !== peerId) continue;
    const other = otherOf(pair, peerId);
    pairs.delete(key);
    const dest = room.get(other);
    if (dest) send(dest.ws, { type: "whisper-end", peerId, reason });
    const self = room.get(peerId);
    if (self) send(self.ws, { type: "whisper-end", peerId: other, reason });
  }
}

function kindOfDesk(id: string): DeskKind {
  return id.startsWith("cube") || id.startsWith("cubicle") ? "cubicle" : "office";
}

function adForClaim(peerId: string, deskId: string, kind: DeskKind): OfficeAd | undefined {
  if (kind !== "office") return undefined;
  const ad = officeAdForPeer(peerId);
  if (!ad) return undefined;
  return { deskId, peerId, enabled: true, url: ad.url };
}

function syncClaimAd(claim: Claim) {
  const ad = adForClaim(claim.peerId, claim.deskId, claim.kind);
  if (ad) claim.officeAd = ad;
  else delete claim.officeAd;
  return claim;
}

function adsOf(claims: Iterable<Claim>): OfficeAd[] {
  const list: OfficeAd[] = [];
  for (const claim of claims) {
    if (claim.officeAd?.enabled && claim.officeAd.url) list.push(claim.officeAd);
  }
  return list;
}

function releasePeer(roomId: string, room: Map<string, Slot>, peerId: string) {
  const claims = claimsOf(roomId);
  for (const [key, claim] of claims) {
    if (claim.peerId !== peerId) continue;
    claims.delete(key);
    broadcastFloor(room, claimFloor(claim), null, { type: "release", deskId: claim.deskId, peerId });
  }
}

function publishFloors(room: Map<string, Slot>, claims: Map<string, Claim>) {
  const { floors, maxFloor } = catalogOf(claims);
  for (const slot of room.values()) {
    send(slot.ws, { type: "floors", floor: peerFloor(slot.peer), maxFloor, floors });
  }
}

function clampName(value: unknown) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_NAME);
}

function clampId(value: unknown) {
  const id = String(value ?? "").slice(0, MAX_ID);
  return /^[A-Za-z0-9._:-]+$/.test(id) ? id : "";
}

/** Local fill-floor bots may claim without an account. Direct loopback only.
 *  nginx's connection is also 127.0.0.1, so a public request must not pass. */
function localFillBot(id: string, token: unknown, req: IncomingMessage) {
  if (!id.startsWith("bot-")) return false;
  if (String(token ?? "") !== "haw-fill-floor") return false;
  return isDirectLoopback(req);
}

const CHAT_LIMIT = 12;
const CHAT_WINDOW_MS = 10_000;
const MOVE_LIMIT = 30;
const MOVE_WINDOW_MS = 1_000;
const JOIN_LIMIT = 6;
const JOIN_WINDOW_MS = 30_000;

function allowRate(bucket: WeakMap<WebSocket, { n: number; reset: number }>, ws: WebSocket, limit: number, windowMs: number) {
  const now = Date.now();
  const row = bucket.get(ws);
  if (!row || row.reset < now) {
    bucket.set(ws, { n: 1, reset: now + windowMs });
    return true;
  }
  row.n += 1;
  return row.n <= limit;
}

const chatRate = new WeakMap<WebSocket, { n: number; reset: number }>();
const moveRate = new WeakMap<WebSocket, { n: number; reset: number }>();
const joinRate = new WeakMap<WebSocket, { n: number; reset: number }>();

function num(value: unknown, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function poseOf(msg: Partial<Pose>): Pose {
  const pose = msg.pose === "sit" ? "sit" : "stand";
  const seatId = pose === "sit" ? clampId(msg.seatId) : "";
  const seatY = pose === "sit" && msg.seatY != null ? num(msg.seatY) : undefined;
  return {
    x: num(msg.x),
    y: num(msg.y),
    facing: num(msg.facing),
    pose,
    col: msg.col === undefined ? undefined : num(msg.col),
    row: msg.row === undefined ? undefined : num(msg.row),
    seatId: seatId || undefined,
    seatY: Number.isFinite(seatY) ? seatY : undefined,
  };
}

function seatsOf(roomId: string) {
  let map = seatsByRoom.get(roomId);
  if (!map) {
    map = new Map();
    seatsByRoom.set(roomId, map);
  }
  return map;
}

function seatKey(floor: number, seatId: string) {
  return `${floor}:${seatId}`;
}

function releaseSeat(roomId: string, peerId: string) {
  const seats = seatsOf(roomId);
  for (const [key, id] of seats) {
    if (id === peerId) seats.delete(key);
  }
}

function takeSeat(roomId: string, floor: number, peerId: string, seatId: string) {
  const seats = seatsOf(roomId);
  const key = seatKey(floor, seatId);
  const taken = seats.get(key);
  if (taken && taken !== peerId) return false;
  releaseSeat(roomId, peerId);
  seats.set(key, peerId);
  return true;
}

function dropSlot(roomId: string, room: Map<string, Slot>, peerId: string) {
  const slot = room.get(peerId);
  if (!slot) return;
  const floor = peerFloor(slot.peer);
  endWhispersFor(room, roomId, peerId, "left");
  room.delete(peerId);
  const claims = claimsOf(roomId);
  const before = catalogOf(claims).floors;
  releasePeer(roomId, room, peerId);
  releaseSeat(roomId, peerId);
  broadcastFloor(room, floor, peerId, { type: "leave", id: peerId });
  if (room.size === 0) {
    rooms.delete(roomId);
    claimsByRoom.delete(roomId);
    whispersByRoom.delete(roomId);
    seatsByRoom.delete(roomId);
    return;
  }
  if (!sameFloors(catalogOf(claims).floors, before)) publishFloors(room, claims);
}

function beginRecovery(roomId: string, peerId: string, ws: WebSocket) {
  const key = recoveryKey(roomId, peerId);
  if (recoveries.has(key)) return;
  const health = healthOf(ws);
  if (health.recovering) return;
  health.recovering = true;
  health.quietClose = true;
  holdShift(peerId, ws, health.lastPongAt);
  recoveries.set(key, { roomId, peerId, ws, until: Date.now() + RECOVERY_MS });
  try {
    ws.terminate();
  } catch {
    /* already closed */
  }
}

function expireRecovery(key: string, rec: Recovery) {
  recoveries.delete(key);
  const room = rooms.get(rec.roomId);
  const slot = room?.get(rec.peerId);
  if (!room || !slot || slot.ws !== rec.ws) return;
  noteClose(rec.peerId, rec.ws);
  dropSlot(rec.roomId, room, rec.peerId);
}

function sweepLinks() {
  const now = Date.now();
  for (const [roomId, room] of rooms) {
    for (const [peerId, slot] of [...room]) {
      const health = healthOf(slot.ws);
      if (health.recovering) continue;
      if (slot.ws.readyState !== WebSocket.OPEN) {
        beginRecovery(roomId, peerId, slot.ws);
        continue;
      }
      const step = nextPingSample(health);
      health.misses = step.misses;
      if (step.recover) {
        beginRecovery(roomId, peerId, slot.ws);
        continue;
      }
      health.alive = false;
      try {
        slot.ws.ping();
      } catch {
        beginRecovery(roomId, peerId, slot.ws);
      }
    }
  }
  for (const [key, rec] of [...recoveries]) {
    if (now < rec.until) continue;
    expireRecovery(key, rec);
  }
}

function roomIdOf(req: IncomingMessage) {
  try {
    const url = new URL(req.url ?? ROOM_PATH, "http://localhost");
    const raw = url.searchParams.get("id")?.trim() ?? "";
    return /^[A-Za-z0-9._:-]{1,64}$/.test(raw) ? raw : "floor-1";
  } catch {
    return "floor-1";
  }
}

function attachRoom(httpServer: Server) {
  const flag = "__hawFloorRoom" as const;
  if ((httpServer as Server & { [flag]?: boolean })[flag]) return;
  (httpServer as Server & { [flag]?: boolean })[flag] = true;

  const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });

  const onUpgrade = (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    const path = req.url?.split("?")[0];
    if (path !== ROOM_PATH) return;
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit("connection", ws, req);
    });
  };
  httpServer.prependListener("upgrade", onUpgrade);
  if (!confSweep) confSweep = setInterval(sweepConferenceRooms, 4000);
  if (!linkSweep) {
    linkSweep = setInterval(sweepLinks, PING_MS);
    if (typeof linkSweep === "object" && linkSweep && "unref" in linkSweep) linkSweep.unref();
  }
  startPresenceTick();

  wss.on("connection", (ws: WebSocket, req: IncomingMessage) => {
    healthOf(ws);
    ws.on("pong", () => noteSocketContact(ws));
    const roomId = roomIdOf(req);
    let room = rooms.get(roomId);
    if (!room) {
      room = new Map();
      rooms.set(roomId, room);
    }
    let selfId = "";

    ws.on("message", (data) => {
      noteSocketContact(ws);
      let msg: ClientMsg;
      try {
        msg = JSON.parse(String(data)) as ClientMsg;
      } catch {
        send(ws, { type: "error", message: "bad json" });
        return;
      }
      if (msg.type === "hello") {
        const id = clampId(msg.id);
        const name = clampName(msg.name) || `Guest-${id.slice(0, 4)}`;
        const look = clampLook(msg.look);
        const color = look?.shirt || String(msg.color ?? "#f4a261").slice(0, 16);
        if (!id) {
          send(ws, { type: "error", message: "bad id" });
          return;
        }
        const eth = String(msg.address ?? "").toLowerCase();
        const address = /^0x[a-f0-9]{40}$/.test(eth) ? eth : undefined;
        const claims = claimsOf(roomId);
        if (selfId && selfId !== id) {
          const old = room!.get(selfId);
          if (old && old.ws === ws) {
            const oldFloor = peerFloor(old.peer);
            room!.delete(selfId);
            for (const [key, claim] of [...claims]) {
              if (claim.peerId === id) {
                claims.delete(key);
                broadcastFloor(room!, claimFloor(claim), null, {
                  type: "release",
                  deskId: claim.deskId,
                  peerId: id,
                });
              }
            }
            for (const claim of claims.values()) {
              if (claim.peerId !== selfId) continue;
              claim.peerId = id;
              claim.name = name;
              syncClaimAd(claim);
              broadcastFloor(room!, claimFloor(claim), null, { type: "claim", claim });
            }
            broadcastFloor(room!, oldFloor, null, { type: "leave", id: selfId });
          }
        }
        const token = String(msg.token ?? "").trim();
        const authedId = userIdForToken(token);
        const signedIn = Boolean(authedId && authedId === id) || localFillBot(id, token, req);
        const existing = room!.get(id);
        if (existing && existing.ws !== ws && existing.signedIn && !signedIn) {
          send(ws, { type: "error", message: "taken" });
          return;
        }
        const previous = existing && existing.ws !== ws ? existing.ws : null;
        const ownClaim = [...claims.values()].find((claim) => claim.peerId === id);
        const { floors: openFloors, maxFloor } = catalogOf(claims);
        const wanted = existing?.peer.floor ?? ownClaim?.floor ?? FIRST_FLOOR;
        const stay =
          openFloors.includes(wanted) ||
          (ownClaim && claimFloor(ownClaim) === wanted) ||
          Boolean(existing && peerFloor(existing.peer) === wanted);
        const floor = stay ? wanted : FIRST_FLOOR;
        const sameLink = Boolean(
          existing && (existing.ws === ws || healthOf(existing.ws).recovering),
        );
        const chatAvailable = Boolean(sameLink && existing.chatAvailable);
        const company = clampCompany(msg.company) || undefined;
        const profileUrl = clampProfileUrl(msg.profileUrl) || undefined;
        const peer: Peer = {
          id,
          name,
          color,
          address,
          floor,
          chatAvailable,
          company,
          profileUrl,
          look,
          ...poseOf(msg),
        };
        if (peer.pose === "sit" && peer.seatId) {
          if (!takeSeat(roomId, floor, id, peer.seatId)) {
            peer.pose = "stand";
            delete peer.seatId;
            delete peer.seatY;
          }
        } else {
          releaseSeat(roomId, id);
        }
        selfId = id;
        const blocked = new Set([
          ...(signedIn ? userBlocks(id) : []),
          ...(sameLink && existing ? existing.blocked : []),
        ]);
        room!.set(id, { ws, peer, signedIn, blocked, chatAvailable });
        if (previous) previous.close(REPLACED, "replaced");
        const blockedBy = new Set(signedIn ? whoBlocked(id) : []);
        for (const other of room!.values()) {
          if (other.blocked.has(id)) blockedBy.add(other.peer.id);
        }
        for (const claim of claims.values()) {
          if (claim.peerId === id) syncClaimAd(claim);
        }
        const view = viewOf(room!, claims, floor, id);
        recoveries.delete(recoveryKey(roomId, id));
        const xp = noteHello({
          id,
          ws,
          signedIn,
          bot: isFloorBot(id) || localFillBot(id, token, req),
          tz: clockZone(msg.timezone),
          country: countryFrom(req),
        });
        send(ws, {
          type: "welcome",
          roomId,
          self: peer,
          peers: view.peers,
          claims: view.claims,
          reservations: listReservations().map((row) =>
            viewReservation(row, id, viewerAdmitted(roomId, id)),
          ),
          blocked: [...blocked],
          blockedBy: [...blockedBy],
          officeAds: view.officeAds,
          floor,
          maxFloor,
          floors: openFloors,
          xp,
        });
        if (existing && existing.ws === ws) {
          broadcastFloor(room!, floor, id, { type: "state", id, ...peer });
        } else {
          broadcastFloor(room!, floor, id, { type: "join", peer });
        }
        return;
      }
      const slot = selfId ? room!.get(selfId) : undefined;
      if (!slot || slot.ws !== ws) return;
      const needAccount = () => {
        if (slot.signedIn) return false;
        send(ws, { type: "error", message: "sign-in" });
        return true;
      };
      if (msg.type === "block" || msg.type === "unblock") {
        const target = clampId(msg.id);
        if (!target || target === selfId) return;
        const on = msg.type === "block";
        if (on) slot.blocked.add(target);
        else slot.blocked.delete(target);
        if (slot.signedIn) setUserBlock(selfId, target, on);
        const other = room!.get(target);
        if (other) send(other.ws, { type: on ? "blocked" : "unblocked", byId: selfId });
        if (on) {
          const pairs = whispersOf(roomId);
          const key = pairKey(selfId, target);
          if (pairs.delete(key)) {
            send(ws, { type: "whisper-end", peerId: target, reason: "ended" });
            if (other) send(other.ws, { type: "whisper-end", peerId: selfId, reason: "ended" });
          }
        }
        return;
      }
      if (msg.type === "boot") {
        if (needAccount()) return;
        const mine = [...claimsOf(roomId).values()].find((claim) => claim.peerId === selfId);
        if (!mine) return;
        mine.privacy = "busy";
        const floor = claimFloor(mine);
        broadcastFloor(room!, floor, null, { type: "claim", claim: mine });
        broadcastFloor(room!, floor, null, { type: "boot", deskId: mine.deskId, peerId: selfId });
        return;
      }
      if (msg.type === "move") {
        if (!allowRate(moveRate, ws, MOVE_LIMIT, MOVE_WINDOW_MS)) return;
        const x = num(msg.x, slot.peer.x);
        const y = num(msg.y, slot.peer.y);
        const facing =
          msg.facing !== undefined ? num(msg.facing, slot.peer.facing) : slot.peer.facing;
        slot.peer.x = x;
        slot.peer.y = y;
        slot.peer.facing = facing;
        slot.peer.col = Math.floor(x / CELL);
        slot.peer.row = Math.floor(y / CELL);
        broadcastFloor(room!, peerFloor(slot.peer), selfId, { type: "move", id: selfId, x, y, facing });
        return;
      }
      if (msg.type === "state") {
        if (!allowRate(moveRate, ws, MOVE_LIMIT, MOVE_WINDOW_MS)) return;
        const floor = peerFloor(slot.peer);
        const next = poseOf(msg);
        if (next.pose === "sit" && next.seatId) {
          if (!takeSeat(roomId, floor, selfId, next.seatId)) {
            send(ws, { type: "error", message: "seat taken" });
            return;
          }
        } else {
          releaseSeat(roomId, selfId);
        }
        Object.assign(slot.peer, next, {
          id: slot.peer.id,
          name: slot.peer.name,
          color: slot.peer.color,
          floor,
        });
        broadcastFloor(room!, floor, selfId, { type: "state", id: selfId, ...poseOf(slot.peer) });
        return;
      }
      if (msg.type === "profile") {
        const name = clampName(msg.name);
        if (!name) return;
        const company = clampCompany(msg.company) || undefined;
        const profileUrl = clampProfileUrl(msg.profileUrl) || undefined;
        slot.peer.name = name;
        slot.peer.company = company;
        slot.peer.profileUrl = profileUrl;
        const look = clampLook(msg.look);
        if (look) {
          slot.peer.look = look;
          slot.peer.color = look.shirt;
        }
        broadcast(room!, selfId, {
          type: "profile",
          id: selfId,
          name,
          company,
          profileUrl,
          color: slot.peer.color,
          look: slot.peer.look,
        });
        const claims = claimsOf(roomId);
        for (const claim of claims.values()) {
          if (claim.peerId !== selfId) continue;
          claim.name = name;
          claim.company = company;
          claim.profileUrl = profileUrl;
          broadcastFloor(room!, claimFloor(claim), null, { type: "claim", claim });
        }
        return;
      }
      if (msg.type === "shift-hold") {
        if (!slot.signedIn) noteShiftHold(selfId, ws);
        return;
      }
      if (msg.type === "floor") {
        const claims = claimsOf(roomId);
        const { floors: openFloors, maxFloor } = catalogOf(claims);
        const target = Math.trunc(num(msg.floor, FIRST_FLOOR));
        const from = peerFloor(slot.peer);
        if (target === from) {
          send(ws, { type: "floors", floor: from, maxFloor, floors: openFloors });
          return;
        }
        if (!openFloors.includes(target)) {
          send(ws, { type: "error", message: "no floor" });
          return;
        }
        broadcastFloor(room!, from, selfId, { type: "leave", id: selfId });
        releaseSeat(roomId, selfId);
        slot.peer.floor = target;
        slot.peer.pose = "stand";
        delete slot.peer.seatId;
        delete slot.peer.seatY;
        const view = viewOf(room!, claims, target, selfId);
        send(ws, {
          type: "floor",
          floor: target,
          maxFloor,
          floors: openFloors,
          peers: view.peers,
          claims: view.claims,
          officeAds: view.officeAds,
        });
        broadcastFloor(room!, target, selfId, { type: "join", peer: slot.peer });
        return;
      }
      if (msg.type === "claim") {
        if (needAccount()) return;
        const deskId = clampId(msg.deskId);
        if (!deskId) {
          send(ws, { type: "error", message: "bad desk" });
          return;
        }
        const floor = peerFloor(slot.peer);
        const claims = claimsOf(roomId);
        const key = claimKey(floor, deskId);
        const taken = claims.get(key);
        if (taken && taken.peerId !== selfId) {
          send(ws, { type: "error", message: "taken", deskId });
          return;
        }
        const before = catalogOf(claims).floors;
        releasePeer(roomId, room!, selfId);
        const tz = String(msg.timezone ?? "").trim().slice(0, 64);
        const claim: Claim = {
          deskId,
          kind: kindOfDesk(deskId),
          peerId: selfId,
          name: slot.peer.name,
          privacy: "open",
          since: Date.now(),
          floor,
          timezone: tz || undefined,
          company: slot.peer.company,
          profileUrl: slot.peer.profileUrl,
        };
        syncClaimAd(claim);
        if (selfId.startsWith("bot-") && slot.signedIn && claim.kind === "office" && !claim.officeAd) {
          claim.officeAd = {
            deskId,
            peerId: selfId,
            enabled: true,
            url: `fill-ad:${deskId}`,
          };
        }
        claims.set(key, claim);
        broadcastFloor(room!, floor, null, { type: "claim", claim });
        if (claim.officeAd) {
          broadcastFloor(room!, floor, null, {
            type: "office-ad",
            ad: claim.officeAd,
            deskId,
            peerId: selfId,
          });
        }
        if (!sameFloors(catalogOf(claims).floors, before)) publishFloors(room!, claims);
        return;
      }
      if (msg.type === "release") {
        const claims = claimsOf(roomId);
        const before = catalogOf(claims).floors;
        releasePeer(roomId, room!, selfId);
        if (!sameFloors(catalogOf(claims).floors, before)) publishFloors(room!, claims);
        return;
      }
      if (msg.type === "office-ad") {
        if (needAccount()) return;
        const claims = claimsOf(roomId);
        const mine = [...claims.values()].find((claim) => claim.peerId === selfId);
        if (!mine || mine.kind !== "office") {
          send(ws, { type: "office-ad", ad: null, deskId: mine?.deskId ?? "", peerId: selfId });
          return;
        }
        syncClaimAd(mine);
        const floor = claimFloor(mine);
        broadcastFloor(room!, floor, null, { type: "claim", claim: mine });
        broadcastFloor(room!, floor, null, {
          type: "office-ad",
          ad: mine.officeAd ?? null,
          deskId: mine.deskId,
          peerId: selfId,
        });
        return;
      }
      if (msg.type === "timezone") {
        const tz = msg.tz == null ? "" : String(msg.tz).trim().slice(0, 64);
        for (const claim of claimsOf(roomId).values()) {
          if (claim.peerId !== selfId) continue;
          if (tz) claim.timezone = tz;
          else delete claim.timezone;
          broadcastFloor(room!, claimFloor(claim), null, { type: "claim", claim });
        }
        return;
      }
      if (msg.type === "privacy") {
        if (needAccount()) return;
        const privacy = clampPrivacy(msg.privacy);
        for (const claim of claimsOf(roomId).values()) {
          if (claim.peerId !== selfId) continue;
          claim.privacy = privacy;
          const floor = claimFloor(claim);
          broadcastFloor(room!, floor, null, { type: "claim", claim });
          if (privacy === "focus" || privacy === "busy") {
            broadcastFloor(room!, floor, null, { type: "boot", deskId: claim.deskId, peerId: selfId });
          }
        }
        return;
      }
      if (msg.type === "chat-available") {
        const on = Boolean(msg.on);
        slot.chatAvailable = on;
        slot.peer.chatAvailable = on;
        broadcast(room!, null, { type: "chat-available", id: selfId, on });
        return;
      }
      if (msg.type === "whisper") {
        if (!allowRate(chatRate, ws, CHAT_LIMIT, CHAT_WINDOW_MS)) {
          send(ws, { type: "error", message: "slow down" });
          return;
        }
        if (inQuietZone(slot.peer)) {
          send(ws, { type: "error", message: "quiet — library" });
          return;
        }
        const toId = clampId(msg.toId);
        const text = String(msg.text ?? "")
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, 200);
        if (!toId || toId === selfId) return;
        const dest = room!.get(toId);
        if (!dest || dest.blocked.has(selfId)) {
          send(ws, { type: "error", message: "not available for whispers" });
          return;
        }
        const pairs = whispersOf(roomId);
        const key = pairKey(selfId, toId);
        const existingPair = pairs.get(key);
        if (existingPair?.open) {
          if (!text) return;
          const payload = {
            type: "whisper" as const,
            id: selfId,
            name: slot.peer.name,
            text,
            peerId: toId,
          };
          send(ws, { ...payload, peerId: toId });
          send(dest.ws, { ...payload, peerId: selfId });
          return;
        }
        if (!canReceiveWhisper(dest, roomId, selfId)) {
          send(ws, { type: "error", message: "not available for whispers" });
          return;
        }
        if (existingPair?.pendingFrom === toId) {
          const theirs = existingPair.pendingText ?? "";
          existingPair.open = true;
          existingPair.pendingFrom = undefined;
          existingPair.pendingName = undefined;
          existingPair.pendingText = undefined;
          send(ws, { type: "whisper-open", peerId: toId, name: dest.peer.name });
          send(dest.ws, { type: "whisper-open", peerId: selfId, name: slot.peer.name });
          if (theirs) {
            send(ws, { type: "whisper", id: toId, name: dest.peer.name, text: theirs, peerId: toId });
            send(dest.ws, { type: "whisper", id: toId, name: dest.peer.name, text: theirs, peerId: selfId });
          }
          send(ws, { type: "whisper", id: selfId, name: slot.peer.name, text, peerId: toId });
          send(dest.ws, { type: "whisper", id: selfId, name: slot.peer.name, text, peerId: selfId });
          return;
        }
        if (existingPair?.pendingFrom === selfId) {
          existingPair.pendingText = text;
          existingPair.pendingName = slot.peer.name;
          send(dest.ws, { type: "whisper-request", fromId: selfId, fromName: slot.peer.name, text });
          return;
        }
        pairs.set(key, {
          a: selfId < toId ? selfId : toId,
          b: selfId < toId ? toId : selfId,
          open: false,
          pendingFrom: selfId,
          pendingName: slot.peer.name,
          pendingText: text,
        });
        send(dest.ws, { type: "whisper-request", fromId: selfId, fromName: slot.peer.name, text });
        return;
      }
      if (msg.type === "whisper-reply") {
        const fromId = clampId(msg.fromId);
        if (!fromId) return;
        const pairs = whispersOf(roomId);
        const key = pairKey(selfId, fromId);
        const pair = pairs.get(key);
        if (!pair || pair.open || pair.pendingFrom !== fromId) return;
        const other = room!.get(fromId);
        if (!msg.accept) {
          pairs.delete(key);
          send(ws, { type: "whisper-end", peerId: fromId, reason: "declined" });
          if (other) send(other.ws, { type: "whisper-end", peerId: selfId, reason: "declined" });
          return;
        }
        const first = pair.pendingText ?? "";
        const fromName = pair.pendingName || other?.peer.name || fromId.slice(0, 8);
        pair.open = true;
        pair.pendingFrom = undefined;
        pair.pendingName = undefined;
        pair.pendingText = undefined;
        send(ws, { type: "whisper-open", peerId: fromId, name: fromName });
        if (other) send(other.ws, { type: "whisper-open", peerId: selfId, name: slot.peer.name });
        if (first) {
          send(ws, { type: "whisper", id: fromId, name: fromName, text: first, peerId: fromId });
          if (other) send(other.ws, { type: "whisper", id: fromId, name: fromName, text: first, peerId: selfId });
        }
        return;
      }
      if (msg.type === "whisper-end") {
        const target = clampId(msg.peerId ?? "");
        if (!target) {
          endWhispersFor(room!, roomId, selfId, "ended");
          return;
        }
        const pairs = whispersOf(roomId);
        const key = pairKey(selfId, target);
        pairs.delete(key);
        send(ws, { type: "whisper-end", peerId: target, reason: "ended" });
        const other = room!.get(target);
        if (other) send(other.ws, { type: "whisper-end", peerId: selfId, reason: "ended" });
        return;
      }
      if (msg.type === "chat") {
        if (!allowRate(chatRate, ws, CHAT_LIMIT, CHAT_WINDOW_MS)) {
          send(ws, { type: "error", message: "slow down" });
          return;
        }
        if (inQuietZone(slot.peer)) {
          send(ws, { type: "error", message: "quiet — library" });
          return;
        }
        const text = String(msg.text ?? "")
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, 200);
        if (!text) return;
        const floor = peerFloor(slot.peer);
        const channel: ChatChannel = msg.channel === "office" ? "office" : "floor";
        if (channel === "office") {
          const deskId = peerChatRoom(slot.peer);
          if (!deskId) return;
          const conf = peerConference(slot.peer);
          if (conf && !canStayInConference(roomId, slot.peer, conf.id)) return;
          sendToChatRoom(room!, deskId, floor, roomId, {
            type: "chat",
            id: selfId,
            name: slot.peer.name,
            text,
            channel: "office",
            deskId,
          });
          return;
        }
        const payload: ServerMsg = {
          type: "chat",
          id: selfId,
          name: slot.peer.name,
          text,
          channel: "floor",
        };
        const raw = JSON.stringify(payload);
        for (const dest of room!.values()) {
          if (peerFloor(dest.peer) !== floor) continue;
          if (inQuietZone(dest.peer)) continue;
          if (dest.ws.readyState === WebSocket.OPEN) dest.ws.send(raw);
        }
        return;
      }
      if (msg.type === "knock") {
        if (needAccount()) return;
        const deskId = clampId(msg.deskId);
        const floor = peerFloor(slot.peer);
        const claim = deskId ? claimsOf(roomId).get(claimKey(floor, deskId)) : undefined;
        if (!claim || claim.peerId === selfId) return;
        if (claim.privacy === "open" || claim.privacy === "focus") return;
        const occ = room!.get(claim.peerId);
        if (!occ || occ.blocked.has(selfId) || peerFloor(occ.peer) !== floor) return;
        send(occ.ws, {
          type: "knock",
          deskId: claim.deskId,
          fromId: selfId,
          fromName: slot.peer.name,
        });
        return;
      }

      if (msg.type === "reserve") {
        if (needAccount()) return;
        const conferenceIds = knownConferenceIds();
        const roomKey = String(msg.roomId ?? "").trim();
        if (!conferenceIds.has(roomKey)) {
          send(ws, { type: "error", message: "unknown conference room" });
          return;
        }
        const result = tryReserve({
          roomId: roomKey,
          peerId: selfId,
          name: slot.peer.name,
          day: String(msg.day ?? ""),
          startMin: Number(msg.startMin),
          durationMin: Number(msg.durationMin),
          access: msg.access === "code" ? "code" : "open",
        });
        if (!result.ok) {
          send(ws, { type: "error", message: result.error });
          return;
        }
        if (result.reservation.access === "code") {
          admitPeopleInRoom(room!, roomId, result.reservation);
        }
        publishReserve(room!, roomId, result.reservation);
        sweepConferenceRooms();
        return;
      }
      if (msg.type === "cancel-reserve") {
        if (needAccount()) return;
        const result = tryCancel(String(msg.id ?? ""), selfId);
        if (!result.ok) {
          send(ws, { type: "error", message: result.error });
          return;
        }
        admittedOf(roomId).delete(result.id);
        broadcast(room!, null, { type: "cancel-reserve", id: result.id });
        sweepConferenceRooms();
        return;
      }
      if (msg.type === "conf-access") {
        if (needAccount()) return;
        const result = trySetAccess(
          String(msg.id ?? ""),
          selfId,
          msg.access === "code" ? "code" : "open",
        );
        if (!result.ok) {
          send(ws, { type: "error", message: result.error });
          return;
        }
        if (result.reservation.access === "code") {
          admitPeopleInRoom(room!, roomId, result.reservation);
        } else {
          admittedOf(roomId).delete(result.reservation.id);
        }
        publishReserve(room!, roomId, result.reservation);
        sweepConferenceRooms();
        return;
      }
      if (msg.type === "conf-boot") {
        if (needAccount()) return;
        const roomKey = String(msg.roomId ?? "").trim();
        const targetId = clampId(msg.peerId);
        if (!roomKey || !targetId || targetId === selfId) return;
        const live = liveReservation(roomKey);
        if (!live || live.peerId !== selfId) {
          send(ws, { type: "error", message: "not your meeting" });
          return;
        }
        const dest = room!.get(targetId);
        const conf = dest ? peerConference(dest.peer) : null;
        if (!dest || conf?.id !== roomKey) {
          send(ws, { type: "error", message: "they're not in this room" });
          return;
        }
        admittedPeers(roomId, live.id).delete(targetId);
        kickFromConference(room!, roomId, dest, conf, "denied");
        return;
      }
      if (msg.type === "conf-join") {
        if (!allowRate(joinRate, ws, JOIN_LIMIT, JOIN_WINDOW_MS)) {
          send(ws, { type: "error", message: "slow down" });
          return;
        }
        const roomKey = String(msg.roomId ?? "").trim();
        const result = joinReservation(roomKey, String(msg.code ?? ""));
        if (!result.ok) {
          send(ws, { type: "error", message: result.error });
          return;
        }
        admittedPeers(roomId, result.reservation.id).add(selfId);
        send(ws, { type: "conf-admit", reservationId: result.reservation.id, roomId: roomKey });
        send(ws, {
          type: "reserve",
          reservation: viewReservation(
            result.reservation,
            selfId,
            viewerAdmitted(roomId, selfId),
          ),
        });
        return;
      }
      if (msg.type === "knock-reply") {
        if (needAccount()) return;
        const fromId = clampId(msg.fromId);
        const mine = [...claimsOf(roomId).values()].find((claim) => claim.peerId === selfId);
        if (!mine || !fromId) return;
        const accept = Boolean(msg.accept);
        if (accept) {
          mine.privacy = "open";
          broadcastFloor(room!, claimFloor(mine), null, { type: "claim", claim: mine });
        }
        const reply = {
          type: "knock-reply" as const,
          fromId,
          accept,
          deskId: mine.deskId,
        };
        send(ws, reply);
        const knocker = room!.get(fromId);
        if (knocker) send(knocker.ws, reply);
      }
    });

    ws.on("close", () => {
      if (healthOf(ws).quietClose) return;
      if (selfId) {
        recoveries.delete(recoveryKey(roomId, selfId));
        noteClose(selfId, ws);
      }
      const slot = selfId ? room!.get(selfId) : undefined;
      if (!slot || slot.ws !== ws) return;
      dropSlot(roomId, room!, selfId);
    });
  });

  httpServer.on("close", () => {
    httpServer.off("upgrade", onUpgrade);
    if (confSweep) {
      clearInterval(confSweep);
      confSweep = null;
    }
    if (linkSweep) {
      clearInterval(linkSweep);
      linkSweep = null;
    }
    recoveries.clear();
    stopPresenceTick();
  });
}

export function floorRoomPlugin(): Plugin {
  return {
    name: "floor-room",
    configureServer(server: ViteDevServer) {
      if (server.httpServer) attachRoom(server.httpServer);
      return () => {
        if (server.httpServer) attachRoom(server.httpServer);
      };
    },
    configurePreviewServer(server) {
      if (server.httpServer) attachRoom(server.httpServer);
    },
  };
}
