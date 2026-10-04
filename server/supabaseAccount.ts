import { randomBytes } from "node:crypto";
import type { AvatarLook } from "../src/avatarLook";
import { MAX_NAME } from "../src/protocol";
import type { SupabaseIdentity } from "./supabaseJwt";

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type AccountRecord = {
  id: string;
  email: string;
  name: string;
  color: string;
  supabaseId?: string;
  googleSub?: string;
  avatarUrl?: string;
  look?: AvatarLook;
  xp?: number;
  createdAt: number;
  lastLoginAt: number;
};

export type AppSession = {
  token: string;
  userId: string;
  createdAt: number;
  expiresAt: number;
  address?: string;
};

export function normalizeAccountEmail(value: unknown) {
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

function parseList(raw: string, normalize: (part: string) => string) {
  const set = new Set<string>();
  for (const part of raw.split(/[,;\s]+/)) {
    const item = normalize(part);
    if (item) set.add(item);
  }
  return set;
}

/** ADMIN_EMAILS or ADMIN_SUPABASE_IDS. Both empty means not an admin. */
export function isAllowlistedAdmin(
  user: { id?: string; email?: string; supabaseId?: string },
  emails: string,
  ids: string,
) {
  const email = normalizeAccountEmail(user.email);
  if (email && parseList(emails, (part) => normalizeAccountEmail(part)).has(email)) return true;
  const allowIds = parseList(ids, (part) => part.trim().toLowerCase());
  if (!allowIds.size) return false;
  const candidates = [user.supabaseId, user.id]
    .map((value) => String(value ?? "").trim().toLowerCase())
    .filter(Boolean);
  return candidates.some((id) => allowIds.has(id));
}

function findAccount(users: AccountRecord[], identity: SupabaseIdentity) {
  const bySub = users.find((row) => row.supabaseId === identity.sub || row.id === identity.sub);
  if (bySub) return bySub;
  if (identity.googleSub) {
    const byGoogle = users.find(
      (row) => row.googleSub === identity.googleSub && (!row.supabaseId || row.supabaseId === identity.sub),
    );
    if (byGoogle) return byGoogle;
  }
  if (identity.emailVerified && identity.email) {
    const email = normalizeAccountEmail(identity.email);
    if (!email) return undefined;
    return users.find(
      (row) => normalizeAccountEmail(row.email) === email && (!row.supabaseId || row.supabaseId === identity.sub),
    );
  }
  return undefined;
}

/**
 * New accounts use the Supabase user id. An existing account with the same
 * verified email (Google, Discord, Slack) or the old direct-Google subject
 * keeps its id, so desks and XP stay put.
 */
export function establishSupabaseSession(
  store: { users: AccountRecord[]; sessions: AppSession[] },
  identity: SupabaseIdentity,
  opts: { name?: string; color?: string; look?: AvatarLook; now?: number } = {},
): { user: AccountRecord; token: string; isNew: boolean } {
  const now = opts.now ?? Date.now();
  const verifiedEmail = identity.emailVerified ? normalizeAccountEmail(identity.email) : "";
  let user = findAccount(store.users, identity);
  let isNew = false;
  if (!user) {
    isNew = true;
    const name = clampName(opts.name) || clampName(identity.name) || `Guest-${identity.sub.replace(/-/g, "").slice(0, 4)}`;
    user = {
      id: identity.sub,
      email: verifiedEmail,
      name,
      color: opts.look?.shirt || (opts.color && /^#[0-9a-fA-F]{6}$/.test(opts.color) ? opts.color.toLowerCase() : "") || "#f4a261",
      look: opts.look,
      supabaseId: identity.sub,
      googleSub: identity.googleSub || undefined,
      avatarUrl: identity.avatarUrl || undefined,
      createdAt: now,
      lastLoginAt: now,
    };
    store.users.push(user);
  } else {
    user.supabaseId = identity.sub;
    if (verifiedEmail) user.email = verifiedEmail;
    if (identity.googleSub) user.googleSub = identity.googleSub;
    if (identity.avatarUrl) user.avatarUrl = identity.avatarUrl;
    if (!user.look && opts.look) {
      user.look = opts.look;
      user.color = opts.look.shirt;
    }
    user.lastLoginAt = now;
  }
  store.sessions = store.sessions.filter((row) => row.userId !== user.id);
  const session: AppSession = {
    token: randomBytes(32).toString("hex"),
    userId: user.id,
    createdAt: now,
    expiresAt: now + SESSION_TTL_MS,
  };
  store.sessions.push(session);
  return { user, token: session.token, isNew };
}
