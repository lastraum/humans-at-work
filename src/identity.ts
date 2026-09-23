import { clampLook, SHIRTS, type AvatarLook } from "./avatarLook";
import { MAX_ID, MAX_NAME, clampCompany, clampProfileUrl } from "./protocol";

const ACCOUNT_KEY = "haw-identity";
const TAB_KEY = "haw-tab-identity";

const PALETTE = SHIRTS;

export type Identity = {
  id: string;
  name: string;
  color: string;
  /** Session ETH address for DCL LiveKit. */
  address?: string;
  email?: string;
  company?: string;
  profileUrl?: string;
  /** Saved avatar. Missing until they edit; the body still has a stable derived look. */
  look?: AvatarLook;
};

function colorFor(id: string) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

function defaultName(id: string) {
  return `Guest-${id.replace(/-/g, "").slice(0, 4)}`;
}

function read(store: Storage, key: string): Identity | null {
  try {
    const raw = store.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Identity;
    if (typeof parsed?.id !== "string" || parsed.id.length < 8 || parsed.id.length > MAX_ID) {
      return null;
    }
    return {
      id: parsed.id,
      name: sanitizeName(parsed.name) || defaultName(parsed.id),
      color: parsed.color || colorFor(parsed.id),
      email: parsed.email,
      company: clampCompany(parsed.company) || undefined,
      profileUrl: clampProfileUrl(parsed.profileUrl) || undefined,
      look: clampLook(parsed.look),
    };
  } catch {
    return null;
  }
}

function write(store: Storage, key: string, ident: Identity) {
  store.setItem(key, JSON.stringify(ident));
}

export function sanitizeName(value: string | undefined) {
  return (value ?? "").replace(/\s+/g, " ").trim().slice(0, MAX_NAME);
}

export function shortId(id: string) {
  return id.replace(/-/g, "").slice(0, 8);
}

function mint(): Identity {
  const id = crypto.randomUUID();
  return { id, name: defaultName(id), color: colorFor(id) };
}

/**
 * One UUID per browser tab (sessionStorage) so two local tabs don't kick
 * each other out of the room. Name/color persist on the account in localStorage.
 */
export function ensureIdentity(): Identity {
  const account = read(localStorage, ACCOUNT_KEY);
  const existing = read(sessionStorage, TAB_KEY);
  if (existing) {
    if (account) {
      existing.name = account.name || existing.name;
      existing.color = account.color || existing.color;
      existing.email = account.email;
      existing.company = account.company || existing.company;
      existing.profileUrl = account.profileUrl || existing.profileUrl;
      existing.look = account.look ?? existing.look;
    }
    write(sessionStorage, TAB_KEY, existing);
    return existing;
  }
  const ident = mint();
  if (account) {
    ident.name = account.name || ident.name;
    ident.color = account.color || ident.color;
    ident.email = account.email;
    ident.company = account.company;
    ident.profileUrl = account.profileUrl;
    ident.look = account.look;
  } else {
    write(localStorage, ACCOUNT_KEY, ident);
  }
  write(sessionStorage, TAB_KEY, ident);
  return ident;
}

export function saveIdentity(ident: Identity) {
  write(sessionStorage, TAB_KEY, ident);
  const account = read(localStorage, ACCOUNT_KEY);
  write(localStorage, ACCOUNT_KEY, {
    id: ident.email ? ident.id : account?.id ?? ident.id,
    name: ident.name,
    color: ident.color,
    email: ident.email,
    company: ident.company,
    profileUrl: ident.profileUrl,
    look: ident.look,
  });
}

/** Adopt a signed-in account as this tab's identity (stable id across tabs). */
export function applyAccount(user: {
  id: string;
  name: string;
  color: string;
  email: string;
  company?: string;
  profileUrl?: string;
  look?: AvatarLook;
}): Identity {
  const prior = read(localStorage, ACCOUNT_KEY);
  const look = clampLook(user.look) ?? (prior?.id === user.id ? prior.look : undefined);
  const ident: Identity = {
    id: user.id,
    name: sanitizeName(user.name) || defaultName(user.id),
    color: look?.shirt || user.color || colorFor(user.id),
    email: user.email,
    company: clampCompany(user.company) || undefined,
    profileUrl: clampProfileUrl(user.profileUrl) || undefined,
    look,
  };
  write(sessionStorage, TAB_KEY, ident);
  write(localStorage, ACCOUNT_KEY, ident);
  return ident;
}

export function clearAccountEmail() {
  const account = read(localStorage, ACCOUNT_KEY);
  if (!account?.email) return;
  const next = { ...account, email: undefined };
  write(localStorage, ACCOUNT_KEY, next);
  const tab = read(sessionStorage, TAB_KEY);
  if (tab) write(sessionStorage, TAB_KEY, { ...tab, email: undefined });
}
