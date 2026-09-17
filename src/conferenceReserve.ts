import * as THREE from "three";
import type { ConferenceReservation } from "./protocol";
import type { FloorPlate, OfficeInstance } from "./types";

/** Day boundaries for the 1hr/day cap. */
export const TZ = "America/Los_Angeles";
export const SLOT = 30;
export const DAY_CAP = 60;
export const BOOK_START_MIN = 8 * 60;
export const BOOK_END_MIN = 20 * 60;

export function ptDayKey(ms = Date.now()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(ms));
}

export function clockLabel(startMin: number) {
  const h = Math.floor(startMin / 60);
  const m = startMin % 60;
  const ampm = h >= 12 ? "PM" : "AM";
  const h12 = ((h + 11) % 12) + 1;
  return `${h12}:${String(m).padStart(2, "0")} ${ampm}`;
}

export function conferenceAtCell(plate: FloorPlate, col: number, row: number): OfficeInstance | null {
  for (const room of plate.conferences ?? []) {
    const w = room.cols ?? 1;
    const h = room.rows ?? 1;
    if (col >= room.col && col < room.col + w && row >= room.row && row < room.row + h) {
      return room;
    }
  }
  return null;
}

export function pickConferenceGroup(
  camera: THREE.Camera,
  pointer: THREE.Vector2,
  root: THREE.Object3D,
): OfficeInstance | null {
  const raycaster = new THREE.Raycaster();
  raycaster.setFromCamera(pointer, camera);
  const hits = raycaster.intersectObjects(root.children, true);
  for (const hit of hits) {
    let obj: THREE.Object3D | null = hit.object;
    while (obj) {
      const conf = obj.userData?.conference as OfficeInstance | undefined;
      if (conf?.id) return conf;
      obj = obj.parent;
    }
  }
  return null;
}

function overlaps(aStart: number, aDur: number, bStart: number, bDur: number) {
  return aStart < bStart + bDur && bStart < aStart + aDur;
}

export function remainingMinutes(
  reservations: ConferenceReservation[],
  peerId: string,
  day: string,
): number {
  const used = reservations
    .filter((row) => row.peerId === peerId && row.day === day)
    .reduce((sum, row) => sum + row.durationMin, 0);
  return Math.max(0, DAY_CAP - used);
}

export function roomBookings(
  reservations: ConferenceReservation[],
  roomId: string,
  day: string,
): ConferenceReservation[] {
  return reservations
    .filter((row) => row.roomId === roomId && row.day === day)
    .sort((a, b) => a.startMin - b.startMin);
}

export function nextBookingLabel(
  reservations: ConferenceReservation[],
  roomId: string,
  now = Date.now(),
): string {
  const day = ptDayKey(now);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TZ,
    hour: "numeric",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date(now));
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? 0);
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
  const nowMin = hour * 60 + minute;
  const upcoming = roomBookings(reservations, roomId, day).find(
    (row) => row.startMin + row.durationMin > nowMin,
  );
  if (!upcoming) return "";
  if (upcoming.startMin <= nowMin) {
    return `In use · until ${clockLabel(upcoming.startMin + upcoming.durationMin)}`;
  }
  return `Next · ${clockLabel(upcoming.startMin)} (${upcoming.name})`;
}

export type ReserveUiHandlers = {
  getReservations: () => ConferenceReservation[];
  getPeerId: () => string;
  isSignedIn: () => boolean;
  askSignIn: (reason: string) => void;
  onReserve: (roomId: string, day: string, startMin: number, durationMin: 30 | 60) => void;
  onCancel: (id: string) => void;
  onStatus?: (text: string) => void;
};

export function attachConferenceReserve(handlers: ReserveUiHandlers) {
  const root = document.querySelector<HTMLElement>("#conf-reserve")!;
  const title = document.querySelector("#conf-reserve-title")!;
  const hello = document.querySelector("#conf-reserve-hello")!;
  const dayEl = document.querySelector<HTMLInputElement>("#conf-reserve-day")!;
  const slotsEl = document.querySelector("#conf-reserve-slots")!;
  const allowEl = document.querySelector("#conf-reserve-allow")!;
  const errEl = document.querySelector("#conf-reserve-error")!;
  const mineEl = document.querySelector("#conf-reserve-mine")!;

  let room: OfficeInstance | null = null;
  let selectedStart: number | null = null;
  let selectedDur: 30 | 60 = 30;

  const hide = () => {
    room = null;
    selectedStart = null;
    root.hidden = true;
  };

  const paint = () => {
    if (!room) return;
    const day = dayEl.value || ptDayKey();
    const peerId = handlers.getPeerId();
    const all = handlers.getReservations();
    const left = remainingMinutes(all, peerId, day);
    const bookings = roomBookings(all, room.id, day);
    allowEl.textContent = `${left} min left today (PT) · max ${DAY_CAP} min / person / day`;
    errEl.textContent = "";

    slotsEl.innerHTML = "";
    for (let start = BOOK_START_MIN; start + SLOT <= BOOK_END_MIN; start += SLOT) {
      const taken = bookings.find((row) => overlaps(start, SLOT, row.startMin, row.durationMin));
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "conf-slot";
      if (taken) {
        btn.disabled = true;
        btn.classList.add("taken");
        btn.title = `${taken.name} · ${taken.durationMin}m`;
        btn.textContent = `${clockLabel(start)} · ${taken.name}`;
      } else {
        const fitsDur =
          selectedDur <= left &&
          start + selectedDur <= BOOK_END_MIN &&
          !bookings.some((row) => overlaps(start, selectedDur, row.startMin, row.durationMin));
        btn.textContent = clockLabel(start);
        if (!fitsDur) {
          btn.disabled = true;
          btn.classList.add("blocked");
          btn.title =
            selectedDur > left
              ? `only ${left} min left today`
              : start + selectedDur > BOOK_END_MIN
                ? "runs past 8:00 PM PT"
                : "conflicts with a booking";
        } else {
          if (selectedStart === start) btn.classList.add("on");
          btn.addEventListener("click", () => {
            selectedStart = start;
            paint();
          });
        }
      }
      slotsEl.appendChild(btn);
    }

    mineEl.innerHTML = "";
    const mine = all.filter((row) => row.peerId === peerId && row.day >= ptDayKey());
    if (!mine.length) {
      mineEl.textContent = "No upcoming reservations.";
    } else {
      for (const row of mine) {
        const line = document.createElement("div");
        line.className = "conf-mine-row";
        const label = document.createElement("span");
        label.textContent = `${row.roomId === room.id ? "This room" : row.roomId} · ${row.day} · ${clockLabel(row.startMin)} (${row.durationMin}m)`;
        const cancel = document.createElement("button");
        cancel.type = "button";
        cancel.textContent = "Cancel";
        cancel.addEventListener("click", () => handlers.onCancel(row.id));
        line.append(label, cancel);
        mineEl.appendChild(line);
      }
    }

    Array.from(root.querySelectorAll<HTMLButtonElement>("[data-dur]")).forEach((btn) => {
      const dur = Number(btn.dataset.dur) as 30 | 60;
      btn.classList.toggle("on", selectedDur === dur);
      btn.disabled = dur > left;
    });
  };

  const open = (next: OfficeInstance) => {
    room = next;
    selectedStart = null;
    selectedDur = 30;
    dayEl.value = ptDayKey();
    title.textContent = "Reserve conference room";
    hello.textContent = prettyRoom(next.id);
    root.hidden = false;
    paint();
  };

  dayEl.addEventListener("change", () => {
    selectedStart = null;
    paint();
  });

  root.querySelectorAll<HTMLButtonElement>("[data-dur]").forEach((btn) => {
    btn.addEventListener("click", () => {
      selectedDur = Number(btn.dataset.dur) as 30 | 60;
      selectedStart = null;
      paint();
    });
  });

  root.querySelector("#conf-reserve-go")?.addEventListener("click", () => {
    if (!room) return;
    if (!handlers.isSignedIn()) {
      hide();
      handlers.askSignIn("Sign in to reserve a conference room.");
      return;
    }
    if (selectedStart === null) {
      errEl.textContent = "Pick a start time.";
      return;
    }
    const day = dayEl.value || ptDayKey();
    const all = handlers.getReservations();
    const left = remainingMinutes(all, handlers.getPeerId(), day);
    if (selectedDur > left) {
      errEl.textContent = `Only ${left} minutes left today.`;
      return;
    }
    const bookings = roomBookings(all, room.id, day);
    if (bookings.some((row) => overlaps(selectedStart!, selectedDur, row.startMin, row.durationMin))) {
      errEl.textContent = "That slot was just taken.";
      paint();
      return;
    }
    if (selectedStart + selectedDur > BOOK_END_MIN) {
      errEl.textContent = "That duration runs past 8:00 PM PT.";
      return;
    }
    handlers.onReserve(room.id, day, selectedStart, selectedDur);
    handlers.onStatus?.("reservation sent");
  });

  root.querySelector("#conf-reserve-no")?.addEventListener("click", hide);
  root.querySelector("#conf-reserve-close")?.addEventListener("click", hide);
  root.addEventListener("click", (event) => {
    if (event.target === root) hide();
  });
  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !root.hidden) hide();
  });

  return {
    open,
    hide,
    refresh: paint,
    isOpen: () => !root.hidden,
    roomId: () => room?.id ?? null,
  };
}

function prettyRoom(id: string) {
  return id.replace(/^conf[_-]?/i, "Conference ").replace(/_/g, " ");
}
