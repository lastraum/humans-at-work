import { createLocalJWKSet, errors, jwtVerify, type JWTPayload } from "jose";

export type SupabaseIdentity = {
  sub: string;
  email: string;
  emailVerified: boolean;
  name: string;
  avatarUrl: string;
  /** Google's own subject, when this Supabase user signed in with Google. */
  googleSub: string;
};

export class SupabaseTokenError extends Error {
  readonly code: "expired" | "issuer" | "audience" | "signature" | "malformed" | "rejected";

  constructor(message: string, code: SupabaseTokenError["code"]) {
    super(message);
    this.name = "SupabaseTokenError";
    this.code = code;
  }
}

const ID_RE = /^[A-Za-z0-9._:-]{8,64}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function supabaseIssuer(url: string) {
  const base = url.trim().replace(/\/+$/, "");
  return `${base}/auth/v1`;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function normalizeEmail(value: unknown) {
  const email = String(value ?? "")
    .trim()
    .toLowerCase();
  return EMAIL_RE.test(email) && email.length <= 254 ? email : "";
}

function flag(value: unknown) {
  return value === true || value === "true";
}

function clip(value: unknown, max: number) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

function httpsUrl(value: unknown) {
  const raw = String(value ?? "").trim();
  if (!raw || raw.length > 400) return "";
  try {
    const url = new URL(raw);
    return url.protocol === "https:" ? url.toString() : "";
  } catch {
    return "";
  }
}

function metaName(meta: Record<string, unknown> | null) {
  if (!meta) return "";
  return (
    clip(meta.full_name, 80) ||
    clip(meta.name, 80) ||
    clip(meta.preferred_username, 80) ||
    clip(meta.user_name, 80)
  );
}

function metaAvatar(meta: Record<string, unknown> | null) {
  if (!meta) return "";
  return httpsUrl(meta.avatar_url) || httpsUrl(meta.picture);
}

function googleSubject(app: Record<string, unknown> | null, meta: Record<string, unknown> | null, sub: string) {
  const provider = String(app?.provider ?? "");
  const providers = Array.isArray(app?.providers) ? app.providers.map((item) => String(item)) : [];
  if (provider !== "google" && !providers.includes("google")) return "";
  const candidate = clip(meta?.provider_id, 128) || clip(meta?.sub, 128);
  if (!candidate || candidate === sub) return "";
  return candidate;
}

function identityFromParts(opts: {
  sub: string;
  email: unknown;
  emailVerified: boolean;
  meta: Record<string, unknown> | null;
  app: Record<string, unknown> | null;
}): SupabaseIdentity {
  const sub = opts.sub.trim();
  if (!ID_RE.test(sub)) throw new SupabaseTokenError("bad subject", "malformed");
  const verified = opts.emailVerified || flag(opts.meta?.email_verified);
  const email = verified ? normalizeEmail(opts.email) || normalizeEmail(opts.meta?.email) : "";
  return {
    sub,
    email,
    emailVerified: Boolean(email) && verified,
    name: metaName(opts.meta),
    avatarUrl: metaAvatar(opts.meta),
    googleSub: googleSubject(opts.app, opts.meta, sub),
  };
}

function identityFromPayload(payload: JWTPayload): SupabaseIdentity {
  const meta = asRecord(payload.user_metadata);
  const app = asRecord(payload.app_metadata);
  const role = payload.role == null ? "authenticated" : String(payload.role);
  if (role !== "authenticated") throw new SupabaseTokenError("not a user token", "rejected");
  return identityFromParts({
    sub: String(payload.sub ?? ""),
    email: payload.email,
    emailVerified: flag(payload.email_verified) || flag(meta?.email_verified),
    meta,
    app,
  });
}

function identityFromUser(data: Record<string, unknown>): SupabaseIdentity {
  const meta = asRecord(data.user_metadata);
  const app = asRecord(data.app_metadata);
  const confirmed = Boolean(data.email_confirmed_at) || flag(meta?.email_verified);
  return identityFromParts({
    sub: String(data.id ?? ""),
    email: data.email,
    emailVerified: confirmed,
    meta,
    app,
  });
}

function definitive(err: unknown): SupabaseTokenError | null {
  if (err instanceof SupabaseTokenError) return err;
  if (err instanceof errors.JWTExpired) return new SupabaseTokenError("expired", "expired");
  if (err instanceof errors.JWSSignatureVerificationFailed) {
    return new SupabaseTokenError("bad signature", "signature");
  }
  if (err instanceof errors.JWTClaimValidationFailed) {
    if (err.claim === "iss") return new SupabaseTokenError("wrong issuer", "issuer");
    if (err.claim === "aud") return new SupabaseTokenError("wrong audience", "audience");
    return new SupabaseTokenError(err.message, "rejected");
  }
  if (err instanceof errors.JWTInvalid || err instanceof errors.JWSInvalid) {
    return new SupabaseTokenError("malformed", "malformed");
  }
  return null;
}

async function userInfo(token: string, issuer: string, secretKey: string, fetchImpl: typeof fetch) {
  const res = await fetchImpl(`${issuer}/user`, {
    headers: {
      apikey: secretKey,
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
    },
  });
  const data = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  if (!res.ok || !data) throw new SupabaseTokenError("rejected", "rejected");
  return identityFromUser(data);
}

/**
 * Prefer the project's JWKS. A bad signature, expiry, or issuer is final.
 * Fall back to GET /auth/v1/user only when the token cannot be checked locally
 * (no key, unsupported alg) and SUPABASE_SECRET_KEY is set.
 */
export async function verifySupabaseAccessToken(
  token: string,
  opts: {
    issuer: string;
    jwks?: { keys: unknown[] } | null;
    now?: Date;
    secretKey?: string;
    fetchImpl?: typeof fetch;
  },
): Promise<SupabaseIdentity> {
  const raw = token.trim();
  if (!raw || raw.split(".").length !== 3) throw new SupabaseTokenError("malformed", "malformed");
  const issuer = opts.issuer.replace(/\/+$/, "");
  const keys = opts.jwks?.keys;
  if (keys?.length) {
    try {
      const { payload } = await jwtVerify(raw, createLocalJWKSet({ keys: keys as never }), {
        issuer,
        audience: "authenticated",
        algorithms: ["ES256", "RS256"],
        currentDate: opts.now ?? new Date(),
        clockTolerance: 0,
      });
      return identityFromPayload(payload);
    } catch (err) {
      const fatal = definitive(err);
      if (fatal) throw fatal;
    }
  }
  const secret = opts.secretKey?.trim() ?? "";
  if (!secret) throw new SupabaseTokenError("unverified", "rejected");
  return userInfo(raw, issuer, secret, opts.fetchImpl ?? fetch);
}

let jwksCache: { url: string; at: number; body: { keys: unknown[] } } | null = null;

export async function getSupabaseJwks(supabaseUrl: string, fetchImpl: typeof fetch = fetch) {
  const base = supabaseUrl.trim().replace(/\/+$/, "");
  if (!base) return null;
  const url = `${base}/auth/v1/.well-known/jwks.json`;
  const now = Date.now();
  if (jwksCache && jwksCache.url === url && now - jwksCache.at < 10 * 60_000) return jwksCache.body;
  try {
    const res = await fetchImpl(url);
    if (!res.ok) return jwksCache?.url === url ? jwksCache.body : null;
    const body = (await res.json()) as { keys?: unknown[] };
    if (!body || !Array.isArray(body.keys)) return null;
    const next = { keys: body.keys };
    jwksCache = { url, at: now, body: next };
    return next;
  } catch {
    return jwksCache?.url === url ? jwksCache.body : null;
  }
}
