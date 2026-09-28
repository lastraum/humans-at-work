/** Fill every office with a sitting bot so floor 1 is full and floor 2 opens.
 *
 *  Default: keep bots connected so you can clock in and ride the elevator.
 *  --once  assert overflow then disconnect
 *
 *  Requires the local Vite room: npm run dev
 *  Bots authenticate with token haw-fill-floor from loopback only.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import WebSocket from "ws";

const once = process.argv.includes("--once");
const url = process.argv.find((arg) => arg.startsWith("ws")) ?? "ws://127.0.0.1:5885/__room?id=floor-1";
const BOT_TOKEN = "haw-fill-floor";
const NAMES = [
  "Remy", "Jules", "Sam", "Kai", "Noor", "Ivy", "Omar", "Bea",
  "Theo", "Lina", "Wes", "Pia", "Hugo", "Nia", "Cal", "Eve",
  "Ash", "Ren", "Max", "Jo", "Quinn", "Sky", "Ned", "Val",
  "Ira", "Dot", "Leo", "Mae", "Oz", "Tess", "Wren", "Bo",
  "Cy", "Fay", "Gil", "Hana", "Ida", "Jem", "Kip", "Lux",
  "Nedra", "Oli", "Pearl", "Rafi", "Sol", "Uma", "Vera", "Will",
];
const COLORS = [
  "#e07a5f", "#81b29a", "#f2cc8f", "#3d405b", "#e9c46a",
  "#2a9d8f", "#e76f51", "#264653", "#8ab17d", "#bc6c25",
];

const plate = JSON.parse(
  readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "../data/floor-plate.json"), "utf8"),
);
const cell = Number(plate.grid?.cellSize) || 179;
const offices = plate.offices ?? [];
const officeIds = offices.map((office) => String(office.id));
const fixtureIds = new Set(
  (plate.avatars ?? []).map((avatar) => String(avatar.officeId ?? "")).filter((id) => officeIds.includes(id)),
);

function occupiedSeat(office) {
  const chair = (office.furniture ?? []).find(
    (item) => item.type === "chair" && (item.id === "chair" || item.id === "chair_a" || !item.id),
  );
  const cols = office.cols ?? 1;
  const rows = office.rows ?? 1;
  const cx = (cols * cell) / 2;
  const cy = (rows * cell) / 2;
  const local = chair?.occupied ?? { x: chair?.x ?? cx, y: chair?.y ?? cy };
  const dx = (local.x ?? cx) - cx;
  const dy = (local.y ?? cy) - cy;
  const rot = office.rot ?? 0;
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
  const facing = (((chair?.facing ?? 0) + rot + 180) % 360 + 360) % 360;
  return {
    x: office.col * cell + cx + rx,
    y: office.row * cell + cy + ry,
    facing,
    col: office.col,
    row: office.row,
  };
}

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
          color: extra.color ?? "#8a9aaa",
          x: extra.x ?? 10,
          y: extra.y ?? 20,
          facing: extra.facing ?? 90,
          pose: extra.pose ?? "stand",
          col: extra.col,
          row: extra.row,
          token: extra.token,
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

function waitForClaim(bot, deskId, before) {
  return waitFor(
    bot.msgs,
    (row, i, list) => {
      const next = list.slice(before);
      const err = next.find((m) => m.type === "error");
      if (err) throw new Error(`${bot.name} could not claim ${deskId}: ${err.message}`);
      return next.some(
        (m) =>
          m.type === "claim" &&
          m.claim?.deskId === deskId &&
          m.claim?.peerId === bot.id &&
          m.claim?.officeAd?.url,
      );
    },
    `${bot.name} claimed ${deskId}`,
  );
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
const onStop = () => {
  closeAll(clients);
  process.exit(0);
};

try {
  const scout = await connect("fill-scout", "Scout");
  clients.push(scout);
  const welcome = await waitFor(scout.msgs, (m) => m.type === "welcome", "scout welcome");
  const taken = new Set((welcome.claims ?? []).filter((c) => c.kind === "office").map((c) => c.deskId));
  const vacant = offices.filter((office) => !taken.has(office.id));

  console.log(
    `floor 1: ${officeIds.length} offices, ${fixtureIds.size} fixtures, ${taken.size} live claims, ${vacant.length} bots with window ads`,
  );

  for (let i = 0; i < vacant.length; i++) {
    const office = vacant[i];
    const seat = occupiedSeat(office);
    const name = NAMES[i] ?? `Bot ${i + 1}`;
    const bot = await connect(`bot-${office.id}`, name, {
      ...seat,
      pose: "sit",
      color: COLORS[i % COLORS.length],
      token: BOT_TOKEN,
    });
    clients.push(bot);
    await waitFor(bot.msgs, (m) => m.type === "welcome", `${name} welcome`);
    const before = bot.msgs.length;
    bot.ws.send(JSON.stringify({ type: "claim", deskId: office.id }));
    await waitForClaim(bot, office.id, before);
    bot.ws.send(JSON.stringify({ type: "state", ...seat, pose: "sit" }));
  }

  const alreadyOpen = welcome.floors?.includes(2) && welcome.maxFloor >= 2;
  if (!alreadyOpen) {
    await waitFor(
      scout.msgs,
      (m) => m.type === "floors" && Array.isArray(m.floors) && m.floors.includes(2) && m.maxFloor >= 2,
      "floor 2 catalog after fill",
      12000,
    );
  }

  const joiner = await connect("fill-joiner", "Joiner");
  clients.push(joiner);
  const joined = await waitFor(joiner.msgs, (m) => m.type === "welcome", "joiner welcome");
  if (!joined.floors?.includes(1) || !joined.floors?.includes(2) || joined.maxFloor < 2) {
    throw new Error(`joiner did not get overflow floor: ${JSON.stringify({ floors: joined.floors, maxFloor: joined.maxFloor })}`);
  }
  if (joined.floor !== 1) {
    throw new Error(`joiner should spawn on floor 1, got ${joined.floor}`);
  }

  joiner.ws.send(JSON.stringify({ type: "floor", floor: 2 }));
  const ride = await waitFor(
    joiner.msgs,
    (m) => m.type === "floor" && m.floor === 2,
    "joiner rode to floor 2",
  );
  const floor2Claims = (ride.claims ?? []).filter((c) => c.kind === "office");
  if (floor2Claims.length) {
    throw new Error(`new floor 2 should be vacant, had ${floor2Claims.length} office claims`);
  }

  console.log(
    `overflow open: floors ${JSON.stringify(joined.floors)} max ${joined.maxFloor}; joiner rode to empty floor 2`,
  );
  scout.ws.close();
  joiner.ws.close();

  if (once) {
    closeAll(clients);
    console.log("fill-floor ok");
    process.exit(0);
  }

  console.log(
    `bots holding ${vacant.length} offices with window ads. Nearby 6 show lamps + ad planes. Clock in, then take the elevator to 2nd floor.`,
  );
  console.log("Ctrl+C to send the bots home.");
  process.on("SIGINT", onStop);
  process.on("SIGTERM", onStop);
} catch (err) {
  closeAll(clients);
  const message = err instanceof Error ? err.message : String(err);
  if (message.includes("ECONNREFUSED") || message.includes("connect ECONNREFUSED")) {
    console.error("room is not up. Start it with npm run dev, then rerun: node scripts/test-fill-floor.mjs");
    process.exit(1);
  }
  console.error(message);
  process.exit(1);
}
