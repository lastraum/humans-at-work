import { timingSafeEqual } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import type { IncomingMessage } from "node:http";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnv, type Plugin } from "vite";
import { bankMinutes, guestGrant, xpRateLabel } from "../src/xp";
import { absorbUserXp, accountXpSummary, creditUserXp, hasUser, readUserXp } from "./auth";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const storePath = resolve(rootDir, "data/presence.json");

type Visitor = {
  id: string;
  firstSeen: number;
  lastSeen: number;
  sessions: number;
  totalMs: number;
  xp: number;
  remainderMs: number;
  everSignedIn: boolean;
  tz?: string;
  country?: string;
  /** Pacific day (YYYY-MM-DD) of the latest finished shift. */
  day: string;
  daySessions: number;
  dayMs: number;
  daysSeen: number;
};

type Store = { visitors: Visitor[] };

type Socket = { readyState: number; send: (data: string) => void };

type Live = {
  id: string;
  ws: Socket;
  startedAt: number;
  lastTickAt: number;
  signedIn: boolean;
  /** Unsigned milliseconds already granted on this connection. */
  guestMs: number;
  /** Guest visit is over; further time does not bank until sign-in. */
  held: boolean;
  tz?: string;
  country?: string;
};

const OPEN = 1;
const lives = new Map<string, Live>();
let queue: Promise<unknown> = Promise.resolve();
let tick: ReturnType<typeof setInterval> | null = null;

function emptyStore(): Store {
  return { visitors: [] };
}

function loadStore(): Store {
  try {
    const parsed = JSON.parse(readFileSync(storePath, "utf8")) as Partial<Store>;
    const visitors = Array.isArray(parsed.visitors) ? parsed.visitors : [];
    return {
      visitors: visitors.filter((row) => row && typeof row.id === "string" && row.id),
    };
  } catch {
    return emptyStore();
  }
}

function saveStore(store: Store) {
  mkdirSync(dirname(storePath), { recursive: true });
  const tmp = `${storePath}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(store, null, 2)}\n`);
  renameSync(tmp, storePath);
}

function enqueue<T>(fn: () => Promise<T> | T): Promise<T> {
  const run = queue.then(fn, fn);
  queue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

export function isFloorBot(id: string) {
  return id.startsWith("bot-") || id === "debug-bot";
}

export function clockZone(value: unknown) {
  const tz = String(value ?? "").trim();
  if (!tz || tz.length > 64 || /[\r\n<>]/.test(tz)) return;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz }).format(0);
    return tz;
  } catch {
    return;
  }
}

export function countryFrom(req: IncomingMessage) {
  const header =
    req.headers["cf-ipcountry"] ?? req.headers["x-country-code"] ?? req.headers["x-vercel-ip-country"];
  const raw = Array.isArray(header) ? header[0] : header;
  const code = String(raw ?? "")
    .trim()
    .toUpperCase();
  if (!/^[A-Z]{2}$/.test(code) || code === "XX" || code === "T1") return;
  return code;
}

function ptDay(ms = Date.now()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(ms));
}

function blankVisitor(id: string, now: number): Visitor {
  return {
    id,
    firstSeen: now,
    lastSeen: now,
    sessions: 0,
    totalMs: 0,
    xp: 0,
    remainderMs: 0,
    everSignedIn: false,
    day: "",
    daySessions: 0,
    dayMs: 0,
    daysSeen: 0,
  };
}

function visitorOf(store: Store, id: string, now: number) {
  let row = store.visitors.find((item) => item.id === id);
  if (!row) {
    row = blankVisitor(id, now);
    store.visitors.push(row);
  }
  return row;
}

function pushXp(ws: Socket, xp: number) {
  if (ws.readyState !== OPEN) return;
  try {
    ws.send(JSON.stringify({ type: "xp", xp }));
  } catch {
    /* socket already closing */
  }
}

function balanceOf(id: string) {
  if (hasUser(id)) return readUserXp(id);
  const row = loadStore().visitors.find((item) => item.id === id);
  return Math.max(0, Math.floor(Number(row?.xp) || 0));
}

async function credit(id: string, elapsedMs: number) {
  if (elapsedMs <= 0) return balanceOf(id);
  if (hasUser(id)) {
    const saved = await creditUserXp(id, elapsedMs);
    return saved.xp;
  }
  const store = loadStore();
  const row = visitorOf(store, id, Date.now());
  const banked = bankMinutes(Math.max(0, Number(row.remainderMs) || 0), elapsedMs);
  row.xp = Math.max(0, Math.floor(Number(row.xp) || 0)) + banked.xp;
  row.remainderMs = banked.remainderMs;
  saveStore(store);
  return row.xp;
}

function takeVisitorXp(id: string) {
  const store = loadStore();
  const row = store.visitors.find((item) => item.id === id);
  if (!row) return { xp: 0, remainderMs: 0 };
  const xp = Math.max(0, Math.floor(Number(row.xp) || 0));
  const remainderMs = Math.max(0, Number(row.remainderMs) || 0);
  if (!xp && !remainderMs) return { xp: 0, remainderMs: 0 };
  row.xp = 0;
  row.remainderMs = 0;
  saveStore(store);
  return { xp, remainderMs };
}

async function absorbAccount(id: string, ws: Socket) {
  if (!hasUser(id)) return;
  const moved = takeVisitorXp(id);
  if (!moved.xp && !moved.remainderMs) return;
  const saved = await absorbUserXp(id, moved.xp, moved.remainderMs);
  pushXp(ws, saved.xp);
}

function remember(id: string, ws: Socket, opts: { tz?: string; country?: string; signedIn: boolean; startedAt: number }) {
  return enqueue(async () => {
    const store = loadStore();
    const row = visitorOf(store, id, opts.startedAt);
    if (opts.tz) row.tz = opts.tz;
    if (opts.country) row.country = opts.country;
    if (opts.signedIn) row.everSignedIn = true;
    saveStore(store);
    await absorbAccount(id, ws);
  });
}

function recordShift(store: Store, live: Live, duration: number, endedAt: number) {
  const row = visitorOf(store, live.id, live.startedAt);
  const day = ptDay(endedAt);
  if (row.day !== day) {
    row.daysSeen = (row.daysSeen || 0) + 1;
    row.day = day;
    row.daySessions = 0;
    row.dayMs = 0;
  }
  row.sessions += 1;
  row.totalMs += duration;
  row.daySessions += 1;
  row.dayMs += duration;
  row.lastSeen = endedAt;
  if (!row.firstSeen || row.firstSeen > live.startedAt) row.firstSeen = live.startedAt;
  if (live.signedIn) row.everSignedIn = true;
  if (live.tz) row.tz = live.tz;
  if (live.country) row.country = live.country;
}

function takeElapsed(live: Live, now = Date.now()) {
  const ms = Math.max(0, now - live.lastTickAt);
  live.lastTickAt = now;
  return ms;
}

function takeGrant(live: Live, now = Date.now()) {
  const next = guestGrant({
    guestMs: live.guestMs,
    elapsedMs: takeElapsed(live, now),
    signedIn: live.signedIn,
    held: live.held,
  });
  live.guestMs = next.guestMs;
  live.held = next.held;
  return next.grant;
}

function finish(live: Live) {
  if (lives.get(live.id) === live) lives.delete(live.id);
  const now = Date.now();
  const grant = takeGrant(live, now);
  const duration = Math.max(0, now - live.startedAt);
  void enqueue(async () => {
    await credit(live.id, grant);
    const store = loadStore();
    recordShift(store, live, duration, now);
    saveStore(store);
  });
}

export function noteHello(opts: {
  id: string;
  ws: Socket;
  signedIn: boolean;
  bot: boolean;
  tz?: string;
  country?: string;
}) {
  if (!opts.id || opts.bot || isFloorBot(opts.id)) return 0;
  const now = Date.now();
  for (const [oldId, live] of lives) {
    if (live.ws !== opts.ws || oldId === opts.id) continue;
    const grant = takeGrant(live, now);
    lives.delete(oldId);
    const signedIn = opts.signedIn || live.signedIn;
    const next: Live = {
      id: opts.id,
      ws: opts.ws,
      startedAt: live.startedAt,
      lastTickAt: now,
      signedIn,
      guestMs: signedIn ? 0 : live.guestMs,
      held: signedIn ? false : live.held,
      tz: opts.tz || live.tz,
      country: opts.country || live.country,
    };
    lives.set(opts.id, next);
    void enqueue(async () => {
      await credit(oldId, grant);
      if (hasUser(opts.id)) {
        const moved = takeVisitorXp(oldId);
        if (moved.xp || moved.remainderMs) {
          const saved = await absorbUserXp(opts.id, moved.xp, moved.remainderMs);
          pushXp(opts.ws, saved.xp);
        }
      }
      const store = loadStore();
      const row = visitorOf(store, opts.id, next.startedAt);
      if (next.tz) row.tz = next.tz;
      if (next.country) row.country = next.country;
      if (next.signedIn) row.everSignedIn = true;
      saveStore(store);
      await absorbAccount(opts.id, opts.ws);
    });
    return balanceOf(opts.id);
  }

  const existing = lives.get(opts.id);
  if (existing && existing.ws === opts.ws) {
    if (opts.signedIn && existing.held && !existing.signedIn) {
      existing.lastTickAt = now;
      existing.held = false;
    }
    existing.signedIn = existing.signedIn || opts.signedIn;
    if (opts.tz) existing.tz = opts.tz;
    if (opts.country) existing.country = opts.country;
    void remember(opts.id, opts.ws, {
      tz: existing.tz,
      country: existing.country,
      signedIn: existing.signedIn,
      startedAt: existing.startedAt,
    });
    return balanceOf(opts.id);
  }
  if (existing) finish(existing);
  lives.set(opts.id, {
    id: opts.id,
    ws: opts.ws,
    startedAt: now,
    lastTickAt: now,
    signedIn: opts.signedIn,
    guestMs: 0,
    held: false,
    tz: opts.tz,
    country: opts.country,
  });
  void remember(opts.id, opts.ws, {
    tz: opts.tz,
    country: opts.country,
    signedIn: opts.signedIn,
    startedAt: now,
  });
  return balanceOf(opts.id);
}

export function noteShiftHold(id: string, ws: Socket) {
  const live = lives.get(id);
  if (!live || live.ws !== ws || live.signedIn) return;
  const grant = takeGrant(live);
  live.held = true;
  if (grant <= 0) return;
  void enqueue(async () => {
    const xp = await credit(id, grant);
    if (lives.get(id)?.ws === ws) pushXp(ws, xp);
  });
}

export function noteClose(id: string, ws: Socket) {
  if (!id || isFloorBot(id)) return;
  const live = lives.get(id);
  if (!live || live.ws !== ws) return;
  finish(live);
}

export function startPresenceTick() {
  if (tick) return;
  const handle = setInterval(() => {
    const now = Date.now();
    for (const live of lives.values()) {
      if (now - live.lastTickAt < 30_000) continue;
      const grant = takeGrant(live, now);
      if (grant <= 0) continue;
      const { id, ws } = live;
      void enqueue(async () => {
        const xp = await credit(id, grant);
        if (lives.get(id)?.ws === ws) pushXp(ws, xp);
      });
    }
  }, 30_000);
  tick = handle;
  if (typeof handle === "object" && handle && "unref" in handle) handle.unref();
}

export function stopPresenceTick() {
  if (!tick) return;
  clearInterval(tick);
  tick = null;
}

function formatDuration(ms: number) {
  const sec = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (h && m) return `${h}h ${m}m`;
  if (h) return `${h}h`;
  if (m) return `${m}m`;
  return `${sec}s`;
}

function esc(value: unknown) {
  return String(value ?? "").replace(/[&<>"']/g, (ch) => {
    if (ch === "&") return "&amp;";
    if (ch === "<") return "&lt;";
    if (ch === ">") return "&gt;";
    if (ch === '"') return "&quot;";
    return "&#39;";
  });
}

function regionName(code: string) {
  try {
    return new Intl.DisplayNames(["en"], { type: "region" }).of(code) ?? code;
  } catch {
    return code;
  }
}

function zoneLabel(tz: string) {
  return tz.replace(/_/g, " ");
}

function dashboardHtml() {
  const store = loadStore();
  const now = Date.now();
  const today = ptDay(now);
  const accounts = accountXpSummary();
  let guestXp = 0;
  let shifts = 0;
  let totalMs = 0;
  let repeat = 0;
  let anotherDay = 0;
  let signedInVisitors = 0;
  let todayShifts = 0;
  let todayMs = 0;
  let todayHumans = 0;
  const seen = new Set<string>();
  const zones = new Map<string, { people: number; ms: number }>();
  const countries = new Map<string, { people: number; ms: number }>();

  for (const row of store.visitors) {
    seen.add(row.id);
    const sessions = Math.max(0, Math.floor(Number(row.sessions) || 0));
    const ms = Math.max(0, Number(row.totalMs) || 0);
    shifts += sessions;
    totalMs += ms;
    if (sessions >= 2) repeat += 1;
    if ((row.daysSeen || 0) >= 2) anotherDay += 1;
    if (row.everSignedIn) signedInVisitors += 1;
    guestXp += Math.max(0, Math.floor(Number(row.xp) || 0));
    if (row.day === today) {
      todayShifts += Math.max(0, Math.floor(Number(row.daySessions) || 0));
      todayMs += Math.max(0, Number(row.dayMs) || 0);
      if ((row.daySessions || 0) > 0) todayHumans += 1;
    }
    if (row.tz) {
      const bucket = zones.get(row.tz) ?? { people: 0, ms: 0 };
      bucket.people += 1;
      bucket.ms += ms;
      zones.set(row.tz, bucket);
    }
    if (row.country) {
      const bucket = countries.get(row.country) ?? { people: 0, ms: 0 };
      bucket.people += 1;
      bucket.ms += ms;
      countries.set(row.country, bucket);
    }
  }

  let openMs = 0;
  for (const live of lives.values()) {
    openMs += Math.max(0, now - live.startedAt);
    seen.add(live.id);
  }
  const unique = seen.size;
  const average = shifts ? totalMs / shifts : 0;
  const zoneRows = [...zones.entries()].sort((a, b) => b[1].ms - a[1].ms || b[1].people - a[1].people);
  const countryRows = [...countries.entries()].sort((a, b) => b[1].people - a[1].people || b[1].ms - a[1].ms);

  const cards: [string, string][] = [
    [String(lives.size), "On the floor now"],
    [formatDuration(openMs), "Open shifts, so far"],
    [String(unique), "Unique visitors"],
    [String(repeat), "Repeat (2+ shifts)"],
    [String(anotherDay), "Came back another day"],
    [String(shifts), "Finished shifts"],
    [shifts ? formatDuration(average) : "—", "Average shift"],
    [formatDuration(totalMs), "Time on the clock"],
    [String(todayHumans), "Humans who finished a shift today"],
    [String(todayShifts), "Shifts finished today"],
    [formatDuration(todayMs), "Time finished today"],
    [String(signedInVisitors), "Visitors who signed in"],
    [String(accounts.accounts), "Accounts"],
    [(accounts.xp + guestXp).toLocaleString("en-US"), "XP on the books"],
  ];

  const table = (head: string, rows: string) =>
    rows
      ? `<h2>${head}</h2><table><thead><tr><th></th><th>Humans</th><th>Time</th></tr></thead><tbody>${rows}</tbody></table>`
      : "";

  const zoneTable = table(
    "Where they clock in",
    zoneRows
      .map(
        ([tz, row]) =>
          `<tr><td>${esc(zoneLabel(tz))}</td><td>${row.people}</td><td>${esc(formatDuration(row.ms))}</td></tr>`,
      )
      .join(""),
  );
  const countryTable = table(
    "Country, when the proxy sends one",
    countryRows
      .map(
        ([code, row]) =>
          `<tr><td>${esc(regionName(code))}</td><td>${row.people}</td><td>${esc(formatDuration(row.ms))}</td></tr>`,
      )
      .join(""),
  );

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="robots" content="noindex" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Humans at Work — floor</title>
  <style>
    body { margin: 32px auto; max-width: 920px; padding: 0 16px 48px; color: #1c1915; background: #f6f1e8; font: 15px/1.45 ui-sans-serif, system-ui, sans-serif; }
    h1 { font-size: 22px; margin: 0 0 4px; }
    h2 { font-size: 14px; margin: 28px 0 8px; }
    p { color: #5c564c; }
    .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(190px, 1fr)); gap: 10px; }
    .card { background: #fff; border: 1px solid #d9d0c2; padding: 12px 14px; }
    .card b { display: block; font-size: 22px; font-variant-numeric: tabular-nums; }
    .card span { color: #5c564c; font-size: 12px; }
    table { width: 100%; border-collapse: collapse; background: #fff; }
    th, td { text-align: left; padding: 7px 8px; border-bottom: 1px solid #eee4d6; font-variant-numeric: tabular-nums; }
    th { font-size: 12px; color: #5c564c; font-weight: 600; }
  </style>
</head>
<body>
  <h1>Humans at Work</h1>
  <p>Shifts are room connections. A page load that never clocks in is not counted. Today is Pacific. ${esc(xpRateLabel())}.</p>
  <div class="grid">
    ${cards
      .map(([value, label]) => `<div class="card"><b>${esc(value)}</b><span>${esc(label)}</span></div>`)
      .join("")}
  </div>
  ${zoneTable}
  ${countryTable}
</body>
</html>`;
}

function secretMatch(pathname: string, secret: string) {
  let path = pathname;
  try {
    path = decodeURIComponent(pathname);
  } catch {
    return false;
  }
  const got = Buffer.from(path);
  const want = Buffer.from(`/${secret}`);
  if (got.length !== want.length) return false;
  return timingSafeEqual(got, want);
}

export function presencePlugin(): Plugin {
  return {
    name: "haw-presence",
    configureServer(server) {
      const flag = "__hawPresence" as const;
      if ((server as typeof server & { [flag]?: boolean })[flag]) return;
      (server as typeof server & { [flag]?: boolean })[flag] = true;
      startPresenceTick();
      const env = loadEnv(server.config.mode, server.config.root, "");
      const secret = (env.STATS_AUTH || process.env.STATS_AUTH || "").trim();
      const enabled = /^[A-Za-z0-9_-]{16,128}$/.test(secret);
      server.middlewares.use((req, res, next) => {
        const url = new URL(req.url ?? "/", "http://localhost");
        if (url.pathname === "/data/presence.json" || url.pathname === "/presence.json") {
          res.statusCode = 404;
          res.end();
          return;
        }
        if (!enabled || !secretMatch(url.pathname, secret)) {
          next();
          return;
        }
        if ((req.method ?? "GET") !== "GET") {
          res.statusCode = 405;
          res.end();
          return;
        }
        const page = dashboardHtml();
        res.statusCode = 200;
        res.setHeader("Content-Type", "text/html; charset=utf-8");
        res.setHeader("Cache-Control", "no-store");
        res.setHeader("X-Robots-Tag", "noindex");
        res.end(page);
      });
      server.httpServer?.on("close", () => stopPresenceTick());
    },
  };
}
