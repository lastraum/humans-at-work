import { randomInt, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { ConfAccess, ConferenceReservation } from "../src/protocol";

/** Calendar day + slot math use Pacific Time. */
export const RESERVE_TZ = "America/Los_Angeles";
export const SLOT_MIN = 30;
export const MAX_DAY_MIN = 60;
export const BOOK_START_MIN = 0;
export const BOOK_END_MIN = 24 * 60; // midnight exclusive end, PT
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const defaultStorePath = resolve(rootDir, "data/conference-reservations.json");
let storePath = defaultStorePath;

export function setReservationsStoreForTests(path: string | null) {
  storePath = path ?? defaultStorePath;
}

type Store = { reservations: ConferenceReservation[] };

function emptyStore(): Store {
  return { reservations: [] };
}

let preserveFile = false;

function loadStore(): Store {
  preserveFile = false;
  try {
    if (!existsSync(storePath)) return emptyStore();
    const parsed = JSON.parse(readFileSync(storePath, "utf8")) as Store;
    if (!parsed || !Array.isArray(parsed.reservations)) {
      preserveFile = true;
      console.error("[reservations] store unreadable; not replacing it");
      return emptyStore();
    }
    return {
      reservations: parsed.reservations
        .filter(
          (row) =>
            row &&
            typeof row.id === "string" &&
            typeof row.roomId === "string" &&
            typeof row.peerId === "string" &&
            typeof row.day === "string" &&
            Number.isFinite(row.startMin) &&
            (row.durationMin === 30 || row.durationMin === 60),
        )
        .map(normalizeReservation),
    };
  } catch {
    if (existsSync(storePath)) {
      preserveFile = true;
      console.error("[reservations] store unreadable; not replacing it");
    }
    return emptyStore();
  }
}

function saveStore(store: Store) {
  if (preserveFile) return;
  mkdirSync(dirname(storePath), { recursive: true });
  const tmp = `${storePath}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(store, null, 2)}\n`);
  renameSync(tmp, storePath);
}

function clampAccess(value: unknown): ConfAccess {
  return value === "code" ? "code" : "open";
}

function normalizeReservation(row: ConferenceReservation): ConferenceReservation {
  const access = clampAccess(row.access);
  const next: ConferenceReservation = {
    id: row.id,
    roomId: row.roomId,
    peerId: row.peerId,
    name: row.name,
    day: row.day,
    startMin: row.startMin,
    durationMin: row.durationMin,
    createdAt: row.createdAt,
    access,
  };
  if (access === "code" && typeof row.code === "string" && row.code) next.code = row.code;
  return next;
}

export function newConferenceCode(length = 4) {
  let out = "";
  for (let i = 0; i < length; i++) out += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return out;
}

/** YYYY-MM-DD for an instant in America/Los_Angeles. */
export function dayKeyInTz(ms = Date.now(), timeZone = RESERVE_TZ): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(ms));
}

/** Minutes from midnight in a zone. Bookable hours are always PT. */
export function minutesInTz(ms = Date.now(), timeZone = RESERVE_TZ): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "numeric",
    minute: "numeric",
    hourCycle: "h23",
  }).formatToParts(new Date(ms));
  const hour = Number(parts.find((part) => part.type === "hour")?.value ?? 0);
  const minute = Number(parts.find((part) => part.type === "minute")?.value ?? 0);
  return ((hour === 24 ? 0 : hour) % 24) * 60 + minute;
}

export function reservationEnded(row: ConferenceReservation, now = Date.now()) {
  const today = dayKeyInTz(now);
  if (row.day < today) return true;
  if (row.day > today) return false;
  return row.startMin + row.durationMin <= minutesInTz(now);
}

export function liveReservation(
  roomId: string,
  now = Date.now(),
  list = listReservations(),
): ConferenceReservation | null {
  const day = dayKeyInTz(now);
  const min = minutesInTz(now);
  return (
    list.find(
      (row) =>
        row.roomId === roomId &&
        row.day === day &&
        row.startMin <= min &&
        min < row.startMin + row.durationMin,
    ) ?? null
  );
}

export function viewReservation(
  row: ConferenceReservation,
  viewerId: string,
  admitted?: Set<string>,
): ConferenceReservation {
  const access = clampAccess(row.access);
  const out: ConferenceReservation = {
    id: row.id,
    roomId: row.roomId,
    peerId: row.peerId,
    name: row.name,
    day: row.day,
    startMin: row.startMin,
    durationMin: row.durationMin,
    createdAt: row.createdAt,
    access,
    admitted: row.peerId === viewerId || Boolean(admitted?.has(row.id)),
  };
  if (row.peerId === viewerId && row.code) out.code = row.code;
  return out;
}

export function formatClock(startMin: number): string {
  const h = Math.floor(startMin / 60);
  const m = startMin % 60;
  const ampm = h >= 12 ? "PM" : "AM";
  const h12 = ((h + 11) % 12) + 1;
  return `${h12}:${String(m).padStart(2, "0")} ${ampm}`;
}

function overlaps(aStart: number, aDur: number, bStart: number, bDur: number) {
  return aStart < bStart + bDur && bStart < aStart + aDur;
}

function pruneOld(store: Store, today = dayKeyInTz()) {
  store.reservations = store.reservations.filter((row) => row.day >= today);
}

export function listReservations(opts?: { day?: string; roomId?: string }): ConferenceReservation[] {
  const store = loadStore();
  const before = store.reservations.length;
  pruneOld(store);
  if (store.reservations.length !== before) saveStore(store);
  const day = opts?.day;
  const roomId = opts?.roomId;
  return store.reservations.filter((row) => {
    if (day && row.day !== day) return false;
    if (roomId && row.roomId !== roomId) return false;
    return true;
  });
}

export function minutesUsedByPeer(peerId: string, day: string): number {
  return listReservations({ day })
    .filter((row) => row.peerId === peerId)
    .reduce((sum, row) => sum + row.durationMin, 0);
}

export type ReserveInput = {
  roomId: string;
  peerId: string;
  name: string;
  day: string;
  startMin: number;
  durationMin: number;
  access?: ConfAccess;
};

export type ReserveResult =
  | { ok: true; reservation: ConferenceReservation }
  | { ok: false; error: string };

export function tryReserve(input: ReserveInput, now = Date.now()): ReserveResult {
  const roomId = String(input.roomId ?? "").trim().slice(0, 64);
  const peerId = String(input.peerId ?? "").trim().slice(0, 64);
  const name = String(input.name ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 24);
  const day = String(input.day ?? "").trim();
  const startMin = Number(input.startMin);
  const durationMin = Number(input.durationMin);
  const access = clampAccess(input.access);

  if (!roomId || !peerId) return { ok: false, error: "bad reservation" };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return { ok: false, error: "bad day" };
  if (!Number.isInteger(startMin) || startMin % SLOT_MIN !== 0) {
    return { ok: false, error: "start must be on a 30-minute mark" };
  }
  if (durationMin !== 30 && durationMin !== 60) {
    return { ok: false, error: "duration must be 30 or 60 minutes" };
  }
  if (startMin < BOOK_START_MIN || startMin + durationMin > BOOK_END_MIN) {
    return { ok: false, error: "outside bookable hours" };
  }

  const today = dayKeyInTz(now);
  if (day < today) return { ok: false, error: "cannot book in the past" };
  if (day === today && startMin < minutesInTz(now)) {
    return { ok: false, error: "that time already started" };
  }

  const store = loadStore();
  if (preserveFile) return { ok: false, error: "reservations unavailable" };
  pruneOld(store, today);

  for (const row of store.reservations) {
    if (row.roomId !== roomId || row.day !== day) continue;
    if (overlaps(startMin, durationMin, row.startMin, row.durationMin)) {
      return { ok: false, error: "slot taken" };
    }
  }

  const used = store.reservations
    .filter((row) => row.peerId === peerId && row.day === day)
    .reduce((sum, row) => sum + row.durationMin, 0);
  if (used + durationMin > MAX_DAY_MIN) {
    return {
      ok: false,
      error: `daily limit is ${MAX_DAY_MIN} minutes (you have ${MAX_DAY_MIN - used} left)`,
    };
  }

  const reservation: ConferenceReservation = {
    id: randomUUID(),
    roomId,
    peerId,
    name: name || `Guest-${peerId.slice(0, 4)}`,
    day,
    startMin,
    durationMin: durationMin as 30 | 60,
    createdAt: now,
    access,
  };
  if (access === "code") reservation.code = newConferenceCode();
  store.reservations.push(reservation);
  saveStore(store);
  return { ok: true, reservation };
}

export function trySetAccess(id: string, peerId: string, access: ConfAccess): ReserveResult {
  const store = loadStore();
  if (preserveFile) return { ok: false, error: "reservations unavailable" };
  pruneOld(store);
  const row = store.reservations.find((item) => item.id === id);
  if (!row) return { ok: false, error: "not found" };
  if (row.peerId !== peerId) return { ok: false, error: "not yours" };
  const next = clampAccess(access);
  row.access = next;
  if (next === "code") row.code = newConferenceCode();
  else delete row.code;
  saveStore(store);
  return { ok: true, reservation: row };
}

export type JoinResult =
  | { ok: true; reservation: ConferenceReservation }
  | { ok: false; error: string };

export function joinReservation(roomId: string, code: string, now = Date.now()): JoinResult {
  const roomKey = String(roomId ?? "").trim();
  const needle = String(code ?? "")
    .replace(/\s+/g, "")
    .toUpperCase();
  if (!roomKey || needle.length < 4) return { ok: false, error: "enter the door code" };
  const store = loadStore();
  if (preserveFile) return { ok: false, error: "reservations unavailable" };
  pruneOld(store);
  const row = store.reservations.find(
    (item) =>
      item.roomId === roomKey &&
      item.access === "code" &&
      item.code === needle &&
      !reservationEnded(item, now),
  );
  if (!row) return { ok: false, error: "wrong code" };
  return { ok: true, reservation: row };
}

export type CancelResult = { ok: true; id: string } | { ok: false; error: string };

export function tryCancel(id: string, peerId: string): CancelResult {
  const store = loadStore();
  if (preserveFile) return { ok: false, error: "reservations unavailable" };
  pruneOld(store);
  const idx = store.reservations.findIndex((row) => row.id === id);
  if (idx < 0) return { ok: false, error: "not found" };
  const row = store.reservations[idx]!;
  if (row.peerId !== peerId) return { ok: false, error: "not yours" };
  store.reservations.splice(idx, 1);
  saveStore(store);
  return { ok: true, id };
}

export function knownConferenceIds(): Set<string> {
  try {
    const plate = JSON.parse(
      readFileSync(resolve(rootDir, "data/floor-plate.json"), "utf8"),
    ) as { conferences?: { id?: string }[] };
    return new Set(
      (plate.conferences ?? [])
        .filter((row) => String(row.id ?? "") && !String(row.id).startsWith("lib_"))
        .map((row) => String(row.id ?? ""))
        .filter(Boolean),
    );
  } catch {
    return new Set();
  }
}
