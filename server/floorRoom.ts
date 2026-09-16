import { readFileSync } from "node:fs";
import type { IncomingMessage, Server } from "node:http";
import { dirname, resolve } from "node:path";
import type { Duplex } from "node:stream";
import { fileURLToPath } from "node:url";
import type { Plugin, ViteDevServer } from "vite";
import { WebSocket, WebSocketServer } from "ws";
import {
  MAX_ID,
  MAX_NAME,
  ROOM_PATH,
  type ChatChannel,
  type Claim,
  type ClientMsg,
  type DeskKind,
  type Peer,
  type Pose,
  type ServerMsg,
  clampPrivacy,
} from "../src/protocol";
import { setUserBlock, userBlocks, userIdForToken, whoBlocked } from "./auth";
import {
  knownConferenceIds,
  listReservations,
  tryCancel,
  tryReserve,
} from "./reservations";

type Slot = {
  ws: WebSocket;
  peer: Peer;
  signedIn: boolean;
  blocked: Set<string>;
};

const rooms = new Map<string, Map<string, Slot>>();
const claimsByRoom = new Map<string, Map<string, Claim>>();
const REPLACED = 4001;

type DeskFootprint = { id: string; col: number; row: number; cols: number; rows: number };

function loadDeskFootprints(): { cell: number; desks: DeskFootprint[] } {
  try {
    const raw = JSON.parse(
      readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "../data/floor-plate.json"), "utf8"),
    ) as {
      grid?: { cellSize?: number };
      offices?: DeskFootprint[];
      cubicles?: DeskFootprint[];
    };
    const cell = Number(raw.grid?.cellSize) || 179;
    const desks = [...(raw.offices ?? []), ...(raw.cubicles ?? [])].map((desk) => ({
      id: String(desk.id),
      col: Number(desk.col) || 0,
      row: Number(desk.row) || 0,
      cols: Number(desk.cols) || 1,
      rows: Number(desk.rows) || 1,
    }));
    return { cell, desks };
  } catch {
    return { cell: 179, desks: [] };
  }
}

const { cell: CELL, desks: DESKS } = loadDeskFootprints();

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

function sendToDesk(room: Map<string, Slot>, deskId: string, msg: ServerMsg) {
  const raw = JSON.stringify(msg);
  for (const slot of room.values()) {
    if (peerDesk(slot.peer) !== deskId) continue;
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

function claimsOf(roomId: string) {
  let map = claimsByRoom.get(roomId);
  if (!map) {
    map = new Map();
    claimsByRoom.set(roomId, map);
  }
  return map;
}

function kindOfDesk(id: string): DeskKind {
  return id.startsWith("cube") || id.startsWith("cubicle") ? "cubicle" : "office";
}

function releasePeer(roomId: string, room: Map<string, Slot>, peerId: string) {
  const claims = claimsOf(roomId);
  for (const [deskId, claim] of claims) {
    if (claim.peerId !== peerId) continue;
    claims.delete(deskId);
    broadcast(room, null, { type: "release", deskId, peerId });
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

function num(value: unknown, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function poseOf(msg: Partial<Pose>): Pose {
  const pose = msg.pose === "sit" ? "sit" : "stand";
  return {
    x: num(msg.x),
    y: num(msg.y),
    facing: num(msg.facing),
    pose,
    col: msg.col === undefined ? undefined : num(msg.col),
    row: msg.row === undefined ? undefined : num(msg.row),
  };
}

function roomIdOf(req: IncomingMessage) {
  try {
    const url = new URL(req.url ?? ROOM_PATH, "http://localhost");
    return url.searchParams.get("id")?.trim() || "floor-1";
  } catch {
    return "floor-1";
  }
}

function attachRoom(httpServer: Server) {
  const flag = "__hawFloorRoom" as const;
  if ((httpServer as Server & { [flag]?: boolean })[flag]) return;
  (httpServer as Server & { [flag]?: boolean })[flag] = true;

  const wss = new WebSocketServer({ noServer: true });

  const onUpgrade = (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    const path = req.url?.split("?")[0];
    if (path !== ROOM_PATH) return;
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit("connection", ws, req);
    });
  };
  httpServer.prependListener("upgrade", onUpgrade);

  wss.on("connection", (ws: WebSocket, req: IncomingMessage) => {
    const roomId = roomIdOf(req);
    let room = rooms.get(roomId);
    if (!room) {
      room = new Map();
      rooms.set(roomId, room);
    }
    let selfId = "";

    ws.on("message", (data) => {
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
        const color = String(msg.color ?? "#f4a261").slice(0, 16);
        if (!id) {
          send(ws, { type: "error", message: "bad id" });
          return;
        }
        const eth = String(msg.address ?? "").toLowerCase();
        const address = /^0x[a-f0-9]{40}$/.test(eth) ? eth : undefined;
        const peer: Peer = { id, name, color, address, ...poseOf(msg) };
        const claims = claimsOf(roomId);
        if (selfId && selfId !== id) {
          const old = room!.get(selfId);
          if (old && old.ws === ws) {
            room!.delete(selfId);
            for (const [deskId, claim] of [...claims]) {
              if (claim.peerId === id) {
                claims.delete(deskId);
                broadcast(room!, null, { type: "release", deskId, peerId: id });
              }
            }
            for (const claim of claims.values()) {
              if (claim.peerId !== selfId) continue;
              claim.peerId = id;
              claim.name = name;
              broadcast(room!, null, { type: "claim", claim });
            }
            broadcast(room!, null, { type: "leave", id: selfId });
          }
        }
        const token = String(msg.token ?? "").trim();
        const authedId = userIdForToken(token);
        const signedIn = Boolean(authedId && authedId === id);
        const existing = room!.get(id);
        const previous = existing && existing.ws !== ws ? existing.ws : null;
        selfId = id;
        const blocked = new Set([
          ...(signedIn ? userBlocks(id) : []),
          ...(existing && existing.ws === ws ? existing.blocked : []),
        ]);
        room!.set(id, { ws, peer, signedIn, blocked });
        if (previous) previous.close(REPLACED, "replaced");
        const others = [...room!.values()]
          .filter((slot) => slot.peer.id !== id)
          .map((slot) => slot.peer);
        const blockedBy = new Set(signedIn ? whoBlocked(id) : []);
        for (const other of room!.values()) {
          if (other.blocked.has(id)) blockedBy.add(other.peer.id);
        }
        send(ws, {
          type: "welcome",
          roomId,
          self: peer,
          peers: others,
          claims: [...claims.values()],
          reservations: listReservations(),
          blocked: [...blocked],
          blockedBy: [...blockedBy],
        });
        if (existing && existing.ws === ws) broadcast(room!, id, { type: "state", id, ...peer });
        else broadcast(room!, id, { type: "join", peer });
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
        return;
      }
      if (msg.type === "boot") {
        if (needAccount()) return;
        const mine = [...claimsOf(roomId).values()].find((claim) => claim.peerId === selfId);
        if (!mine) return;
        mine.privacy = "busy";
        broadcast(room!, null, { type: "claim", claim: mine });
        broadcast(room!, null, { type: "boot", deskId: mine.deskId, peerId: selfId });
        return;
      }
      if (msg.type === "move") {
        const x = num(msg.x, slot.peer.x);
        const y = num(msg.y, slot.peer.y);
        const facing =
          msg.facing !== undefined ? num(msg.facing, slot.peer.facing) : slot.peer.facing;
        slot.peer.x = x;
        slot.peer.y = y;
        slot.peer.facing = facing;
        slot.peer.col = Math.floor(x / CELL);
        slot.peer.row = Math.floor(y / CELL);
        broadcast(room!, selfId, { type: "move", id: selfId, x, y, facing });
        return;
      }
      if (msg.type === "state") {
        Object.assign(slot.peer, poseOf(msg), {
          id: slot.peer.id,
          name: slot.peer.name,
          color: slot.peer.color,
        });
        broadcast(room!, selfId, { type: "state", id: selfId, ...poseOf(slot.peer) });
        return;
      }
      if (msg.type === "profile") {
        const name = clampName(msg.name);
        if (!name) return;
        slot.peer.name = name;
        broadcast(room!, selfId, { type: "profile", id: selfId, name });
        const claims = claimsOf(roomId);
        for (const claim of claims.values()) {
          if (claim.peerId !== selfId) continue;
          claim.name = name;
          broadcast(room!, null, { type: "claim", claim });
        }
        return;
      }
      if (msg.type === "claim") {
        if (needAccount()) return;
        const deskId = clampId(msg.deskId);
        if (!deskId) {
          send(ws, { type: "error", message: "bad desk" });
          return;
        }
        const claims = claimsOf(roomId);
        const taken = claims.get(deskId);
        if (taken && taken.peerId !== selfId) {
          send(ws, { type: "error", message: "taken", deskId });
          return;
        }
        releasePeer(roomId, room!, selfId);
        const claim: Claim = {
          deskId,
          kind: kindOfDesk(deskId),
          peerId: selfId,
          name: slot.peer.name,
          privacy: "open",
          since: Date.now(),
        };
        claims.set(deskId, claim);
        broadcast(room!, null, { type: "claim", claim });
        return;
      }
      if (msg.type === "release") {
        releasePeer(roomId, room!, selfId);
        return;
      }
      if (msg.type === "privacy") {
        if (needAccount()) return;
        const privacy = clampPrivacy(msg.privacy);
        for (const claim of claimsOf(roomId).values()) {
          if (claim.peerId !== selfId) continue;
          claim.privacy = privacy;
          broadcast(room!, null, { type: "claim", claim });
        }
        return;
      }
      if (msg.type === "chat") {
        if (needAccount()) return;
        const text = String(msg.text ?? "")
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, 200);
        if (!text) return;
        const channel: ChatChannel = msg.channel === "office" ? "office" : "floor";
        if (channel === "office") {
          const deskId = peerDesk(slot.peer);
          if (!deskId) return;
          sendToDesk(room!, deskId, {
            type: "chat",
            id: selfId,
            name: slot.peer.name,
            text,
            channel: "office",
            deskId,
          });
          return;
        }
        broadcast(room!, null, {
          type: "chat",
          id: selfId,
          name: slot.peer.name,
          text,
          channel: "floor",
        });
        return;
      }
      if (msg.type === "knock") {
        if (needAccount()) return;
        const deskId = clampId(msg.deskId);
        const claim = deskId ? claimsOf(roomId).get(deskId) : undefined;
        if (!claim || claim.peerId === selfId) return;
        if (claim.privacy === "open" || claim.privacy === "focus") return;
        const occ = room!.get(claim.peerId);
        if (!occ || occ.blocked.has(selfId)) return;
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
        });
        if (!result.ok) {
          send(ws, { type: "error", message: result.error });
          return;
        }
        broadcast(room!, null, { type: "reserve", reservation: result.reservation });
        return;
      }
      if (msg.type === "cancel-reserve") {
        if (needAccount()) return;
        const result = tryCancel(String(msg.id ?? ""), selfId);
        if (!result.ok) {
          send(ws, { type: "error", message: result.error });
          return;
        }
        broadcast(room!, null, { type: "cancel-reserve", id: result.id });
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
          broadcast(room!, null, { type: "claim", claim: mine });
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
      const slot = selfId ? room!.get(selfId) : undefined;
      if (!slot || slot.ws !== ws) return;
      room!.delete(selfId);
      releasePeer(roomId, room!, selfId);
      broadcast(room!, selfId, { type: "leave", id: selfId });
      if (room!.size === 0) {
        rooms.delete(roomId);
        claimsByRoom.delete(roomId);
      }
    });
  });

  httpServer.on("close", () => {
    httpServer.off("upgrade", onUpgrade);
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
  };
}
