import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  BOOK_START_MIN,
  dayKeyInTz,
  joinReservation,
  minutesInTz,
  reservationEnded,
  setReservationsStoreForTests,
  tryReserve,
  trySetAccess,
  viewReservation,
} from "../server/reservations.ts";

const dir = mkdtempSync(join(tmpdir(), "haw-res-"));
const store = join(dir, "conference-reservations.json");
setReservationsStoreForTests(store);

function assert(cond, message) {
  if (!cond) throw new Error(message);
}

/** UTC instant that lands on `day` (America/Los_Angeles) at `minutes` past midnight. */
function instantOnDay(day, minutes) {
  const target = Date.parse(`${day}T12:00:00Z`);
  for (let offset = 0; offset <= 24; offset++) {
    for (const sign of [-1, 1]) {
      const ms = target + sign * offset * 60 * 60 * 1000;
      if (dayKeyInTz(ms) === day && minutesInTz(ms) === minutes) return ms;
    }
  }
  throw new Error(`no instant for ${day} @ ${minutes}`);
}

// Two days ahead so pruneOld (real today) keeps the rows join and access flip look up.
const day = dayKeyInTz(Date.now() + 2 * 24 * 60 * 60 * 1000);
const noonPt = instantOnDay(day, 12 * 60);
const sixAmPt = instantOnDay(day, 6 * 60);
assert(dayKeyInTz(sixAmPt) === day, "6:00 PT is on the fixture day");
assert(dayKeyInTz(noonPt) === day, "12:00 PT is on the fixture day");
assert(minutesInTz(sixAmPt) === 6 * 60, `expected 6:00 PT, got ${minutesInTz(sixAmPt)}`);
assert(minutesInTz(noonPt) === 12 * 60, `expected 12:00 PT, got ${minutesInTz(noonPt)}`);

const overnight = tryReserve(
  {
    roomId: "conf_0_0_2x1",
    peerId: "peer-a",
    name: "Ada",
    day,
    startMin: 23 * 60 + 30,
    durationMin: 60,
    access: "open",
  },
  noonPt,
);
assert(!overnight.ok, "60 min from 11:30 PM must not wrap past midnight");

const early = tryReserve(
  {
    roomId: "conf_0_0_2x1",
    peerId: "peer-z",
    name: "Zed",
    day,
    startMin: 7 * 60 + 30,
    durationMin: 30,
    access: "open",
  },
  sixAmPt,
);
assert(early.ok, early.ok ? "ok" : early.error);

const past = tryReserve(
  {
    roomId: "conf_0_0_2x1",
    peerId: "peer-a",
    name: "Ada",
    day,
    startMin: BOOK_START_MIN,
    durationMin: 30,
    access: "open",
  },
  noonPt,
);
assert(!past.ok, "elapsed midnight start must reject at noon");
assert(String(past.error).includes("already started"), past.error);

const openBook = tryReserve(
  {
    roomId: "conf_0_0_2x1",
    peerId: "peer-a",
    name: "Ada",
    day,
    startMin: 13 * 60,
    durationMin: 30,
    access: "open",
  },
  noonPt,
);
assert(openBook.ok, openBook.ok ? "ok" : openBook.error);
assert(openBook.reservation.access === "open", "default/open session");
assert(!openBook.reservation.code, "open session has no code");

const codeBook = tryReserve(
  {
    roomId: "conf_2_4_2x1",
    peerId: "peer-a",
    name: "Ada",
    day,
    startMin: 14 * 60,
    durationMin: 30,
    access: "code",
  },
  noonPt,
);
assert(codeBook.ok, codeBook.ok ? "ok" : codeBook.error);
assert(codeBook.reservation.access === "code", "code session");
assert(/^[A-HJ-NP-Z2-9]{4}$/.test(codeBook.reservation.code), `bad code ${codeBook.reservation.code}`);

const publicView = viewReservation(codeBook.reservation, "peer-b");
assert(!publicView.code, "code must not leak to others");
assert(publicView.admitted === false, "stranger is not admitted");
const hostView = viewReservation(codeBook.reservation, "peer-a");
assert(hostView.code === codeBook.reservation.code, "host keeps the code");
assert(hostView.admitted === true, "host is admitted");

const badJoin = joinReservation("conf_2_4_2x1", "XXXX", noonPt);
assert(!badJoin.ok, "wrong code must fail");

const goodJoin = joinReservation("conf_2_4_2x1", codeBook.reservation.code.toLowerCase(), noonPt);
assert(goodJoin.ok, goodJoin.ok ? "ok" : goodJoin.error);
assert(goodJoin.reservation.id === codeBook.reservation.id, "join hits the coded slot");

const flipped = trySetAccess(openBook.reservation.id, "peer-a", "code");
assert(flipped.ok, flipped.ok ? "ok" : flipped.error);
assert(flipped.reservation.access === "code", "flip to code");
assert(flipped.reservation.code, "flip generates a code");

assert(
  !reservationEnded(codeBook.reservation, noonPt),
  "future 2pm slot is not ended at noon",
);

setReservationsStoreForTests(null);
rmSync(dir, { recursive: true, force: true });
console.log("reservations ok");
