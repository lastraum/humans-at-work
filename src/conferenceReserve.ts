import * as THREE from "three";
import { fromWorld } from "./coords";
import type { ConfAccess, ConferenceReservation } from "./protocol";
import type { FloorPlate, OfficeInstance } from "./types";

/** Day boundaries for the 1hr/day cap. Pacific unless the player shares location. */
export const TZ = "America/Los_Angeles";
const TZ_KEY = "haw-share-tz";

export function shareTimezone() {
  try {
    return localStorage.getItem(TZ_KEY) === "1";
  } catch {
    return false;
  }
}

export function setShareTimezone(on: boolean) {
  try {
    localStorage.setItem(TZ_KEY, on ? "1" : "0");
  } catch {
    /* ignore */
  }
}

export function activeTimeZone() {
  if (!shareTimezone()) return TZ;
  return Intl.DateTimeFormat().resolvedOptions().timeZone || TZ;
}

export function timezoneShort() {
  const tz = activeTimeZone();
  try {
    return (
      new Intl.DateTimeFormat("en-US", {
        timeZone: tz,
        timeZoneName: "short",
      })
        .formatToParts(new Date())
        .find((part) => part.type === "timeZoneName")?.value ?? tz
    );
  } catch {
    return tz;
  }
}

export function timezoneLabel() {
  const tz = activeTimeZone();
  const short = timezoneShort();
  const pretty = tz.replace(/_/g, " ");
  return short && short !== pretty ? `${short} · ${pretty}` : pretty;
}
export const SLOT = 30;
export const DAY_CAP = 60;
export const BOOK_START_MIN = 0;
export const BOOK_END_MIN = 24 * 60;

/** Display zone for labels. Booking math is always Pacific. */
export function ptDayKey(ms = Date.now()) {
  return reserveDayKey(ms);
}

export function reserveDayKey(ms = Date.now()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(ms));
}

export function ptClock(ms = Date.now()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TZ,
    hour: "numeric",
    minute: "numeric",
    hourCycle: "h23",
  }).formatToParts(new Date(ms));
  const hour = Number(parts.find((part) => part.type === "hour")?.value ?? 0);
  const minute = Number(parts.find((part) => part.type === "minute")?.value ?? 0);
  return {
    day: reserveDayKey(ms),
    min: ((hour === 24 ? 0 : hour) % 24) * 60 + minute,
  };
}

export function liveBooking(
  reservations: ConferenceReservation[],
  roomId: string,
  now = Date.now(),
): ConferenceReservation | null {
  const { day, min } = ptClock(now);
  return (
    reservations.find(
      (row) =>
        row.roomId === roomId &&
        row.day === day &&
        row.startMin <= min &&
        min < row.startMin + row.durationMin,
    ) ?? null
  );
}

export function canEnterConference(
  reservations: ConferenceReservation[],
  roomId: string,
  peerId: string,
  now = Date.now(),
): boolean {
  const live = liveBooking(reservations, roomId, now);
  if (!live) return true;
  if (live.access !== "code") return true;
  if (live.peerId === peerId) return true;
  return live.admitted === true;
}

export function conferenceCenter(room: OfficeInstance, plate: FloorPlate) {
  const cell = plate.grid.cellSize;
  const cols = room.cols ?? 1;
  const rows = room.rows ?? 1;
  return {
    x: (room.col + cols / 2) * cell,
    y: (room.row + rows / 2) * cell,
  };
}

function conferenceDoor(group: THREE.Object3D): THREE.Object3D | null {
  let found: THREE.Object3D | null = null;
  group.traverse((node) => {
    if (found) return;
    const item = node.userData?.item as { type?: string } | undefined;
    if (node.userData?.isDoor || item?.type === "door") found = node;
  });
  return found;
}

export function conferenceApproach(group: THREE.Object3D, plate: FloorPlate) {
  const door = conferenceDoor(group);
  if (door) {
    door.updateWorldMatrix(true, true);
    const edge = String(door.userData.doorEdge ?? "s");
    const alongX = Boolean(door.userData.alongX ?? (edge === "n" || edge === "s"));
    const local = new THREE.Vector3();
    if (alongX) local.z = edge === "n" ? -0.7 : 0.7;
    else local.x = edge === "w" ? -0.7 : 0.7;
    door.localToWorld(local);
    return fromWorld(local.x, local.z, plate);
  }
  const room = group.userData?.conference as OfficeInstance | undefined;
  if (room) {
    const cell = plate.grid.cellSize;
    const cols = room.cols ?? 1;
    const rows = room.rows ?? 1;
    return {
      x: (room.col + cols / 2) * cell,
      y: (room.row + rows) * cell + 20,
    };
  }
  return { x: 0, y: 0 };
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
  const notice = conferenceNotice(reservations, roomId, now);
  return notice.sub ? `${notice.title} · ${notice.sub}` : notice.title;
}

export function conferenceNotice(
  reservations: ConferenceReservation[],
  roomId: string,
  now = Date.now(),
): { title: string; sub?: string; tone: "idle" | "open" | "busy" } {
  const { day, min: nowMin } = ptClock(now);
  const live = liveBooking(reservations, roomId, now);
  if (live) {
    const until = `until ${clockLabel(live.startMin + live.durationMin)}`;
    if (live.access === "code") return { title: "In use", sub: until, tone: "busy" };
    return { title: "Open", sub: until, tone: "open" };
  }
  const upcoming = roomBookings(reservations, roomId, day).find((row) => row.startMin > nowMin);
  if (upcoming) {
    return { title: "Next", sub: clockLabel(upcoming.startMin), tone: "idle" };
  }
  return { title: "Reserve", tone: "idle" };
}

export function pickConferenceNotice(
  camera: THREE.Camera,
  pointer: THREE.Vector2,
  root: THREE.Object3D,
): OfficeInstance | null {
  const ray = new THREE.Raycaster();
  ray.setFromCamera(pointer, camera);
  for (const hit of ray.intersectObjects(root.children, true)) {
    let node: THREE.Object3D | null = hit.object;
    while (node) {
      const item = node.userData?.item as { type?: string } | undefined;
      if (node.name === "door-plate" || node.userData?.isDoor || item?.type === "door") {
        let parent: THREE.Object3D | null = node;
        while (parent) {
          const conf = parent.userData?.conference as OfficeInstance | undefined;
          if (conf) return conf;
          parent = parent.parent;
        }
      }
      node = node.parent;
    }
  }
  return null;
}

export type ReserveUiHandlers = {
  getReservations: () => ConferenceReservation[];
  getPeerId: () => string;
  isSignedIn: () => boolean;
  askSignIn: (reason: string) => void;
  onReserve: (
    roomId: string,
    day: string,
    startMin: number,
    durationMin: 30 | 60,
    access: ConfAccess,
  ) => void;
  onCancel: (id: string) => void;
  onSetAccess?: (id: string, access: ConfAccess) => void;
  onJoin?: (roomId: string, code: string) => void;
  getOccupants?: (roomId: string) => { id: string; name: string; self?: boolean }[];
  onBoot?: (roomId: string, peerId: string) => void;
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
  const accessHint = document.querySelector<HTMLElement>("#conf-reserve-access-hint");
  const peopleWell = document.querySelector<HTMLElement>("#conf-reserve-people-well");
  const peopleEl = document.querySelector("#conf-reserve-people");
  const slotsAcc = document.querySelector<HTMLElement>("#conf-acc-slots");
  const roomAcc = document.querySelector<HTMLElement>("#conf-acc-room");
  const slotsHead = document.querySelector<HTMLElement>("#conf-acc-slots-head");
  const roomHead = document.querySelector<HTMLElement>("#conf-acc-room-head");
  const joinRoot = document.querySelector<HTMLElement>("#conf-join");
  const joinHello = document.querySelector("#conf-join-hello");
  const joinErr = document.querySelector<HTMLElement>("#conf-join-error");
  const joinInput = document.querySelector<HTMLInputElement>("#conf-join-code");

  let room: OfficeInstance | null = null;
  let joinRoom: OfficeInstance | null = null;
  let selectedStart: number | null = null;
  let selectedDur: 30 | 60 = 30;
  let selectedAccess: ConfAccess = "open";
  let lastHadMine: boolean | null = null;

  const hide = () => {
    room = null;
    selectedStart = null;
    lastHadMine = null;
    root.hidden = true;
  };

  const setAccOpen = (el: HTMLElement | null, open: boolean) => {
    el?.classList.toggle("open", open);
  };

  const syncAccordions = (hasMine: boolean, reset = false) => {
    if (reset || lastHadMine !== hasMine) {
      setAccOpen(slotsAcc, !hasMine);
      setAccOpen(roomAcc, hasMine);
      lastHadMine = hasMine;
    }
  };

  const hideJoin = () => {
    joinRoom = null;
    if (joinRoot) joinRoot.hidden = true;
    if (joinInput) joinInput.value = "";
    if (joinErr) joinErr.textContent = "";
  };

  const copyText = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      handlers.onStatus?.("code copied");
    } catch {
      handlers.onStatus?.("copy failed");
    }
  };

  const paint = () => {
    if (!room) return;
    const day = dayEl.value || reserveDayKey();
    const peerId = handlers.getPeerId();
    const all = handlers.getReservations();
    const left = remainingMinutes(all, peerId, day);
    const bookings = roomBookings(all, room.id, day);
    const { day: today, min: nowMin } = ptClock();
    allowEl.textContent = `${left} min left today · ${timezoneLabel()} · max ${DAY_CAP} min / person / day`;

    Array.from(root.querySelectorAll<HTMLButtonElement>("[data-access]")).forEach((btn) => {
      btn.classList.toggle("on", btn.dataset.access === selectedAccess);
    });
    if (accessHint) {
      accessHint.textContent =
        selectedAccess === "code"
          ? "You'll get a door code. Share it, or flip the room open later."
          : "Anyone on the floor can walk in during your slot.";
    }

    const live = liveBooking(all, room.id);
    paintPeople(live);

    slotsEl.innerHTML = "";
    for (let start = BOOK_START_MIN; start + SLOT <= BOOK_END_MIN; start += SLOT) {
      const taken = bookings.find((row) => overlaps(start, SLOT, row.startMin, row.durationMin));
      const past = day === today && start < nowMin;
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "conf-slot";
      if (taken) {
        btn.disabled = true;
        btn.classList.add("taken");
        const kind = taken.access === "code" ? "code" : "open";
        btn.title = `${taken.name} · ${taken.durationMin}m · ${kind}`;
        btn.textContent = `${clockLabel(start)} · ${taken.name}`;
      } else if (past) {
        btn.disabled = true;
        btn.classList.add("blocked");
        btn.title = "already started";
        btn.textContent = clockLabel(start);
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
                ? `runs past midnight ${timezoneShort()}`
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
    const mine = all.filter((row) => row.peerId === peerId && row.day >= today);
    const mineHere = mine.filter((row) => row.roomId === room!.id);
    syncAccordions(mineHere.length > 0);
    if (!mine.length) {
      mineEl.textContent = "No upcoming reservations.";
    } else {
      for (const row of mine) {
        const line = document.createElement("div");
        line.className = "conf-mine-row";
        const label = document.createElement("span");
        const where = row.roomId === room.id ? "This room" : prettyRoom(row.roomId);
        const access = row.access === "code" ? (row.code ? `code ${row.code}` : "code") : "open";
        label.textContent = `${where} · ${row.day} · ${clockLabel(row.startMin)} (${row.durationMin}m) · ${access}`;
        const actions = document.createElement("div");
        actions.className = "conf-mine-actions";
        if (row.access === "code" && row.code) {
          const copy = document.createElement("button");
          copy.type = "button";
          copy.textContent = "Copy";
          copy.addEventListener("click", () => void copyText(row.code!));
          actions.appendChild(copy);
        }
        if (handlers.onSetAccess) {
          const flip = document.createElement("button");
          flip.type = "button";
          flip.textContent = row.access === "code" ? "Make open" : "Require code";
          flip.addEventListener("click", () =>
            handlers.onSetAccess?.(row.id, row.access === "code" ? "open" : "code"),
          );
          actions.appendChild(flip);
        }
        const cancel = document.createElement("button");
        cancel.type = "button";
        cancel.textContent = "Cancel";
        cancel.addEventListener("click", () => handlers.onCancel(row.id));
        actions.appendChild(cancel);
        line.append(label, actions);
        mineEl.appendChild(line);
      }
    }

    Array.from(root.querySelectorAll<HTMLButtonElement>("[data-dur]")).forEach((btn) => {
      const dur = Number(btn.dataset.dur) as 30 | 60;
      btn.classList.toggle("on", selectedDur === dur);
      btn.disabled = dur > left;
    });
  };

  const paintPeople = (live = room ? liveBooking(handlers.getReservations(), room.id) : null) => {
    if (!peopleEl || !room) return;
    const peerId = handlers.getPeerId();
    const host = live?.peerId === peerId;
    const occupants = handlers.getOccupants?.(room.id) ?? [];
    peopleEl.innerHTML = "";
    if (peopleWell) peopleWell.hidden = false;
    if (roomHead) {
      const n = occupants.length;
      roomHead.textContent = n ? `This room · ${n} inside` : "This room";
    }
    if (!occupants.length) {
      peopleEl.textContent = "Empty.";
      return;
    }
    for (const person of occupants) {
      const line = document.createElement("div");
      line.className = "conf-mine-row";
      const label = document.createElement("span");
      label.textContent = person.self ? `${person.name} (you)` : person.name;
      line.appendChild(label);
      if (host && !person.self && handlers.onBoot) {
        const boot = document.createElement("button");
        boot.type = "button";
        boot.textContent = "Boot";
        boot.addEventListener("click", () => handlers.onBoot?.(room!.id, person.id));
        line.appendChild(boot);
      }
      peopleEl.appendChild(line);
    }
  };

  const open = (next: OfficeInstance) => {
    hideJoin();
    room = next;
    selectedStart = null;
    selectedDur = 30;
    const live = liveBooking(handlers.getReservations(), next.id);
    selectedAccess =
      live?.peerId === handlers.getPeerId() && live.access === "code" ? "code" : "open";
    dayEl.value = reserveDayKey();
    title.textContent = "Reserve conference room";
    hello.textContent = prettyRoom(next.id);
    root.hidden = false;
    errEl.textContent = "";
    lastHadMine = null;
    paint();
  };

  const openJoin = (next: OfficeInstance) => {
    hide();
    joinRoom = next;
    if (!joinRoot) return;
    if (joinHello) joinHello.textContent = `${prettyRoom(next.id)} is code-only right now.`;
    if (joinErr) joinErr.textContent = "";
    if (joinInput) {
      joinInput.value = "";
      joinInput.focus();
    }
    joinRoot.hidden = false;
  };

  slotsHead?.addEventListener("click", () => {
    slotsAcc?.classList.toggle("open");
  });
  roomHead?.addEventListener("click", () => {
    roomAcc?.classList.toggle("open");
  });

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

  root.querySelectorAll<HTMLButtonElement>("[data-access]").forEach((btn) => {
    btn.addEventListener("click", () => {
      selectedAccess = btn.dataset.access === "code" ? "code" : "open";
      if (room && handlers.onSetAccess) {
        const live = liveBooking(handlers.getReservations(), room.id);
        if (live?.peerId === handlers.getPeerId() && live.access !== selectedAccess) {
          handlers.onSetAccess(live.id, selectedAccess);
        }
      }
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
    const day = dayEl.value || reserveDayKey();
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
      errEl.textContent = `That duration runs past midnight ${timezoneShort()}.`;
      return;
    }
    const { day: today, min: nowMin } = ptClock();
    if (day === today && selectedStart < nowMin) {
      errEl.textContent = "That time already started.";
      paint();
      return;
    }
    handlers.onReserve(room.id, day, selectedStart, selectedDur, selectedAccess);
    handlers.onStatus?.("reservation sent");
  });

  root.querySelector("#conf-reserve-no")?.addEventListener("click", hide);
  root.querySelector("#conf-reserve-close")?.addEventListener("click", hide);
  root.addEventListener("click", (event) => {
    if (event.target === root) hide();
  });

  joinRoot?.querySelector("#conf-join-go")?.addEventListener("click", () => {
    if (!joinRoom) return;
    const code = joinInput?.value ?? "";
    if (!code.trim()) {
      if (joinErr) joinErr.textContent = "Enter the door code.";
      return;
    }
    handlers.onJoin?.(joinRoom.id, code);
  });
  joinRoot?.querySelector("#conf-join-reserve")?.addEventListener("click", () => {
    const next = joinRoom;
    hideJoin();
    if (next) open(next);
  });
  joinRoot?.querySelector("#conf-join-no")?.addEventListener("click", hideJoin);
  joinRoot?.querySelector("#conf-join-close")?.addEventListener("click", hideJoin);
  joinRoot?.addEventListener("click", (event) => {
    if (event.target === joinRoot) hideJoin();
  });
  joinInput?.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    joinRoot?.querySelector<HTMLButtonElement>("#conf-join-go")?.click();
  });

  window.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    if (joinRoot && !joinRoot.hidden) hideJoin();
    else if (!root.hidden) hide();
  });

  return {
    open,
    hide,
    openJoin,
    hideJoin,
    refresh: paint,
    refreshPeople: () => paintPeople(),
    joinError(text: string) {
      if (joinErr) joinErr.textContent = text;
    },
    isOpen: () => !root.hidden,
    isJoinOpen: () => Boolean(joinRoot && !joinRoot.hidden),
    roomId: () => room?.id ?? joinRoom?.id ?? null,
  };
}

export function prettyRoom(id: string) {
  return id.replace(/^conf[_-]?/i, "Conference ").replace(/_/g, " ");
}
