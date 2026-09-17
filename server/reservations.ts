import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { ConferenceReservation } from "../src/protocol";

/** Calendar day + slot math use Pacific Time. */
export const RESERVE_TZ = "America/Los_Angeles";
export const SLOT_MIN = 30;
export const MAX_DAY_MIN = 60;
export const BOOK_START_MIN = 8 * 60; // 08:00 PT
export const BOOK_END_MIN = 20 * 60; // 20:00 PT exclusive end

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const storePath = resolve(rootDir, "data/conference-reservations.json");

type Store = { reservations: ConferenceReservation[] };

function emptyStore(): Store {
  return { reservations: [] };
}

function loadStore(): Store {
  try {
    if (!existsSync(storePath)) return emptyStore();
    const parsed = JSON.parse(readFileSync(storePath, "utf8")) as Store;
    if (!parsed || !Array.isArray(parsed.reservations)) return emptyStore();
    return {
      reservations: parsed.reservations.filter(
        (row) =>
          row &&
          typeof row.id === "string" &&
          typeof row.roomId === "string" &&
          typeof row.peerId === "string" &&
          typeof row.day === "string" &&
          Number.isFinite(row.startMin) &&
          (row.durationMin === 30 || row.durationMin === 60),
      ),
    };
  } catch {
    return emptyStore();
  }
}

function saveStore(store: Store) {
  mkdirSync(dirname(storePath), { recursive: true });
  writeFileSync(storePath, `${JSON.stringify(store, null, 2)}\n`);
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
  pruneOld(store);
  saveStore(store);
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
};

export type ReserveResult =
  | { ok: true; reservation: ConferenceReservation }
  | { ok: false; error: string };

export function tryReserve(input: ReserveInput): ReserveResult {
  const roomId = String(input.roomId ?? "").trim().slice(0, 64);
  const peerId = String(input.peerId ?? "").trim().slice(0, 64);
  const name = String(input.name ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 24);
  const day = String(input.day ?? "").trim();
  const startMin = Number(input.startMin);
  const durationMin = Number(input.durationMin);

  if (!roomId || !peerId) return { ok: false, error: "bad reservation" };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return { ok: false, error: "bad day" };
  if (!Number.isInteger(startMin) || startMin % SLOT_MIN !== 0) {
    return { ok: false, error: "start must be on a 30-minute mark" };
  }
  if (durationMin !== 30 && durationMin !== 60) {
    return { ok: false, error: "duration must be 30 or 60 minutes" };
  }
  if (startMin < BOOK_START_MIN || startMin + durationMin > BOOK_END_MIN) {
    return { ok: false, error: "outside bookable hours (8:00 AM–8:00 PM PT)" };
  }

  const today = dayKeyInTz();
  if (day < today) return { ok: false, error: "cannot book in the past" };

  const store = loadStore();
  pruneOld(store);

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
    createdAt: Date.now(),
  };
  store.reservations.push(reservation);
  saveStore(store);
  return { ok: true, reservation };
}

export type CancelResult = { ok: true; id: string } | { ok: false; error: string };

export function tryCancel(id: string, peerId: string): CancelResult {
  const store = loadStore();
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
