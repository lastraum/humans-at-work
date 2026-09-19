import { createHash, randomBytes, randomInt, randomUUID, timingSafeEqual } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnv, type Plugin } from "vite";
import { MAX_ID, MAX_NAME } from "../src/protocol";
import { recordSignup } from "./metrics";

const AUTH_PREFIX = "/__auth";
const OFFICE_ADS_PREFIX = "/__office-ads";
const OFFICE_AD_MAX_BYTES = 200_000;
const OFFICE_AD_MIMES = new Set(["image/jpeg", "image/jpg", "image/png", "image/webp"]);
const CODE_TTL_MS = 10 * 60 * 1000;
const CODE_GAP_MS = 20 * 1000;
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_CODE_ATTEMPTS = 5;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type User = {
  id: string;
  email: string;
  name: string;
  color: string;
  googleSub?: string;
  blocked?: string[];
  officeAdEnabled?: boolean;
  officeAdRev?: number;
  officeAdMime?: string;
  createdAt: number;
  lastLoginAt: number;
};

type Session = {
  token: string;
  userId: string;
  address?: string;
  createdAt: number;
  expiresAt: number;
};

type Code = {
  email: string;
  hash: string;
  expiresAt: number;
  attempts: number;
  sentAt: number;
};

type Store = {
  secret: string;
  users: User[];
  sessions: Session[];
  codes: Code[];
};

type JsonRes = {
  statusCode: number;
  setHeader: (name: string, value: string) => void;
  end: (body?: string) => void;
};

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const storePath = resolve(rootDir, "data/accounts.json");
const adsDir = resolve(rootDir, "data/office-ads");

let queue: Promise<unknown> = Promise.resolve();

function emptyStore(): Store {
  return { secret: randomBytes(32).toString("hex"), users: [], sessions: [], codes: [] };
}

function prune(store: Store, now = Date.now()) {
  store.codes = store.codes.filter((row) => row.expiresAt > now);
  store.sessions = store.sessions.filter((row) => row.expiresAt > now);
}

function loadStore(): Store {
  try {
    const parsed = JSON.parse(readFileSync(storePath, "utf8")) as Store;
    if (!parsed || typeof parsed !== "object") return emptyStore();
    const store: Store = {
      secret: typeof parsed.secret === "string" && parsed.secret.length >= 16 ? parsed.secret : randomBytes(32).toString("hex"),
      users: Array.isArray(parsed.users) ? parsed.users : [],
      sessions: Array.isArray(parsed.sessions) ? parsed.sessions : [],
      codes: Array.isArray(parsed.codes) ? parsed.codes : [],
    };
    prune(store);
    return store;
  } catch {
    return emptyStore();
  }
}

function saveStore(store: Store) {
  prune(store);
  mkdirSync(dirname(storePath), { recursive: true });
  writeFileSync(storePath, `${JSON.stringify(store, null, 2)}\n`);
}

function withStore<T>(fn: (store: Store) => T): Promise<T> {
  const run = queue.then(() => {
    const store = loadStore();
    const result = fn(store);
    saveStore(store);
    return result;
  });
  queue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

function json(res: JsonRes, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(body));
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolveBody, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk ?? ""));
    });
    req.on("end", () => resolveBody(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const raw = await readBody(req);
  if (!raw.trim()) return {};
  const parsed = JSON.parse(raw) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("bad json");
  return parsed as Record<string, unknown>;
}

function bearer(req: IncomingMessage) {
  const header = String(req.headers.authorization ?? "");
  const match = /^Bearer\s+(\S+)/i.exec(header);
  return match?.[1] ?? "";
}

function normalizeEmail(value: unknown) {
  const email = String(value ?? "")
    .trim()
    .toLowerCase();
  return EMAIL_RE.test(email) && email.length <= 254 ? email : "";
}

function clampName(value: unknown) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_NAME);
}

function clampColor(value: unknown) {
  const color = String(value ?? "").trim();
  return /^#[0-9a-fA-F]{6}$/.test(color) ? color.toLowerCase() : "";
}

function clampGuestId(value: unknown) {
  const id = String(value ?? "").slice(0, MAX_ID);
  return /^[A-Za-z0-9._:-]{8,}$/.test(id) ? id : "";
}

function normalizeAddress(value: unknown) {
  const address = String(value ?? "")
    .trim()
    .toLowerCase();
  return /^0x[a-f0-9]{40}$/.test(address) ? address : "";
}

function hashCode(secret: string, email: string, code: string) {
  return createHash("sha256").update(`${secret}:${email}:${code}`).digest("hex");
}

function safeEqual(a: string, b: string) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

function publicUser(user: User) {
  return { id: user.id, email: user.email, name: user.name, color: user.color };
}

function safeUserId(value: unknown) {
  const id = String(value ?? "").slice(0, MAX_ID);
  return /^[A-Za-z0-9._:-]+$/.test(id) ? id : "";
}

function extForMime(mime: string) {
  if (mime === "image/webp") return "webp";
  if (mime === "image/png") return "png";
  return "jpg";
}

function adFilePath(userId: string, mime?: string) {
  return resolve(adsDir, `${userId}.${extForMime(mime ?? "image/jpeg")}`);
}

function findAdFile(userId: string, mime?: string) {
  const preferred = adFilePath(userId, mime);
  if (existsSync(preferred)) return preferred;
  for (const ext of ["jpg", "jpeg", "webp", "png"]) {
    const path = resolve(adsDir, `${userId}.${ext}`);
    if (existsSync(path)) return path;
  }
  return "";
}

function officeAdUrl(userId: string, rev: number) {
  return `${OFFICE_ADS_PREFIX}/${encodeURIComponent(userId)}?v=${rev}`;
}

export type OfficeAdMeta = {
  enabled: boolean;
  hasImage: boolean;
  rev: number;
  url?: string;
};

export function officeAdMeta(userId: string): OfficeAdMeta | null {
  const id = safeUserId(userId);
  if (!id) return null;
  const user = loadStore().users.find((row) => row.id === id);
  const file = findAdFile(id, user?.officeAdMime);
  const hasImage = Boolean(file);
  const enabled = Boolean(user?.officeAdEnabled) && hasImage;
  const rev = user?.officeAdRev || (hasImage ? 1 : 0);
  return {
    enabled,
    hasImage,
    rev,
    url: hasImage ? officeAdUrl(id, rev) : undefined,
  };
}

/** Room-visible ad: only when the account has an image and the toggle is on. */
export function officeAdForPeer(peerId: string): { enabled: true; url: string } | null {
  const meta = officeAdMeta(peerId);
  if (!meta?.enabled || !meta.url) return null;
  return { enabled: true, url: meta.url };
}

function decodeDataUrl(value: unknown): { mime: string; bytes: Buffer } | null {
  const raw = String(value ?? "").trim();
  const match = /^data:(image\/(?:jpeg|jpg|png|webp));base64,([A-Za-z0-9+/=\s]+)$/i.exec(raw);
  if (!match) return null;
  const mime = match[1].toLowerCase() === "image/jpg" ? "image/jpeg" : match[1].toLowerCase();
  if (!OFFICE_AD_MIMES.has(mime)) return null;
  let bytes: Buffer;
  try {
    bytes = Buffer.from(match[2].replace(/\s+/g, ""), "base64");
  } catch {
    return null;
  }
  if (!bytes.length || bytes.length > OFFICE_AD_MAX_BYTES) return null;
  const jpeg = bytes[0] === 0xff && bytes[1] === 0xd8;
  const png = bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
  const webp = bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46;
  if (mime === "image/jpeg" && !jpeg) return null;
  if (mime === "image/png" && !png) return null;
  if (mime === "image/webp" && !webp) return null;
  return { mime, bytes };
}

function writeAdImage(userId: string, mime: string, bytes: Buffer) {
  mkdirSync(adsDir, { recursive: true });
  for (const ext of ["jpg", "jpeg", "webp", "png"]) {
    const path = resolve(adsDir, `${userId}.${ext}`);
    if (existsSync(path)) unlinkSync(path);
  }
  writeFileSync(adFilePath(userId, mime), bytes);
}

function publicOfficeAd(user: User) {
  const file = findAdFile(user.id, user.officeAdMime);
  const hasImage = Boolean(file);
  const rev = user.officeAdRev || (hasImage ? 1 : 0);
  return {
    enabled: Boolean(user.officeAdEnabled),
    hasImage,
    rev,
    url: hasImage ? officeAdUrl(user.id, rev) : undefined,
  };
}

function mintSession(store: Store, user: User): Session {
  const now = Date.now();
  store.sessions = store.sessions.filter((row) => row.userId !== user.id);
  const session: Session = {
    token: randomBytes(32).toString("hex"),
    userId: user.id,
    createdAt: now,
    expiresAt: now + SESSION_TTL_MS,
  };
  store.sessions.push(session);
  user.lastLoginAt = now;
  return session;
}

function findUser(store: Store, pred: (user: User) => boolean) {
  return store.users.find(pred);
}

function upsertUser(
  store: Store,
  opts: {
    email: string;
    googleSub?: string;
    guestId?: string;
    name?: string;
    color?: string;
  },
): { user: User; isNew: boolean } {
  const now = Date.now();
  let user =
    (opts.googleSub ? findUser(store, (row) => row.googleSub === opts.googleSub) : undefined) ??
    findUser(store, (row) => row.email === opts.email);
  if (user) {
    user.email = opts.email;
    if (opts.googleSub) user.googleSub = opts.googleSub;
    user.lastLoginAt = now;
    return { user, isNew: false };
  }
  const guestId = opts.guestId;
  const takeGuest = Boolean(guestId && !store.users.some((row) => row.id === guestId));
  user = {
    id: takeGuest && guestId ? guestId : randomUUID(),
    email: opts.email,
    name: clampName(opts.name) || `Guest-${(guestId ?? "user").replace(/-/g, "").slice(0, 4)}`,
    color: clampColor(opts.color) || "#f4a261",
    googleSub: opts.googleSub,
    createdAt: now,
    lastLoginAt: now,
  };
  store.users.push(user);
  return { user, isNew: true };
}

function sessionOf(store: Store, token: string) {
  if (!token) return null;
  const now = Date.now();
  const session = store.sessions.find((row) => row.token === token && row.expiresAt > now);
  if (!session) return null;
  const user = store.users.find((row) => row.id === session.userId);
  if (!user) return null;
  return { session, user };
}

export function userIdForToken(token: string) {
  if (!token) return null;
  return sessionOf(loadStore(), token)?.user.id ?? null;
}

export function userBlocks(userId: string) {
  const user = loadStore().users.find((row) => row.id === userId);
  return [...(user?.blocked ?? [])];
}

export function whoBlocked(userId: string) {
  return loadStore()
    .users.filter((row) => (row.blocked ?? []).includes(userId))
    .map((row) => row.id);
}

export function setUserBlock(userId: string, targetId: string, on: boolean) {
  if (!userId || !targetId || userId === targetId) return userBlocks(userId);
  const store = loadStore();
  const user = store.users.find((row) => row.id === userId);
  if (!user) return [];
  const set = new Set(user.blocked ?? []);
  if (on) set.add(targetId);
  else set.delete(targetId);
  user.blocked = [...set];
  saveStore(store);
  return user.blocked;
}

function envOf(mode: string) {
  const env = loadEnv(mode, rootDir, "");
  return {
    googleClientId: env.GOOGLE_CLIENT_ID || env.VITE_GOOGLE_CLIENT_ID || process.env.GOOGLE_CLIENT_ID || process.env.VITE_GOOGLE_CLIENT_ID || "",
    resendKey: env.RESEND_API_KEY || process.env.RESEND_API_KEY || "",
    from: env.AUTH_FROM || env.RESEND_FROM || process.env.AUTH_FROM || process.env.RESEND_FROM || "Humans at Work <onboarding@resend.dev>",
  };
}

async function sendCodeEmail(to: string, code: string, env: ReturnType<typeof envOf>) {
  if (!env.resendKey) return false;
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.resendKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: env.from,
      to,
      subject: `${code} is your Humans at Work code`,
      text: `Your sign-in code is ${code}. It expires in 10 minutes.\n`,
    }),
  });
  if (!res.ok) throw new Error(`resend ${res.status}`);
  return true;
}

async function verifyGoogle(credential: string, clientId: string) {
  const url = `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(credential)}`;
  const res = await fetch(url);
  const data = (await res.json().catch(() => null)) as {
    aud?: string;
    iss?: string;
    email?: string;
    email_verified?: string | boolean;
    sub?: string;
    name?: string;
  } | null;
  if (!res.ok || !data) throw new Error("google token rejected");
  const iss = data.iss === "accounts.google.com" || data.iss === "https://accounts.google.com";
  const verified = data.email_verified === true || data.email_verified === "true";
  const email = normalizeEmail(data.email);
  if (!iss || data.aud !== clientId || !verified || !email || !data.sub) {
    throw new Error("google token mismatch");
  }
  return { email, sub: data.sub, name: clampName(data.name) };
}

export function authPlugin(): Plugin {
  return {
    name: "haw-auth",
    configureServer(server) {
      if (!existsSync(dirname(storePath))) mkdirSync(dirname(storePath), { recursive: true });
      if (!existsSync(adsDir)) mkdirSync(adsDir, { recursive: true });
      server.middlewares.use((req, res, next) => {
        const url = new URL(req.url ?? "/", "http://localhost");
        if (url.pathname === "/data/accounts.json" || url.pathname === "/accounts.json") {
          res.statusCode = 404;
          res.end();
          return;
        }
        if (url.pathname.startsWith(OFFICE_ADS_PREFIX)) {
          void serveOfficeAdFile(req, res, url.pathname).catch((err) => {
            json(res, 500, { ok: false, error: String(err) });
          });
          return;
        }
        if (!url.pathname.startsWith(AUTH_PREFIX)) {
          next();
          return;
        }
        void handle(req, res, url.pathname, server.config.mode).catch((err) => {
          json(res, 500, { ok: false, error: String(err) });
        });
      });
    },
  };
}

async function handle(req: IncomingMessage, res: ServerResponse, pathname: string, mode: string) {
  const env = envOf(mode);
  const method = req.method ?? "GET";

  if (pathname === `${AUTH_PREFIX}/config` && method === "GET") {
    json(res, 200, {
      ok: true,
      googleClientId: env.googleClientId || null,
      mailer: Boolean(env.resendKey),
    });
    return;
  }

  if (pathname === `${AUTH_PREFIX}/me` && method === "GET") {
    const found = await withStore((store) => sessionOf(store, bearer(req)));
    if (!found) {
      json(res, 401, { ok: false, error: "signed out" });
      return;
    }
    json(res, 200, {
      ok: true,
      user: publicUser(found.user),
      address: found.session.address ?? null,
      blocked: found.user.blocked ?? [],
      officeAd: publicOfficeAd(found.user),
    });
    return;
  }

  if (pathname === `${AUTH_PREFIX}/email/start` && method === "POST") {
    const body = await readJson(req);
    const email = normalizeEmail(body.email);
    if (!email) {
      json(res, 400, { ok: false, error: "bad email" });
      return;
    }
    const now = Date.now();
    const minted = await withStore((store) => {
      const existing = store.codes.find((row) => row.email === email);
      if (existing && now - existing.sentAt < CODE_GAP_MS) {
        return { wait: true as const };
      }
      const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
      store.codes = store.codes.filter((row) => row.email !== email);
      store.codes.push({
        email,
        hash: hashCode(store.secret, email, code),
        expiresAt: now + CODE_TTL_MS,
        attempts: 0,
        sentAt: now,
      });
      return { wait: false as const, code };
    });
    if (minted.wait) {
      json(res, 429, { ok: false, error: "wait a few seconds" });
      return;
    }
    let mailed = false;
    try {
      mailed = await sendCodeEmail(email, minted.code, env);
    } catch (err) {
      json(res, 502, { ok: false, error: `email failed: ${String(err)}` });
      return;
    }
    json(res, 200, {
      ok: true,
      mailed,
      ...(mailed ? {} : { devCode: minted.code }),
    });
    if (!mailed) console.log(`[auth] ${email} code ${minted.code}`);
    return;
  }

  if (pathname === `${AUTH_PREFIX}/email/verify` && method === "POST") {
    const body = await readJson(req);
    const email = normalizeEmail(body.email);
    const code = String(body.code ?? "").replace(/\s+/g, "");
    if (!email || !/^\d{6}$/.test(code)) {
      json(res, 400, { ok: false, error: "bad code" });
      return;
    }
    const result = await withStore((store) => {
      const row = store.codes.find((item) => item.email === email);
      if (!row || row.expiresAt <= Date.now()) return { error: "code expired" as const };
      row.attempts += 1;
      if (row.attempts > MAX_CODE_ATTEMPTS) {
        store.codes = store.codes.filter((item) => item.email !== email);
        return { error: "too many tries" as const };
      }
      if (!safeEqual(row.hash, hashCode(store.secret, email, code))) {
        return { error: "wrong code" as const };
      }
      store.codes = store.codes.filter((item) => item.email !== email);
      const { user, isNew } = upsertUser(store, {
        email,
        guestId: clampGuestId(body.guestId),
        name: clampName(body.name),
        color: clampColor(body.color),
      });
      const session = mintSession(store, user);
      return { user, token: session.token, isNew };
    });
    if ("error" in result) {
      json(res, 401, { ok: false, error: result.error });
      return;
    }
    if (result.isNew) void recordSignup();
    json(res, 200, { ok: true, token: result.token, user: publicUser(result.user) });
    return;
  }

  if (pathname === `${AUTH_PREFIX}/google` && method === "POST") {
    if (!env.googleClientId) {
      json(res, 503, { ok: false, error: "google unconfigured" });
      return;
    }
    const body = await readJson(req);
    const credential = String(body.credential ?? "").trim();
    if (!credential) {
      json(res, 400, { ok: false, error: "missing credential" });
      return;
    }
    let google: { email: string; sub: string; name: string };
    try {
      google = await verifyGoogle(credential, env.googleClientId);
    } catch {
      json(res, 401, { ok: false, error: "google sign-in failed" });
      return;
    }
    const result = await withStore((store) => {
      const { user, isNew } = upsertUser(store, {
        email: google.email,
        googleSub: google.sub,
        guestId: clampGuestId(body.guestId),
        name: clampName(body.name) || google.name,
        color: clampColor(body.color),
      });
      const session = mintSession(store, user);
      return { user, token: session.token, isNew };
    });
    if (result.isNew) void recordSignup();
    json(res, 200, { ok: true, token: result.token, user: publicUser(result.user) });
    return;
  }

  if (pathname === `${AUTH_PREFIX}/logout` && method === "POST") {
    const token = bearer(req);
    await withStore((store) => {
      store.sessions = store.sessions.filter((row) => row.token !== token);
    });
    json(res, 200, { ok: true });
    return;
  }

  if (pathname === `${AUTH_PREFIX}/profile` && method === "POST") {
    const body = await readJson(req);
    const name = clampName(body.name);
    if (!name) {
      json(res, 400, { ok: false, error: "bad name" });
      return;
    }
    const found = await withStore((store) => {
      const hit = sessionOf(store, bearer(req));
      if (!hit) return null;
      hit.user.name = name;
      return hit.user;
    });
    if (!found) {
      json(res, 401, { ok: false, error: "signed out" });
      return;
    }
    json(res, 200, { ok: true, user: publicUser(found) });
    return;
  }

  if (pathname === `${AUTH_PREFIX}/wallet` && method === "POST") {
    const body = await readJson(req);
    const address = normalizeAddress(body.address);
    if (!address) {
      json(res, 400, { ok: false, error: "bad address" });
      return;
    }
    const found = await withStore((store) => {
      const hit = sessionOf(store, bearer(req));
      if (!hit) return null;
      hit.session.address = address;
      return hit;
    });
    if (!found) {
      json(res, 401, { ok: false, error: "signed out" });
      return;
    }
    json(res, 200, { ok: true, address });
    return;
  }

  if ((pathname === `${AUTH_PREFIX}/block` || pathname === `${AUTH_PREFIX}/unblock`) && method === "POST") {
    const body = await readJson(req);
    const target = clampGuestId(body.id);
    if (!target) {
      json(res, 400, { ok: false, error: "bad id" });
      return;
    }
    const on = pathname.endsWith("/block");
    const found = await withStore((store) => {
      const hit = sessionOf(store, bearer(req));
      if (!hit) return null;
      const set = new Set(hit.user.blocked ?? []);
      if (on) set.add(target);
      else set.delete(target);
      hit.user.blocked = [...set];
      return hit.user.blocked;
    });
    if (!found) {
      json(res, 401, { ok: false, error: "signed out" });
      return;
    }
    json(res, 200, { ok: true, blocked: found });
    return;
  }

  if (pathname === `${AUTH_PREFIX}/office-ad` && method === "GET") {
    const found = await withStore((store) => sessionOf(store, bearer(req)));
    if (!found) {
      json(res, 401, { ok: false, error: "signed out" });
      return;
    }
    json(res, 200, { ok: true, officeAd: publicOfficeAd(found.user) });
    return;
  }

  if (pathname === `${AUTH_PREFIX}/office-ad` && method === "POST") {
    const body = await readJson(req);
    const image = body.image === undefined ? undefined : decodeDataUrl(body.image);
    if (body.image !== undefined && !image) {
      json(res, 400, { ok: false, error: "bad image" });
      return;
    }
    const enabledIn = body.enabled;
    if (enabledIn !== undefined && typeof enabledIn !== "boolean") {
      json(res, 400, { ok: false, error: "bad enabled" });
      return;
    }
    const found = await withStore((store) => {
      const hit = sessionOf(store, bearer(req));
      if (!hit) return null;
      if (image) {
        writeAdImage(hit.user.id, image.mime, image.bytes);
        hit.user.officeAdMime = image.mime;
        hit.user.officeAdRev = (hit.user.officeAdRev ?? 0) + 1;
        if (enabledIn === undefined) hit.user.officeAdEnabled = true;
      }
      if (typeof enabledIn === "boolean") hit.user.officeAdEnabled = enabledIn;
      return publicOfficeAd(hit.user);
    });
    if (!found) {
      json(res, 401, { ok: false, error: "signed out" });
      return;
    }
    json(res, 200, { ok: true, officeAd: found });
    return;
  }

  json(res, 404, { ok: false, error: "not found" });
}

function mimeFromPath(path: string) {
  if (path.endsWith(".webp")) return "image/webp";
  if (path.endsWith(".png")) return "image/png";
  return "image/jpeg";
}

async function serveOfficeAdFile(req: IncomingMessage, res: ServerResponse, pathname: string) {
  if ((req.method ?? "GET") !== "GET") {
    json(res, 405, { ok: false, error: "method" });
    return;
  }
  const id = safeUserId(decodeURIComponent(pathname.slice(OFFICE_ADS_PREFIX.length).replace(/^\//, "").split("/")[0] ?? ""));
  if (!id) {
    json(res, 404, { ok: false, error: "not found" });
    return;
  }
  const user = loadStore().users.find((row) => row.id === id);
  const file = findAdFile(id, user?.officeAdMime);
  if (!file) {
    json(res, 404, { ok: false, error: "not found" });
    return;
  }
  const body = readFileSync(file);
  res.statusCode = 200;
  res.setHeader("Content-Type", user?.officeAdMime || mimeFromPath(file));
  res.setHeader("Cache-Control", "public, max-age=86400");
  res.setHeader("Content-Length", String(body.length));
  res.end(body);
}
