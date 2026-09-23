import type { AvatarLook } from "./avatarLook";

const TOKEN_KEY = "haw-session-token";

export type AuthUser = {
  id: string;
  email: string;
  name: string;
  color: string;
  company?: string;
  profileUrl?: string;
  look?: AvatarLook;
};

export type OfficeAdProfile = {
  enabled: boolean;
  hasImage: boolean;
  rev: number;
  url?: string;
};

export type AuthConfig = {
  googleClientId: string | null;
  mailer: boolean;
};

type Ok<T> = { ok: true } & T;
type Err = { ok: false; error: string };

async function authFetch<T>(
  path: string,
  opts?: { method?: string; token?: string; body?: unknown },
): Promise<Ok<T> | Err> {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (opts?.body !== undefined) headers["Content-Type"] = "application/json";
  const token = opts?.token ?? readToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  try {
    const res = await fetch(path, {
      method: opts?.method ?? "GET",
      headers,
      body: opts?.body !== undefined ? JSON.stringify(opts.body) : undefined,
      cache: "no-store",
    });
    const data = (await res.json()) as Ok<T> | Err;
    if (!data || typeof data !== "object") return { ok: false, error: "bad response" };
    return data;
  } catch {
    return { ok: false, error: "offline" };
  }
}

export function readToken() {
  try {
    return localStorage.getItem(TOKEN_KEY) ?? "";
  } catch {
    return "";
  }
}

export function writeToken(token: string) {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
}

export async function fetchAuthConfig(): Promise<AuthConfig> {
  const data = await authFetch<AuthConfig>("/__auth/config");
  if (!data.ok) return { googleClientId: null, mailer: false };
  return {
    googleClientId: data.googleClientId ?? null,
    mailer: Boolean(data.mailer),
  };
}

export async function restoreAccount(): Promise<{
  user: AuthUser;
  token: string;
  address: string | null;
  blocked: string[];
  officeAd?: OfficeAdProfile;
} | null> {
  const token = readToken();
  if (!token) return null;
  const data = await authFetch<{
    user: AuthUser;
    address: string | null;
    blocked?: string[];
    officeAd?: OfficeAdProfile;
  }>("/__auth/me", {
    token,
  });
  if (!data.ok) {
    clearToken();
    return null;
  }
  return {
    user: data.user,
    token,
    address: data.address ?? null,
    blocked: data.blocked ?? [],
    officeAd: data.officeAd,
  };
}

export async function startEmailCode(email: string) {
  return authFetch<{ mailed: boolean; devCode?: string }>("/__auth/email/start", {
    method: "POST",
    body: { email },
  });
}

export async function verifyEmailCode(opts: {
  email: string;
  code: string;
  guestId: string;
  name: string;
  color: string;
  look?: AvatarLook;
}) {
  const data = await authFetch<{ token: string; user: AuthUser }>("/__auth/email/verify", {
    method: "POST",
    body: opts,
  });
  if (data.ok) writeToken(data.token);
  return data;
}

export async function loginWithGoogle(opts: {
  credential: string;
  guestId: string;
  name: string;
  color: string;
  look?: AvatarLook;
}) {
  const data = await authFetch<{ token: string; user: AuthUser }>("/__auth/google", {
    method: "POST",
    body: opts,
  });
  if (data.ok) writeToken(data.token);
  return data;
}

export async function logoutAccount() {
  const token = readToken();
  if (token) await authFetch("/__auth/logout", { method: "POST", token });
  clearToken();
}

export async function saveAccountName(name: string) {
  return saveAccountProfile({ name });
}

export async function saveAccountProfile(opts: {
  name: string;
  company?: string;
  profileUrl?: string;
  look?: AvatarLook;
}) {
  return authFetch<{ user: AuthUser }>("/__auth/profile", { method: "POST", body: opts });
}

export async function bindSessionWallet(address: string) {
  return authFetch<{ address: string }>("/__auth/wallet", { method: "POST", body: { address } });
}

export async function saveBlock(id: string, on: boolean) {
  return authFetch<{ blocked: string[] }>(on ? "/__auth/block" : "/__auth/unblock", {
    method: "POST",
    body: { id },
  });
}

export async function saveOfficeAd(opts: { enabled?: boolean; image?: string }) {
  return authFetch<{ officeAd: OfficeAdProfile }>("/__auth/office-ad", {
    method: "POST",
    body: opts,
  });
}

export async function fetchOfficeAd() {
  return authFetch<{ officeAd: OfficeAdProfile }>("/__auth/office-ad");
}
