/** Staged teaser cast for screen recordings.
 *
 *  Sparse on purpose: kitchen hangout, one lived-in office, hallway walkers,
 *  rec beanbags, a handful of warm windows. Not a full-floor fill.
 *
 *  Requires the local Vite room: npm run dev
 *  Then: npm run teaser
 *
 *  Record at http://127.0.0.1:5885/?film
 *    ?film=chat     hide HUD, keep the AIM chat
 *    ?shot=kitchen  (default)  ?shot=office  ?shot=hall  ?shot=rec
 *    H cycles chrome: hidden → chat only → all UI
 *
 *  Sign in before recording so the five-minute guest cap does not cut a take.
 *  Ctrl+C sends the cast home. --once seats everyone, chats once, then exits.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import WebSocket from "ws";

const once = process.argv.includes("--once");
const url = process.argv.find((arg) => arg.startsWith("ws")) ?? "ws://127.0.0.1:5885/__room?id=floor-1";
const BOT_TOKEN = "haw-fill-floor";
const ENV_SCALE = 1.2;
const SCALE = 0.018 * ENV_SCALE;

const plate = JSON.parse(
  readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "../data/floor-plate.json"), "utf8"),
);
const cell = Number(plate.grid?.cellSize) || 179;
const offices = plate.offices ?? [];
const officeById = new Map(offices.map((office) => [office.id, office]));
const rec = (plate.recreations ?? [])[0];
const loose = plate.furniture ?? [];

const LOOKS = {
  jules: { gender: "f", skin: "#f1d2b6", hair: "#1a1a1a", eyes: "#3d6cb5", shirt: "#e76f51", pants: "#2c3340" },
  noor: { gender: "f", skin: "#8d5524", hair: "#1a1a1a", eyes: "#4a3428", shirt: "#9b5de5", pants: "#3d342e" },
  wes: { gender: "m", skin: "#c68642", hair: "#2a2118", eyes: "#2f6b4a", shirt: "#2a9d8f", pants: "#343a32" },
  lina: { gender: "f", skin: "#e8c4a8", hair: "#c4a574", eyes: "#1a1a2e", shirt: "#f4a261", pants: "#3a3f4a" },
  kai: { gender: "m", skin: "#6b3e26", hair: "#1a1a1a", eyes: "#7a8494", shirt: "#00bbf9", pants: "#2c3340" },
  remy: { gender: "m", skin: "#f1d2b6", hair: "#4a3728", eyes: "#3d6cb5", shirt: "#80b918", pants: "#343a32" },
  ivy: { gender: "f", skin: "#c68642", hair: "#d8d2c8", eyes: "#2f6b4a", shirt: "#f15bb5", pants: "#3a3f4a" },
  theo: { gender: "m", skin: "#8d5524", hair: "#5c3317", eyes: "#4a3428", shirt: "#e9c46a", pants: "#3d342e" },
  bea: { gender: "f", skin: "#e8c4a8", hair: "#2a2118", eyes: "#6b4a2a", shirt: "#00bbf9", pants: "#2c3340" },
  sam: { gender: "m", skin: "#f1d2b6", hair: "#1a1a1a", eyes: "#1a1a2e", shirt: "#e76f51", pants: "#3a3f4a" },
  nia: { gender: "f", skin: "#c68642", hair: "#c4a574", eyes: "#3d6cb5", shirt: "#9b5de5", pants: "#343a32" },
  cal: { gender: "m", skin: "#e8c4a8", hair: "#2a2118", eyes: "#2f6b4a", shirt: "#2a9d8f", pants: "#2c3340" },
  mae: { gender: "f", skin: "#f1d2b6", hair: "#d8d2c8", eyes: "#7a8494", shirt: "#f4a261", pants: "#3d342e" },
  hugo: { gender: "m", skin: "#6b3e26", hair: "#1a1a1a", eyes: "#4a3428", shirt: "#80b918", pants: "#3a3f4a" },
  nico: { gender: "m", skin: "#c68642", hair: "#2a2118", eyes: "#3d6cb5", shirt: "#4cc9f0", pants: "#2c3340" },
};

function sitY(type) {
  if (String(type).startsWith("stool")) return 0.435 * ENV_SCALE;
  if (type === "beanbag") return 0.36 * ENV_SCALE;
  if (type === "couch" || String(type).includes("sofa")) return 0.38 * ENV_SCALE;
  if (String(type).startsWith("lounge")) return 0.26 * ENV_SCALE;
  return 0.36 * 1.2 * ENV_SCALE;
}

function roomPoint(room, localX, localY, localFacing, extraFacing = 0) {
  const cols = room.cols ?? 1;
  const rows = room.rows ?? 1;
  const cx = (cols * cell) / 2;
  const cy = (rows * cell) / 2;
  const dx = localX - cx;
  const dy = localY - cy;
  const rot = room.rot ?? 0;
  let rx = dx;
  let ry = dy;
  if (rot === 90) {
    rx = -dy;
    ry = dx;
  } else if (rot === 180) {
    rx = -dx;
    ry = -dy;
  } else if (rot === 270) {
    rx = dy;
    ry = -dx;
  }
  const facing = (((localFacing ?? 0) + rot + extraFacing) % 360 + 360) % 360;
  return {
    x: room.col * cell + cx + rx,
    y: room.row * cell + cy + ry,
    facing,
    col: Math.floor((room.col * cell + cx + rx) / cell),
    row: Math.floor((room.row * cell + cy + ry) / cell),
  };
}

function officeChair(office) {
  const chair = (office.furniture ?? []).find(
    (item) => item.type === "chair" && (item.id === "chair" || item.id === "chair_a" || !item.id),
  );
  const pos = chair?.occupied ?? { x: chair?.x ?? cell / 2, y: chair?.y ?? cell / 2 };
  // Vacant mesh facing + 180 matches chairSeat / the sit half-turn. Occupied.facing is the chair mesh.
  return {
    ...roomPoint(office, pos.x, pos.y, chair?.facing ?? 0, 180),
    pose: "sit",
    seatId: chair?._uid,
    seatY: sitY("chair"),
  };
}

function officeCouch(office) {
  const couch = (office.furniture ?? []).find((item) => item.type === "couch");
  if (!couch) return null;
  return {
    ...roomPoint(office, couch.x, couch.y, couch.facing ?? 0, 180),
    pose: "sit",
    seatId: couch._uid ? `${couch._uid}:a` : undefined,
    seatY: sitY("couch"),
  };
}

function recCanvas(item) {
  if (!rec) return { x: item.x, y: item.y, facing: item.facing ?? 0 };
  return roomPoint(rec, item.x, item.y, item.facing ?? 0, 0);
}

function stools() {
  return loose
    .filter((item) => item.type === "stool_bar")
    .sort((a, b) => a.x - b.x)
    .map((item) => ({
      x: item.x,
      y: item.y,
      facing: 180,
      pose: "sit",
      seatId: item._uid,
      seatY: sitY("stool_bar"),
      col: Math.floor(item.x / cell),
      row: Math.floor(item.y / cell),
    }));
}

function beanbags() {
  const bags = (rec?.furniture ?? []).filter((item) => item.type === "beanbag");
  const seats = bags.map((item) => {
    const point = recCanvas(item);
    const forward = 0.32 / 0.018;
    const rad = ((item.facing ?? 0) * Math.PI) / 180;
    return {
      x: point.x + Math.sin(rad) * forward,
      y: point.y + Math.cos(rad) * forward,
      facing: point.facing,
      pose: "sit",
      seatId: item._uid,
      seatY: sitY("beanbag"),
      col: point.col,
      row: point.row,
    };
  });
  if (seats.length >= 3) {
    const cx = seats.reduce((sum, seat) => sum + seat.x, 0) / seats.length;
    const cy = seats.reduce((sum, seat) => sum + seat.y, 0) / seats.length;
    for (const seat of seats) {
      const look = (Math.atan2(cx - seat.x, cy - seat.y) * 180) / Math.PI;
      seat.facing = (((look + 180) % 360) + 360) % 360;
    }
  }
  return seats;
}

function hallX(col) {
  return col * cell + cell / 2;
}

function hallY(row) {
  return row * cell + cell / 2;
}

function walkMs(from, to) {
  const dist = Math.hypot(to.x - from.x, to.y - from.y) * SCALE;
  return Math.round(dist / 3.2 * 1000 + 2800);
}

const kitchenStools = stools();
const recBags = beanbags();
const livedIn = officeById.get("office_21");
const livedCouch = livedIn ? officeCouch(livedIn) : null;

const extraOffices = ["office_5_7", "office_23", "office_0_9", "office_5_8", "office_25"]
  .map((id) => officeById.get(id))
  .filter(Boolean);

const CAST = [
  kitchenStools[0] && {
    id: "bot-teaser-jules",
    name: "Jules",
    company: "Harbor Labs",
    timezone: "Europe/Lisbon",
    look: LOOKS.jules,
    available: true,
    pose: kitchenStools[0],
  },
  kitchenStools[2] && {
    id: "bot-teaser-noor",
    name: "Noor",
    company: "Night Shift",
    timezone: "Asia/Tokyo",
    look: LOOKS.noor,
    available: true,
    pose: kitchenStools[2],
  },
  kitchenStools[4] && {
    id: "bot-teaser-wes",
    name: "Wes",
    timezone: "Europe/Berlin",
    look: LOOKS.wes,
    available: true,
    pose: kitchenStools[4],
  },
  livedIn && {
    id: "bot-teaser-lina",
    name: "Lina",
    company: "Studio North",
    timezone: "America/Los_Angeles",
    look: LOOKS.lina,
    available: true,
    claim: livedIn.id,
    privacy: "open",
    pose: officeChair(livedIn),
  },
  livedCouch && {
    id: "bot-teaser-kai",
    name: "Kai",
    look: LOOKS.kai,
    available: true,
    pose: livedCouch,
  },
  {
    id: "bot-teaser-remy",
    name: "Remy",
    look: LOOKS.remy,
    available: true,
    pose: { x: hallX(1), y: hallY(6), facing: 0, pose: "stand", col: 1, row: 6 },
    patrol: [
      { x: hallX(1), y: hallY(6), wait: 400 },
      { x: 440, y: 1520, wait: 3200 },
      { x: hallX(1), y: hallY(7), wait: 2200 },
      { x: hallX(1), y: hallY(9), wait: 1200 },
      { x: 620, y: 2180, wait: 2800 },
      { x: hallX(1), y: hallY(9), wait: 400 },
    ],
  },
  {
    id: "bot-teaser-ivy",
    name: "Ivy",
    look: LOOKS.ivy,
    available: true,
    pose: { x: hallX(1), y: hallY(9), facing: 90, pose: "stand", col: 1, row: 9 },
    patrol: [
      { x: hallX(1), y: hallY(9) },
      { x: hallX(4), y: hallY(9) },
      { x: hallX(6), y: hallY(9) },
      { x: hallX(4), y: hallY(9) },
    ],
  },
  recBags[0] && {
    id: "bot-teaser-theo",
    name: "Theo",
    look: LOOKS.theo,
    available: true,
    pose: recBags[0],
  },
  recBags[1] && {
    id: "bot-teaser-bea",
    name: "Bea",
    look: LOOKS.bea,
    available: true,
    pose: recBags[1],
  },
  recBags[3] && {
    id: "bot-teaser-sam",
    name: "Sam",
    look: LOOKS.sam,
    pose: recBags[3],
  },
  extraOffices[0] && {
    id: "bot-teaser-nia",
    name: "Nia",
    company: "Late Desk",
    timezone: "America/New_York",
    look: LOOKS.nia,
    claim: extraOffices[0].id,
    pose: officeChair(extraOffices[0]),
  },
  extraOffices[1] && {
    id: "bot-teaser-cal",
    name: "Cal",
    timezone: "Europe/London",
    look: LOOKS.cal,
    claim: extraOffices[1].id,
    pose: officeChair(extraOffices[1]),
  },
  extraOffices[2] && {
    id: "bot-teaser-mae",
    name: "Mae",
    company: "Open Floor",
    timezone: "America/Sao_Paulo",
    look: LOOKS.mae,
    claim: extraOffices[2].id,
    pose: officeChair(extraOffices[2]),
  },
  extraOffices[3] && {
    id: "bot-teaser-hugo",
    name: "Hugo",
    timezone: "Australia/Sydney",
    look: LOOKS.hugo,
    claim: extraOffices[3].id,
    pose: officeChair(extraOffices[3]),
  },
  {
    id: "bot-teaser-nico",
    name: "Nico",
    look: LOOKS.nico,
    available: true,
    visit: "office_22",
    pose: { x: hallX(6), y: hallY(8), facing: 180, pose: "stand", col: 6, row: 8 },
  },
].filter(Boolean);

const CHAT = [
  { from: "bot-teaser-jules", text: "coffee's on if you're drifting through" },
  { from: "bot-teaser-noor", text: "tokyo 11pm. still here." },
  { from: "bot-teaser-wes", text: "lisbon just hit 4. same" },
  { from: "bot-teaser-lina", text: "door's open west of the kitchen if you want a quiet corner" },
  { from: "bot-teaser-kai", channel: "office", text: "this paragraph is fighting me" },
  { from: "bot-teaser-lina", channel: "office", text: "same. leave the door open, i'll look" },
  { from: "bot-teaser-remy", text: "heading down the hall — rec's got a seat" },
  { from: "bot-teaser-ivy", text: "anyone else just here to sit next to humans" },
  { from: "bot-teaser-theo", text: "beanbags are the move today" },
  { from: "bot-teaser-bea", text: "heads down, but i'm around" },
  { from: "bot-teaser-jules", text: "same. floor's quiet in a good way" },
  { from: "bot-teaser-kai", channel: "office", text: "shipping this today or i'm a ghost" },
  { from: "bot-teaser-noor", text: "still on. music off." },
  { from: "bot-teaser-lina", channel: "office", text: "i'll take a pass after this sentence" },
  { from: "bot-teaser-wes", text: "drop by the bar if you come up for air" },
  { from: "bot-teaser-sam", text: "pong later if anyone's still here" },
];

function connect(id, name, extra = {}) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const msgs = [];
    const timer = setTimeout(() => reject(new Error(`timeout connecting ${name}`)), 8000);
    ws.on("message", (data) => msgs.push(JSON.parse(String(data))));
    ws.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    ws.on("open", () => {
      clearTimeout(timer);
      ws.send(
        JSON.stringify({
          type: "hello",
          id,
          name,
          color: extra.look?.shirt ?? extra.color ?? "#f4a261",
          look: extra.look,
          company: extra.company,
          x: extra.x ?? 10,
          y: extra.y ?? 20,
          facing: extra.facing ?? 90,
          pose: extra.pose ?? "stand",
          col: extra.col,
          row: extra.row,
          seatId: extra.seatId,
          seatY: extra.seatY,
          token: extra.token ?? BOT_TOKEN,
        }),
      );
      resolve({ ws, msgs, id, name });
    });
  });
}

function waitFor(msgs, pred, label, ms = 8000) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const tick = () => {
      try {
        const hit = msgs.find(pred);
        if (hit) return resolve(hit);
      } catch (err) {
        return reject(err);
      }
      if (Date.now() - start > ms) return reject(new Error(`timeout waiting for ${label}`));
      setTimeout(tick, 25);
    };
    tick();
  });
}

function send(bot, payload) {
  if (bot.ws.readyState === WebSocket.OPEN) bot.ws.send(JSON.stringify(payload));
}

function closeAll(clients) {
  for (const client of clients) {
    try {
      client.ws.close();
    } catch {
      /* already closed */
    }
  }
}

const clients = [];
const byId = new Map();
const loops = [];

const onStop = () => {
  for (const stop of loops) stop();
  closeAll(clients);
  process.exit(0);
};

function startPatrol(bot, points) {
  if (!points?.length) return;
  let i = 1 % points.length;
  let timer = 0;
  const step = () => {
    if (bot.ws.readyState !== WebSocket.OPEN) return;
    const next = points[i];
    const prev = points[(i + points.length - 1) % points.length];
    send(bot, { type: "move", x: next.x, y: next.y });
    i = (i + 1) % points.length;
    timer = setTimeout(step, walkMs(prev, next) + (next.wait ?? 0));
  };
  timer = setTimeout(step, 1200);
  loops.push(() => clearTimeout(timer));
}

function startChat() {
  let i = 0;
  const tick = () => {
    const line = CHAT[i % CHAT.length];
    const bot = byId.get(line.from);
    if (bot) send(bot, { type: "chat", text: line.text, channel: line.channel === "office" ? "office" : "floor" });
    i += 1;
    timer = setTimeout(tick, 2800 + (i % 4) * 400);
  };
  let timer = setTimeout(tick, once ? 400 : 1200);
  loops.push(() => clearTimeout(timer));
}

function startVisitor(bot, officeId, from) {
  const office = officeById.get(officeId);
  const couch = office ? officeCouch(office) : null;
  if (!office || !couch) return;
  const door = { x: hallX(office.col - 1), y: hallY(office.row) };
  const out = { x: hallX(office.col - 1), y: hallY(office.row + 1), facing: 0 };
  let phase = "wait";
  const timers = [];
  const later = (ms, fn) => {
    const timer = setTimeout(fn, ms);
    timers.push(timer);
    return timer;
  };
  loops.push(() => {
    for (const timer of timers) clearTimeout(timer);
  });

  const sitDown = () => {
    if (phase !== "walking") return;
    phase = "seated";
    send(bot, { type: "state", ...couch });
    later(900, () => {
      if (phase === "seated") send(bot, { type: "chat", text: "hey — mind if i grab the couch?", channel: "office" });
    });
    later(3400, () => {
      if (phase === "seated") send(bot, { type: "chat", text: "needed a human in the room for this", channel: "office" });
    });
  };

  const goIn = () => {
    if (phase !== "wait") return;
    phase = "walking";
    send(bot, { type: "move", x: door.x, y: door.y });
    later(walkMs(from, door) + 200, () => {
      if (phase !== "walking") return;
      send(bot, { type: "move", x: couch.x, y: couch.y });
      later(walkMs(door, couch) + 400, sitDown);
    });
  };

  const leave = () => {
    if (phase === "leaving" || phase === "wait") return;
    phase = "leaving";
    send(bot, {
      type: "state",
      x: couch.x,
      y: couch.y,
      facing: 270,
      pose: "stand",
      col: Math.floor(couch.x / cell),
      row: Math.floor(couch.y / cell),
    });
    later(180, () => send(bot, { type: "move", x: out.x, y: out.y }));
  };

  bot.ws.on("message", (data) => {
    let msg;
    try {
      msg = JSON.parse(String(data));
    } catch {
      return;
    }
    if (msg.type === "claim" && msg.claim?.deskId === officeId && msg.claim?.peerId !== bot.id) {
      const privacy = msg.claim.privacy;
      if (privacy === "focus" || privacy === "busy") leave();
      else later(500, goIn);
    }
    if (msg.type === "boot" && msg.deskId === officeId) leave();
  });
}

try {
  for (const member of CAST) {
    const bot = await connect(member.id, member.name, {
      ...member.pose,
      look: member.look,
      company: member.company,
    });
    clients.push(bot);
    byId.set(member.id, bot);
    const welcome = await waitFor(bot.msgs, (m) => m.type === "welcome", `${member.name} welcome`);
    const taken = new Set((welcome.claims ?? []).filter((c) => c.kind === "office").map((c) => c.deskId));
    if (member.available) send(bot, { type: "chat-available", on: true });
    if (member.claim) {
      if (taken.has(member.claim)) {
        console.log(`skip ${member.name}: ${member.claim} already taken`);
      } else {
        const before = bot.msgs.length;
        send(bot, { type: "claim", deskId: member.claim, timezone: member.timezone });
        await waitFor(
          bot.msgs,
          (row, i, list) => {
            const next = list.slice(before);
            const err = next.find((m) => m.type === "error");
            if (err) throw new Error(`${member.name} could not claim ${member.claim}: ${err.message}`);
            return next.some(
              (m) => m.type === "claim" && m.claim?.deskId === member.claim && m.claim?.peerId === member.id,
            );
          },
          `${member.name} claimed ${member.claim}`,
        );
        if (member.privacy && member.privacy !== "open") {
          send(bot, { type: "privacy", privacy: member.privacy });
        }
      }
    }
    send(bot, { type: "state", ...member.pose });
    if (member.patrol) startPatrol(bot, member.patrol);
    if (member.visit) startVisitor(bot, member.visit, member.pose);
  }

  startChat();

  const seated = CAST.filter((m) => m.pose?.pose === "sit").length;
  const walking = CAST.filter((m) => m.patrol).length;
  const claimed = CAST.filter((m) => m.claim).length;
  const visiting = CAST.filter((m) => m.visit).length;
  console.log(
    `teaser cast: ${CAST.length} humans (${seated} sitting, ${walking} walking the hall, ${claimed} offices with lights on, ${visiting} dropping by)`,
  );

  if (once) {
    await new Promise((resolve) => setTimeout(resolve, 1200));
    for (const stop of loops) stop();
    closeAll(clients);
    console.log("teaser-floor ok");
    process.exit(0);
  }

  console.log("Clock in at http://127.0.0.1:5885/?film&follow=Remy");
  console.log("  Camera follows Remy like a player. H cycles chrome: hidden → chat only → all UI");
  console.log("Sign in before a long take. Ctrl+C sends the cast home.");
  process.on("SIGINT", onStop);
  process.on("SIGTERM", onStop);
} catch (err) {
  for (const stop of loops) stop();
  closeAll(clients);
  const message = err instanceof Error ? err.message : String(err);
  if (message.includes("ECONNREFUSED") || message.includes("connect ECONNREFUSED")) {
    console.error("room is not up. Start it with npm run dev, then rerun: npm run teaser");
    process.exit(1);
  }
  console.error(message);
  process.exit(1);
}
