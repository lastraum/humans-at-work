import type { AvatarLook } from "./avatarLook";

/** Game-state wire (claims, knocks, poses) over the local floor WebSocket.
 *  Chat rides a single world LiveKit room; the SFU delivers office packets
 *  only to destinationIdentities (DCL private-room pattern). */

export type Pose = {
  x: number;
  y: number;
  facing: number;
  pose: "sit" | "stand";
  col?: number;
  row?: number;
  /** Furniture `_uid` when sitting. Locked per floor so two people cannot share a seat. */
  seatId?: string;
  /** World Y for this sit. Beanbags sit higher than desk chairs. */
  seatY?: number;
};

export type Peer = {
  id: string;
  name: string;
  color: string;
  /** Guest ETH address for DCL LiveKit identity targeting. */
  address?: string;
  /** Story floor (same plate, occupancy filter). 1-based. */
  floor?: number;
  /** Opt-in: others may send a whisper request. Default off. */
  chatAvailable?: boolean;
  company?: string;
  profileUrl?: string;
  /** Avatar editor. Omitted by older clients; viewers derive a stable look from id. */
  look?: AvatarLook;
} & Pose;

export type DeskKind = "office" | "cubicle";

export type Privacy = "open" | "busy" | "focus" | "private";

/** Floor is everyone. Office is only peers whose pose is inside that desk. */
export type ChatChannel = "floor" | "office";


export type ConfAccess = "open" | "code";

/** Conference room booking. Day boundary is America/Los_Angeles (PT). */
export type ConferenceReservation = {
  id: string;
  roomId: string;
  peerId: string;
  name: string;
  /** YYYY-MM-DD in America/Los_Angeles */
  day: string;
  /** Minutes from midnight PT; multiple of 30. */
  startMin: number;
  durationMin: 30 | 60;
  createdAt: number;
  /** Open: anyone can walk in during the slot. Code: door needs the host's code. */
  access: ConfAccess;
  /** Host only. Omitted in public broadcasts. */
  code?: string;
  /** True for the host and anyone who redeemed this slot's code. */
  admitted?: boolean;
};

/** Billboard on an occupied office's exterior windows. Omitted when vacant or toggled off. */
export type OfficeAd = {
  deskId: string;
  peerId: string;
  enabled: boolean;
  /** Cache-busted public URL for the stored image. */
  url?: string;
};

export type Claim = {
  deskId: string;
  kind: DeskKind;
  peerId: string;
  name: string;
  privacy: Privacy;
  /**
   * Peer ids still allowed inside a Private office. Present only while privacy
   * is private. The claimer is always included and may leave and come back.
   */
  admitted?: string[];
  /** Unix ms when they checked in. */
  since: number;
  /** Story floor this desk occupies. Same plate; occupancy is per floor. */
  floor?: number;
  /** IANA timezone shown on the door when the occupant shares location. */
  timezone?: string;
  /** Present only for occupied offices with an enabled window ad. */
  officeAd?: OfficeAd;
  company?: string;
  profileUrl?: string;
};

export type ClientMsg =
  | ({ type: "hello"; id: string; name: string; color: string; address?: string; token?: string; company?: string; profileUrl?: string; timezone?: string; look?: AvatarLook } & Pose)
  | { type: "move"; x: number; y: number; facing?: number }
  | ({ type: "state" } & Pose)
  | { type: "profile"; name: string; company?: string; profileUrl?: string; color?: string; look?: AvatarLook }
  | { type: "claim"; deskId: string; timezone?: string }
  | { type: "timezone"; tz: string | null }
  | { type: "release" }
  | { type: "privacy"; privacy: Privacy }
  | { type: "chat"; text: string; channel?: ChatChannel }
  | { type: "chat-available"; on: boolean }
  | { type: "whisper"; toId: string; text?: string }
  | { type: "whisper-reply"; fromId: string; accept: boolean }
  | { type: "whisper-end"; peerId?: string }
  | { type: "knock"; deskId: string }
  | { type: "knock-reply"; fromId: string; accept: boolean }
  | { type: "boot" }
  | { type: "block"; id: string }
  | { type: "unblock"; id: string }
  | { type: "reserve"; roomId: string; day: string; startMin: number; durationMin: 30 | 60; access?: ConfAccess }
  | { type: "cancel-reserve"; id: string }
  | { type: "conf-access"; id: string; access: ConfAccess }
  | { type: "conf-join"; roomId: string; code: string }
  | { type: "conf-boot"; roomId: string; peerId: string }
  | { type: "office-ad"; enabled: boolean }
  | { type: "floor"; floor: number }
  | { type: "shift-hold" };

export type ServerMsg =
  | { type: "welcome"; roomId: string; self: Peer; peers: Peer[]; claims: Claim[]; reservations?: ConferenceReservation[]; blocked?: string[]; blockedBy?: string[]; officeAds?: OfficeAd[]; floor?: number; maxFloor?: number; floors?: number[]; xp?: number }
  | { type: "xp"; xp: number }
  | { type: "join"; peer: Peer }
  | { type: "leave"; id: string }
  | { type: "floors"; floor: number; maxFloor: number; floors: number[] }
  | { type: "floor"; floor: number; maxFloor: number; floors: number[]; peers: Peer[]; claims: Claim[]; officeAds?: OfficeAd[] }
  | { type: "move"; id: string; x: number; y: number; facing?: number }
  | ({ type: "state"; id: string } & Pose)
  | { type: "profile"; id: string; name: string; company?: string; profileUrl?: string; color?: string; look?: AvatarLook }
  | { type: "claim"; claim: Claim }
  | { type: "release"; deskId: string; peerId: string }
  | { type: "chat"; id: string; name: string; text: string; channel: ChatChannel; deskId?: string }
  | { type: "chat-available"; id: string; on: boolean }
  | { type: "whisper-request"; fromId: string; fromName: string; text?: string }
  | { type: "whisper-open"; peerId: string; name: string; text?: string }
  | { type: "whisper"; id: string; name: string; text: string; peerId: string }
  | { type: "whisper-end"; peerId: string; reason?: "left" | "ended" | "declined" }
  | { type: "knock"; deskId: string; fromId: string; fromName: string }
  | { type: "knock-reply"; fromId: string; accept: boolean; deskId: string }
  | { type: "boot"; deskId: string; peerId: string }
  | { type: "office-kick"; deskId: string }
  | { type: "blocked"; byId: string }
  | { type: "unblocked"; byId: string }
  | { type: "reservations"; reservations: ConferenceReservation[] }
  | { type: "reserve"; reservation: ConferenceReservation }
  | { type: "cancel-reserve"; id: string }
  | { type: "conf-admit"; reservationId: string; roomId: string }
  | { type: "conf-kick"; roomId: string; reason: "ended" | "denied" }
  | { type: "office-ad"; ad: OfficeAd | null; deskId: string; peerId: string }
  | { type: "error"; message: string; deskId?: string };

export function clampPrivacy(value: unknown): Privacy {
  return value === "busy" || value === "focus" || value === "private" ? value : "open";
}

export function privacyLabel(privacy: string) {
  if (privacy === "busy") return "Busy";
  if (privacy === "focus") return "Focus";
  if (privacy === "private") return "Private";
  return "Open";
}

/** Busy, Focus, and Private do not take new whispers. Open does. */
export function blocksWhispers(privacy: string) {
  return privacy === "busy" || privacy === "focus" || privacy === "private";
}

export const ROOM_PATH = "/__room";
export const MAX_NAME = 24;
export const MAX_COMPANY = 32;
export const MAX_PROFILE_URL = 200;
export const MAX_ID = 64;

export function clampCompany(value: unknown) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_COMPANY);
}

export function clampProfileUrl(value: unknown) {
  const raw = String(value ?? "").trim().slice(0, MAX_PROFILE_URL);
  if (!raw) return "";
  try {
    const url = new URL(raw);
    if (url.protocol !== "http:" && url.protocol !== "https:") return "";
    if (url.username || url.password) return "";
    return url.toString().slice(0, MAX_PROFILE_URL);
  } catch {
    return "";
  }
}
