import { resolveLook, type AvatarLook } from "./avatarLook";
import {
  ROOM_PATH,
  type ChatChannel,
  type Claim,
  type ConferenceReservation,
  type ClientMsg,
  type OfficeAd,
  type Peer,
  type Pose,
  type Privacy,
  type ServerMsg,
} from "./protocol";
import type { Identity } from "./identity";

export type RoomHandlers = {
  roomId: string;
  identity: Identity;
  getToken?: () => string;
  getPose: () => Pose;
  onWelcome: (
    peers: Peer[],
    self: Peer,
    claims: Claim[],
    blocked?: string[],
    blockedBy?: string[],
    officeAds?: OfficeAd[],
    floor?: number,
    maxFloor?: number,
    floors?: number[],
    xp?: number,
  ) => void;
  onXp?: (xp: number) => void;
  onFloors?: (floor: number, maxFloor: number, floors: number[]) => void;
  onFloorView?: (view: {
    floor: number;
    maxFloor: number;
    floors: number[];
    peers: Peer[];
    claims: Claim[];
    officeAds?: OfficeAd[];
  }) => void;
  onOfficeAd?: (deskId: string, peerId: string, ad: OfficeAd | null) => void;
  onJoin: (peer: Peer) => void;
  onLeave: (id: string) => void;
  onMove: (id: string, x: number, y: number, facing?: number) => void;
  onState: (id: string, pose: Pose) => void;
  onProfile: (id: string, name: string, company?: string, profileUrl?: string, look?: AvatarLook) => void;
  onClaim: (claim: Claim) => void;
  onReservations?: (reservations: ConferenceReservation[]) => void;
  onReserve?: (reservation: ConferenceReservation) => void;
  onCancelReserve?: (id: string) => void;
  onConfAdmit?: (reservationId: string, roomId: string) => void;
  onConfKick?: (roomId: string, reason: "ended" | "denied") => void;
  onRelease: (deskId: string, peerId: string) => void;
  onChat?: (id: string, name: string, text: string, channel: ChatChannel, deskId?: string) => void;
  onChatAvailable?: (id: string, on: boolean) => void;
  onWhisperRequest?: (fromId: string, fromName: string, text?: string) => void;
  onWhisperOpen?: (peerId: string, name: string, text?: string) => void;
  onWhisper?: (id: string, name: string, text: string, peerId: string) => void;
  onWhisperEnd?: (peerId: string, reason?: "left" | "ended" | "declined") => void;
  onKnock?: (deskId: string, fromId: string, fromName: string) => void;
  onKnockReply?: (fromId: string, accept: boolean, deskId: string) => void;
  onBoot?: (deskId: string, peerId: string) => void;
  onBlocked?: (byId: string) => void;
  onUnblocked?: (byId: string) => void;
  onError?: (message: string, deskId?: string) => void;
  onStatus: (text: string) => void;
};

const REPLACED = 4001;

function socketUrl(roomId: string) {
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${location.host}${ROOM_PATH}?id=${encodeURIComponent(roomId)}`;
}

export function connectRoom(opts: RoomHandlers) {
  let ws: WebSocket | null = null;
  let closed = false;
  let attempt = 0;
  let timer = 0;
  let connected = false;
  let everConnected = false;
  let peers = 1;

  const status = () => {
    if (closed) return;
    if (connected) opts.onStatus(`${peers} in ${opts.roomId}`);
    else if (everConnected) opts.onStatus("offline");
    else opts.onStatus("");
  };

  const send = (msg: ClientMsg) => {
    if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
  };

  const hello = () => {
    const pose = opts.getPose();
    let timezone: string | undefined;
    try {
      timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || undefined;
    } catch {
      timezone = undefined;
    }
    const look = resolveLook(opts.identity);
    send({
      type: "hello",
      id: opts.identity.id,
      name: opts.identity.name,
      color: look.shirt,
      address: opts.identity.address,
      company: opts.identity.company,
      profileUrl: opts.identity.profileUrl,
      look,
      token: opts.getToken?.() || undefined,
      timezone,
      ...pose,
    });
  };

  const handle = (msg: ServerMsg) => {
    if (msg.type === "welcome") {
      peers = 1 + msg.peers.length;
      opts.onWelcome(
        msg.peers,
        msg.self,
        msg.claims ?? [],
        msg.blocked ?? [],
        msg.blockedBy ?? [],
        msg.officeAds,
        msg.floor,
        msg.maxFloor,
        msg.floors,
        msg.xp ?? 0,
      );
      opts.onXp?.(msg.xp ?? 0);
      opts.onReservations?.(msg.reservations ?? []);
      status();
      return;
    }
    if (msg.type === "floors") {
      opts.onFloors?.(msg.floor, msg.maxFloor, msg.floors);
      return;
    }
    if (msg.type === "floor") {
      peers = 1 + msg.peers.length;
      opts.onFloorView?.({
        floor: msg.floor,
        maxFloor: msg.maxFloor,
        floors: msg.floors,
        peers: msg.peers,
        claims: msg.claims ?? [],
        officeAds: msg.officeAds,
      });
      status();
      return;
    }
    if (msg.type === "join") {
      peers += 1;
      opts.onJoin(msg.peer);
      status();
      return;
    }
    if (msg.type === "leave") {
      peers = Math.max(1, peers - 1);
      opts.onLeave(msg.id);
      status();
      return;
    }
    if (msg.type === "move") {
      opts.onMove(msg.id, msg.x, msg.y, msg.facing);
      return;
    }
    if (msg.type === "state") {
      const { id, type: _t, ...pose } = msg;
      opts.onState(id, pose);
      return;
    }
    if (msg.type === "profile") {
      opts.onProfile(msg.id, msg.name, msg.company, msg.profileUrl, msg.look);
      return;
    }
    if (msg.type === "xp") {
      opts.onXp?.(msg.xp);
      return;
    }
    if (msg.type === "claim") {
      opts.onClaim(msg.claim);
      return;
    }
    if (msg.type === "release") {
      opts.onRelease(msg.deskId, msg.peerId);
      return;
    }
    if (msg.type === "chat") {
      opts.onChat?.(msg.id, msg.name, msg.text, msg.channel ?? "floor", msg.deskId);
      return;
    }
    if (msg.type === "chat-available") {
      opts.onChatAvailable?.(msg.id, msg.on);
      return;
    }
    if (msg.type === "whisper-request") {
      opts.onWhisperRequest?.(msg.fromId, msg.fromName, msg.text);
      return;
    }
    if (msg.type === "whisper-open") {
      opts.onWhisperOpen?.(msg.peerId, msg.name, msg.text);
      return;
    }
    if (msg.type === "whisper") {
      opts.onWhisper?.(msg.id, msg.name, msg.text, msg.peerId);
      return;
    }
    if (msg.type === "whisper-end") {
      opts.onWhisperEnd?.(msg.peerId, msg.reason);
      return;
    }
    if (msg.type === "knock") {
      opts.onKnock?.(msg.deskId, msg.fromId, msg.fromName);
      return;
    }
    if (msg.type === "knock-reply") {
      opts.onKnockReply?.(msg.fromId, msg.accept, msg.deskId);
      return;
    }
    if (msg.type === "boot") {
      opts.onBoot?.(msg.deskId, msg.peerId);
      return;
    }
    if (msg.type === "blocked") {
      opts.onBlocked?.(msg.byId);
      return;
    }
    if (msg.type === "unblocked") {
      opts.onUnblocked?.(msg.byId);
      return;
    }
    if (msg.type === "reservations") {
      opts.onReservations?.(msg.reservations);
      return;
    }
    if (msg.type === "reserve") {
      opts.onReserve?.(msg.reservation);
      return;
    }
    if (msg.type === "cancel-reserve") {
      opts.onCancelReserve?.(msg.id);
      return;
    }
    if (msg.type === "conf-admit") {
      opts.onConfAdmit?.(msg.reservationId, msg.roomId);
      return;
    }
    if (msg.type === "conf-kick") {
      opts.onConfKick?.(msg.roomId, msg.reason);
      return;
    }
    if (msg.type === "office-ad") {
      opts.onOfficeAd?.(msg.deskId, msg.peerId, msg.ad);
      return;
    }
    if (msg.type === "error") {
      opts.onError?.(msg.message, msg.deskId);
    }
  };

  const connect = () => {
    if (closed) return;
    ws = new WebSocket(socketUrl(opts.roomId));
    ws.addEventListener("open", () => {
      attempt = 0;
      connected = true;
      everConnected = true;
      hello();
      status();
    });
    ws.addEventListener("message", (event) => {
      try {
        handle(JSON.parse(String(event.data)) as ServerMsg);
      } catch {
        /* ignore bad frames */
      }
    });
    ws.addEventListener("close", (event) => {
      connected = false;
      if (closed) return;
      status();
      if (event.code === REPLACED) return;
      attempt += 1;
      const wait = Math.min(8000, 500 * 2 ** Math.min(attempt, 4));
      timer = window.setTimeout(connect, wait);
    });
  };

  connect();
  status();

  const disconnect = () => {
    closed = true;
    window.clearTimeout(timer);
    const sock = ws;
    ws = null;
    sock?.close();
  };

  window.addEventListener("beforeunload", disconnect);
  const hot = import.meta.hot;
  hot?.dispose(disconnect);

  return {
    sendMove(x: number, y: number, facing?: number) {
      send({ type: "move", x, y, facing });
    },
    sendState(pose: Pose) {
      send({ type: "state", ...pose });
    },
    sendProfile(name: string, company?: string, profileUrl?: string, look?: AvatarLook) {
      send({ type: "profile", name, company, profileUrl, color: look?.shirt, look });
    },
    sendClaim(deskId: string, timezone?: string) {
      send({ type: "claim", deskId, timezone });
    },
    sendTimezone(tz: string | null) {
      send({ type: "timezone", tz });
    },
    sendReserve(
      roomId: string,
      day: string,
      startMin: number,
      durationMin: 30 | 60,
      access?: "open" | "code",
    ) {
      send({ type: "reserve", roomId, day, startMin, durationMin, access });
    },
    sendCancelReserve(id: string) {
      send({ type: "cancel-reserve", id });
    },
    sendConfAccess(id: string, access: "open" | "code") {
      send({ type: "conf-access", id, access });
    },
    sendConfJoin(roomId: string, code: string) {
      send({ type: "conf-join", roomId, code });
    },
    sendConfBoot(roomId: string, peerId: string) {
      send({ type: "conf-boot", roomId, peerId });
    },
    sendRelease() {
      send({ type: "release" });
    },
    sendPrivacy(privacy: Privacy) {
      send({ type: "privacy", privacy });
    },
    sendChat(text: string, channel: ChatChannel = "floor") {
      send({ type: "chat", text, channel });
    },
    sendChatAvailable(on: boolean) {
      send({ type: "chat-available", on });
    },
    sendWhisper(toId: string, text = "") {
      send({ type: "whisper", toId, text });
    },
    sendWhisperReply(fromId: string, accept: boolean) {
      send({ type: "whisper-reply", fromId, accept });
    },
    sendWhisperEnd(peerId?: string) {
      send({ type: "whisper-end", peerId });
    },
    sendKnock(deskId: string) {
      send({ type: "knock", deskId });
    },
    sendKnockReply(fromId: string, accept: boolean) {
      send({ type: "knock-reply", fromId, accept });
    },
    sendBoot() {
      send({ type: "boot" });
    },
    sendBlock(id: string, on: boolean) {
      send(on ? { type: "block", id } : { type: "unblock", id });
    },
    sendOfficeAd(enabled: boolean) {
      send({ type: "office-ad", enabled });
    },
    sendFloor(floor: number) {
      send({ type: "floor", floor });
    },
    sendShiftHold() {
      send({ type: "shift-hold" });
    },
    identify() {
      hello();
    },
    disconnect,
  };
}
