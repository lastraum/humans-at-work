import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Readable } from "node:stream";
import { loadEnv, type Plugin, type PreviewServer, type ViteDevServer } from "vite";
import { enabledAuthProviders } from "../src/authProviders";
import { clientIp } from "./net";
import { clampLook, type AvatarLook } from "../src/avatarLook";
import { MAX_ID, MAX_NAME, clampCompany, clampProfileUrl } from "../src/protocol";
import { bankMinutes } from "../src/xp";
import { FILM_SHOTS } from "./film";
import {
  establishSupabaseSession,
  isAllowlistedAdmin,
  type AccountRecord,
  type AppSession,
} from "./supabaseAccount";
import {
  getSupabaseJwks,
  supabaseIssuer,
  verifySupabaseAccessToken,
  type SupabaseIdentity,
} from "./supabaseJwt";

const AUTH_PREFIX = "/__auth";
const OFFICE_ADS_PREFIX = "/__office-ads";
const OFFICE_AD_MAX_BYTES = 200_000;
const OFFICE_AD_MIMES = new Set(["image/jpeg", "image/jpg", "image/png", "image/webp"]);
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type User = {
  id: string;
  email: string;
  name: string;
  color: string;
  googleSub?: string;
  supabaseId?: string;
  avatarUrl?: string;
  blocked?: string[];
  officeAdEnabled?: boolean;
  officeAdRev?: number;
  officeAdMime?: string;
  company?: string;
  profileUrl?: string;
  look?: AvatarLook;
  /** Banked minutes on the floor. Remainder holds the partial minute. */
  xp?: number;
  xpRemainderMs?: number;
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
const defaultStorePath = resolve(rootDir, "data/accounts.json");
let storePath = defaultStorePath;

/** Tests point the account file at a temp path. Production leaves this alone. */
export function setAccountsStoreForTests(path: string | null) {
  storePath = path ?? defaultStorePath;
}

let verifyForTests: ((token: string) => Promise<SupabaseIdentity>) | null = null;

/** Tests skip the network and pass an already-checked Supabase identity. */
export function setSupabaseVerifierForTests(fn: ((token: string) => Promise<SupabaseIdentity>) | null) {
  verifyForTests = fn;
}
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
  if (!existsSync(storePath)) return emptyStore();
  let parsed: Store;
  try {
    parsed = JSON.parse(readFileSync(storePath, "utf8")) as Store;
  } catch {
    throw new Error("accounts.json is unreadable");
  }
  if (!parsed || typeof parsed !== "object") throw new Error("accounts.json is unreadable");
  const store: Store = {
    secret: typeof parsed.secret === "string" && parsed.secret.length >= 16 ? parsed.secret : randomBytes(32).toString("hex"),
    users: Array.isArray(parsed.users) ? parsed.users : [],
    sessions: Array.isArray(parsed.sessions) ? parsed.sessions : [],
    codes: Array.isArray(parsed.codes) ? parsed.codes : [],
  };
  prune(store);
  return store;
}

function saveStore(store: Store) {
  prune(store);
  mkdirSync(dirname(storePath), { recursive: true });
  const tmp = `${storePath}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(store, null, 2)}\n`);
  renameSync(tmp, storePath);
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

function readBody(req: IncomingMessage, max = 1_500_000): Promise<string> {
  return new Promise((resolveBody, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let settled = false;
    const fail = (err: Error) => {
      if (settled) return;
      settled = true;
      reject(err);
    };
    req.on("data", (chunk) => {
      if (settled) return;
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk ?? "");
      size += buf.length;
      if (size > max) {
        fail(new Error("too large"));
        req.destroy();
        return;
      }
      chunks.push(buf);
    });
    req.on("end", () => {
      if (settled) return;
      settled = true;
      resolveBody(Buffer.concat(chunks).toString("utf8"));
    });
    req.on("error", (err) => fail(err instanceof Error ? err : new Error(String(err))));
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

function normalizeAddress(value: unknown) {
  const address = String(value ?? "")
    .trim()
    .toLowerCase();
  return /^0x[a-f0-9]{40}$/.test(address) ? address : "";
}

function publicUser(user: User) {
  const look = clampLook(user.look);
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    color: look?.shirt || user.color,
    company: user.company || undefined,
    profileUrl: user.profileUrl || undefined,
    avatarUrl: user.avatarUrl || undefined,
    look,
  };
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
  let user: User | undefined;
  try {
    user = loadStore().users.find((row) => row.id === id);
  } catch (err) {
    console.error(`[auth] ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
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
  try {
    return sessionOf(loadStore(), token)?.user.id ?? null;
  } catch (err) {
    console.error(`[auth] ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

const ipHits = new Map<string, { n: number; reset: number }>();

function allowIp(ip: string, limit: number, windowMs: number) {
  const now = Date.now();
  if (ipHits.size > 4000) {
    for (const [key, row] of ipHits) {
      if (row.reset < now) ipHits.delete(key);
    }
  }
  const row = ipHits.get(ip);
  if (!row || row.reset < now) {
    ipHits.set(ip, { n: 1, reset: now + windowMs });
    return true;
  }
  row.n += 1;
  return row.n <= limit;
}

export function hasUser(userId: string) {
  if (!userId) return false;
  try {
    return loadStore().users.some((row) => row.id === userId);
  } catch (err) {
    console.error(`[auth] ${err instanceof Error ? err.message : String(err)}`);
    return false;
  }
}

export function readUserXp(userId: string) {
  try {
    const user = loadStore().users.find((row) => row.id === userId);
    return Math.max(0, Math.floor(Number(user?.xp) || 0));
  } catch (err) {
    console.error(`[auth] ${err instanceof Error ? err.message : String(err)}`);
    return 0;
  }
}

export function creditUserXp(userId: string, elapsedMs: number): Promise<{ xp: number }> {
  return withStore((store) => {
    const user = store.users.find((row) => row.id === userId);
    if (!user) return { xp: 0 };
    const banked = bankMinutes(Math.max(0, Number(user.xpRemainderMs) || 0), elapsedMs);
    user.xp = Math.max(0, Math.floor(Number(user.xp) || 0)) + banked.xp;
    user.xpRemainderMs = banked.remainderMs;
    return { xp: user.xp };
  });
}

export function absorbUserXp(userId: string, xp: number, remainderMs: number): Promise<{ xp: number }> {
  return withStore((store) => {
    const user = store.users.find((row) => row.id === userId);
    if (!user) return { xp: 0 };
    const banked = bankMinutes(Math.max(0, Number(user.xpRemainderMs) || 0) + Math.max(0, remainderMs), 0);
    user.xp = Math.max(0, Math.floor(Number(user.xp) || 0)) + Math.max(0, Math.floor(xp)) + banked.xp;
    user.xpRemainderMs = banked.remainderMs;
    return { xp: user.xp };
  });
}

export function accountXpSummary() {
  try {
    const users = loadStore().users;
    let xp = 0;
    for (const user of users) xp += Math.max(0, Math.floor(Number(user.xp) || 0));
    return { accounts: users.length, xp };
  } catch (err) {
    console.error(`[auth] ${err instanceof Error ? err.message : String(err)}`);
    return { accounts: 0, xp: 0 };
  }
}

export function userBlocks(userId: string) {
  try {
    const user = loadStore().users.find((row) => row.id === userId);
    return [...(user?.blocked ?? [])];
  } catch (err) {
    console.error(`[auth] ${err instanceof Error ? err.message : String(err)}`);
    return [];
  }
}

export function whoBlocked(userId: string) {
  try {
    return loadStore()
      .users.filter((row) => (row.blocked ?? []).includes(userId))
      .map((row) => row.id);
  } catch (err) {
    console.error(`[auth] ${err instanceof Error ? err.message : String(err)}`);
    return [];
  }
}

export function setUserBlock(userId: string, targetId: string, on: boolean) {
  if (!userId || !targetId || userId === targetId) return userBlocks(userId);
  try {
    const store = loadStore();
    const user = store.users.find((row) => row.id === userId);
    if (!user) return [];
    const set = new Set(user.blocked ?? []);
    if (on) set.add(targetId);
    else set.delete(targetId);
    user.blocked = [...set];
    saveStore(store);
    return user.blocked;
  } catch (err) {
    console.error(`[auth] ${err instanceof Error ? err.message : String(err)}`);
    return userBlocks(userId);
  }
}

function envOf(mode: string) {
  const env = loadEnv(mode, rootDir, "");
  const providersRaw = Object.prototype.hasOwnProperty.call(env, "VITE_AUTH_PROVIDERS")
    ? env.VITE_AUTH_PROVIDERS
    : process.env.VITE_AUTH_PROVIDERS;
  return {
    supabaseUrl: env.SUPABASE_URL || process.env.SUPABASE_URL || "",
    supabaseSecret: env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SECRET_KEY || "",
    adminEmails: env.ADMIN_EMAILS || process.env.ADMIN_EMAILS || "",
    adminIds: env.ADMIN_SUPABASE_IDS || process.env.ADMIN_SUPABASE_IDS || "",
    providers: enabledAuthProviders(providersRaw),
  };
}

function isAdmin(user: User, env: ReturnType<typeof envOf>) {
  return isAllowlistedAdmin(user, env.adminEmails, env.adminIds);
}

function attachAuth(server: ViteDevServer | PreviewServer) {
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
}

export function authPlugin(): Plugin {
  return {
    name: "haw-auth",
    configureServer: attachAuth,
    configurePreviewServer: attachAuth,
  };
}

async function handle(req: IncomingMessage, res: ServerResponse, pathname: string, mode: string) {
  const env = envOf(mode);
  const method = req.method ?? "GET";

  if (
    pathname === `${AUTH_PREFIX}/email/start` ||
    pathname === `${AUTH_PREFIX}/email/verify` ||
    pathname === `${AUTH_PREFIX}/google`
  ) {
    json(res, 410, { ok: false, error: "email sign-in is off" });
    return;
  }

  if (pathname === `${AUTH_PREFIX}/config` && method === "GET") {
    json(res, 200, {
      ok: true,
      providers: env.providers,
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
      admin: isAdmin(found.user, env),
    });
    return;
  }

  if (pathname === `${AUTH_PREFIX}/film` && method === "GET") {
    const found = await withStore((store) => sessionOf(store, bearer(req)));
    if (!found) {
      json(res, 401, { ok: false, error: "signed out" });
      return;
    }
    if (!isAdmin(found.user, env)) {
      json(res, 403, { ok: false, error: "film disabled" });
      return;
    }
    json(res, 200, { ok: true, shots: FILM_SHOTS });
    return;
  }

  if (pathname === `${AUTH_PREFIX}/supabase` && method === "POST") {
    if (!allowIp(clientIp(req), 30, 10 * 60_000)) {
      json(res, 429, { ok: false, error: "wait a few seconds" });
      return;
    }
    if (!env.supabaseUrl) {
      json(res, 503, { ok: false, error: "sign-in unavailable" });
      return;
    }
    const body = await readJson(req);
    const accessToken = String(body.accessToken ?? "").trim();
    if (!accessToken || accessToken.length > 12_000) {
      json(res, 400, { ok: false, error: "missing token" });
      return;
    }
    let identity: SupabaseIdentity;
    try {
      identity = verifyForTests
        ? await verifyForTests(accessToken)
        : await verifySupabaseAccessToken(accessToken, {
            issuer: supabaseIssuer(env.supabaseUrl),
            secretKey: env.supabaseSecret,
            jwks: await getSupabaseJwks(env.supabaseUrl),
          });
    } catch (err) {
      console.error(`[auth] supabase ${err instanceof Error ? err.message : String(err)}`);
      json(res, 401, { ok: false, error: "sign-in failed" });
      return;
    }
    const result = await withStore((store) =>
      establishSupabaseSession(store as unknown as { users: AccountRecord[]; sessions: AppSession[] }, identity, {
        name: clampName(body.name),
        color: clampColor(body.color),
        look: clampLook(body.look) ?? undefined,
      }),
    );
    json(res, 200, { ok: true, token: result.token, user: publicUser(result.user as User) });
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
    const company = clampCompany(body.company);
    const profileUrl = clampProfileUrl(body.profileUrl);
    if (String(body.profileUrl ?? "").trim() && !profileUrl) {
      json(res, 400, { ok: false, error: "bad profile link" });
      return;
    }
    const found = await withStore((store) => {
      const hit = sessionOf(store, bearer(req));
      if (!hit) return null;
      hit.user.name = name;
      hit.user.company = company || undefined;
      hit.user.profileUrl = profileUrl || undefined;
      const look = clampLook(body.look);
      if (look) {
        hit.user.look = look;
        hit.user.color = look.shirt;
      }
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
  let user: User | undefined;
  try {
    user = loadStore().users.find((row) => row.id === id);
  } catch (err) {
    console.error(`[auth] ${err instanceof Error ? err.message : String(err)}`);
    json(res, 503, { ok: false, error: "unavailable" });
    return;
  }
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

export async function dispatchAuthForTests(input: {
  method: string;
  pathname: string;
  body?: string;
  authorization?: string;
}): Promise<{ status: number; json: unknown }> {
  const req = Readable.from(input.body ? [Buffer.from(input.body)] : []) as IncomingMessage;
  req.method = input.method;
  req.url = input.pathname;
  req.headers = input.authorization ? { authorization: input.authorization } : {};
  let status = 0;
  let raw = "";
  const res = {
    statusCode: 0,
    setHeader() {},
    end(body?: string) {
      status = this.statusCode;
      raw = typeof body === "string" ? body : "";
    },
  };
  await handle(req, res as unknown as ServerResponse, input.pathname, "test");
  return { status, json: raw ? (JSON.parse(raw) as unknown) : null };
}
