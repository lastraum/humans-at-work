import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { AvatarLook } from "./avatarLook";
import { enabledAuthProviders, type AuthProvider } from "./authProviders";

const TOKEN_KEY = "haw-session-token";

export type AuthUser = {
  id: string;
  email: string;
  name: string;
  color: string;
  company?: string;
  profileUrl?: string;
  look?: AvatarLook;
  avatarUrl?: string;
};

export type OfficeAdProfile = {
  enabled: boolean;
  hasImage: boolean;
  rev: number;
  url?: string;
};

export type AuthConfig = {
  providers: AuthProvider[];
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

export function clientAuthProviders(): AuthProvider[] {
  const url = import.meta.env.VITE_SUPABASE_URL;
  const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) return [];
  return enabledAuthProviders(import.meta.env.VITE_AUTH_PROVIDERS);
}

/** Where Supabase sends the browser after Google, X, Discord, or Slack. */
export function oauthRedirectTo() {
  return `${location.origin}/`;
}

let supabaseClient: SupabaseClient | null | undefined;

function getSupabase() {
  if (supabaseClient !== undefined) return supabaseClient;
  const url = import.meta.env.VITE_SUPABASE_URL;
  const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) {
    supabaseClient = null;
    return null;
  }
  supabaseClient = createClient(url, key, {
    auth: {
      flowType: "pkce",
      detectSessionInUrl: false,
      persistSession: true,
      autoRefreshToken: false,
    },
  });
  return supabaseClient;
}

export async function startOAuth(provider: AuthProvider): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = getSupabase();
  if (!supabase) return { ok: false, error: "Sign-in isn't configured." };
  const { error } = await supabase.auth.signInWithOAuth({
    provider,
    options: { redirectTo: oauthRedirectTo() },
  });
  if (error) return { ok: false, error: error.message || "Sign-in failed." };
  return { ok: true };
}

/** Exchange a returning `?code=` for an app session. Returns an error string, or null. */
export async function finishOAuthRedirect(profile?: {
  guestId?: string;
  name?: string;
  color?: string;
  look?: AvatarLook;
}): Promise<string | null> {
  const params = new URLSearchParams(location.search);
  const code = params.get("code");
  const oauthError = params.get("error_description") || params.get("error");
  if (!code && !oauthError) return null;
  params.delete("code");
  params.delete("state");
  params.delete("error");
  params.delete("error_code");
  params.delete("error_description");
  const next = `${location.pathname}${params.toString() ? `?${params}` : ""}${location.hash}`;
  history.replaceState(null, "", next);
  if (!code) return (oauthError || "Sign-in failed.").slice(0, 180);
  const supabase = getSupabase();
  if (!supabase) return "Sign-in isn't configured.";
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);
  if (error || !data.session?.access_token) return (error?.message || "Sign-in failed.").slice(0, 180);
  const minted = await loginWithSupabase({
    accessToken: data.session.access_token,
    guestId: profile?.guestId,
    name: profile?.name,
    color: profile?.color,
    look: profile?.look,
  });
  await supabase.auth.signOut().catch(() => undefined);
  if (!minted.ok) return minted.error || "Sign-in failed.";
  return null;
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

export type FilmShot = {
  x: number;
  y: number;
  zoom: number;
  film?: "hide" | "chat" | "hud";
  look?: "w" | "e" | "s" | "n";
};

/** Admin allowlist check. Shots are omitted unless this session is listed in ADMIN_EMAILS. */
export async function fetchFilmGrant(token: string): Promise<Record<string, FilmShot> | null> {
  if (!token) return null;
  const data = await authFetch<{ shots?: Record<string, FilmShot> }>("/__auth/film", { token });
  if (!data.ok || !data.shots) return null;
  return data.shots;
}

export async function loginWithSupabase(opts: {
  accessToken: string;
  guestId?: string;
  name?: string;
  color?: string;
  look?: AvatarLook;
}) {
  const data = await authFetch<{ token: string; user: AuthUser }>("/__auth/supabase", {
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
