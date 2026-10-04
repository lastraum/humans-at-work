import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { enabledAuthProviders } from "../src/authProviders.ts";
import { establishSupabaseSession, isAllowlistedAdmin } from "../server/supabaseAccount.ts";
import { supabaseIssuer, SupabaseTokenError, verifySupabaseAccessToken } from "../server/supabaseJwt.ts";
import {
  dispatchAuthForTests,
  setAccountsStoreForTests,
  setSupabaseVerifierForTests,
  userIdForToken,
} from "../server/auth.ts";

function assert(cond, message) {
  if (!cond) throw new Error(message);
}

const ISSUER = supabaseIssuer("https://example.supabase.co");

const { publicKey, privateKey } = await generateKeyPair("ES256", { extractable: true });
const jwk = await exportJWK(publicKey);
jwk.kid = "test-key";
jwk.alg = "ES256";
jwk.use = "sig";
const jwks = { keys: [jwk] };

const { privateKey: otherKey } = await generateKeyPair("ES256", { extractable: true });

async function sign(claims, opts = {}) {
  const now = Math.floor(Date.now() / 1000);
  let jwt = new SignJWT({
    role: "authenticated",
    ...claims,
  })
    .setProtectedHeader({ alg: "ES256", kid: opts.kid ?? "test-key" })
    .setSubject(opts.sub ?? "11111111-1111-4111-8111-111111111111")
    .setIssuer(opts.issuer ?? ISSUER)
    .setAudience("authenticated")
    .setIssuedAt(opts.iat ?? now)
    .setExpirationTime(opts.exp ?? now + 3600);
  return jwt.sign(opts.key ?? privateKey);
}

const providers = enabledAuthProviders(undefined);
assert(providers.includes("google"), "default list includes google");
assert(providers.includes("x"), "default list includes x");
assert(providers.includes("discord"), "default list includes discord");
assert(providers.includes("slack_oidc"), "default list includes slack");
const partial = enabledAuthProviders("google, slack_oidc");
assert(partial.join(",") === "google,slack_oidc", `partial list ${partial.join(",")}`);
assert(!enabledAuthProviders("google,x,discord").includes("slack_oidc"), "list can hide slack");
assert(enabledAuthProviders("slack").join(",") === "slack_oidc", "slack alias is slack_oidc");
assert(enabledAuthProviders("").length === 0, "empty list shows no providers");

const valid = await verifySupabaseAccessToken(
  await sign({
    email: "ada@example.com",
    email_verified: true,
    app_metadata: { provider: "slack_oidc", providers: ["slack_oidc"] },
    user_metadata: { full_name: "Ada Lovelace", email_verified: true },
  }),
  { issuer: ISSUER, jwks },
);
assert(valid.email === "ada@example.com", `email ${valid.email}`);
assert(valid.emailVerified, "slack email is verified");
assert(valid.name === "Ada Lovelace", `name ${valid.name}`);
assert(valid.sub === "11111111-1111-4111-8111-111111111111", "sub");

let fetches = 0;
const fetchImpl = async () => {
  fetches += 1;
  return new Response(JSON.stringify({ id: "should-not-run" }), { status: 200 });
};

await assertRejects(
  verifySupabaseAccessToken(await sign({}, { exp: Math.floor(Date.now() / 1000) - 60 }), {
    issuer: ISSUER,
    jwks,
    secretKey: "secret",
    fetchImpl,
  }),
  "expired",
);
await assertRejects(
  verifySupabaseAccessToken(await sign({}, { issuer: "https://evil.example/auth/v1" }), {
    issuer: ISSUER,
    jwks,
    secretKey: "secret",
    fetchImpl,
  }),
  "issuer",
);
await assertRejects(
  verifySupabaseAccessToken(await sign({}, { key: otherKey }), {
    issuer: ISSUER,
    jwks,
    secretKey: "secret",
    fetchImpl,
  }),
  "signature",
);
assert(fetches === 0, "bad tokens must not fall back to the user endpoint");

fetches = 0;
const fallbackFetch = async () => {
  fetches += 1;
  return new Response(
    JSON.stringify({
      id: "22222222-2222-4222-8222-222222222222",
      email: "ada@example.com",
      email_confirmed_at: "2026-10-04T00:00:00Z",
      app_metadata: { provider: "slack_oidc", providers: ["slack_oidc"] },
      user_metadata: { full_name: "Ada" },
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
};
const fellBack = await verifySupabaseAccessToken(await sign({}, { kid: "missing-key" }), {
  issuer: ISSUER,
  jwks,
  secretKey: "secret",
  fetchImpl: fallbackFetch,
});
assert(fetches === 1, "unknown key falls back once");
assert(fellBack.emailVerified && fellBack.email === "ada@example.com", "fallback keeps the verified email");
assert(fellBack.sub === "22222222-2222-4222-8222-222222222222", "fallback uses the user id");

const store = {
  users: [
    {
      id: "legacy-ada",
      email: "ada@example.com",
      name: "Ada",
      color: "#f4a261",
      googleSub: "google-subject-1",
      xp: 90,
      createdAt: 1,
      lastLoginAt: 1,
    },
  ],
  sessions: [],
};
const slack = establishSupabaseSession(
  store,
  {
    sub: "33333333-3333-4333-8333-333333333333",
    email: "ada@example.com",
    emailVerified: true,
    name: "Ada Slack",
    avatarUrl: "https://cdn.example/ada.png",
    googleSub: "",
  },
  { name: "Local Ada" },
);
assert(!slack.isNew, "slack email maps onto the existing account");
assert(slack.user.id === "legacy-ada", "legacy id kept");
assert(slack.user.xp === 90, "xp kept");
assert(slack.user.name === "Ada", "chosen name kept");
assert(slack.user.supabaseId === "33333333-3333-4333-8333-333333333333", "supabase id stored");
assert(slack.user.avatarUrl === "https://cdn.example/ada.png", "avatar stored");
assert(/^[a-f0-9]{64}$/.test(slack.token), "session token");
assert(store.sessions.length === 1 && store.sessions[0].userId === "legacy-ada", "one session");

const again = establishSupabaseSession(store, {
  sub: "33333333-3333-4333-8333-333333333333",
  email: "ada@example.com",
  emailVerified: true,
  name: "Ada",
  avatarUrl: "",
  googleSub: "",
});
assert(again.user.id === "legacy-ada" && !again.isNew, "second login finds the supabase id");
assert(store.sessions.length === 1, "old session replaced");
assert(again.token !== slack.token, "new session token");

const thief = establishSupabaseSession(store, {
  sub: "44444444-4444-4444-8444-444444444444",
  email: "ada@example.com",
  emailVerified: false,
  name: "Thief",
  avatarUrl: "",
  googleSub: "",
});
assert(thief.isNew && thief.user.id === "44444444-4444-4444-8444-444444444444", "unverified email does not take the desk");
assert(thief.user.email === "", "unverified email is not stored");
assert(store.users.find((row) => row.id === "legacy-ada").xp === 90, "legacy xp untouched");

const xUser = establishSupabaseSession(store, {
  sub: "55555555-5555-4555-8555-555555555555",
  email: "",
  emailVerified: false,
  name: "Ada X",
  avatarUrl: "",
  googleSub: "",
});
assert(xUser.isNew && xUser.user.id === xUser.user.supabaseId, "x account id is the supabase sub");
assert(xUser.user.email === "", "x account can have no email");

const googleAgain = establishSupabaseSession(
  {
    users: [
      {
        id: "legacy-google",
        email: "old@example.com",
        name: "Geo",
        color: "#f4a261",
        googleSub: "google-subject-9",
        xp: 12,
        createdAt: 1,
        lastLoginAt: 1,
      },
    ],
    sessions: [],
  },
  {
    sub: "66666666-6666-4666-8666-666666666666",
    email: "new@example.com",
    emailVerified: true,
    name: "Geo",
    avatarUrl: "",
    googleSub: "google-subject-9",
  },
);
assert(googleAgain.user.id === "legacy-google" && googleAgain.user.xp === 12, "old google subject keeps the account");

assert(isAllowlistedAdmin({ email: "ada@example.com", id: "legacy-ada" }, "ada@example.com", ""), "email admin");
assert(
  isAllowlistedAdmin({ email: "", id: "55555555-5555-4555-8555-555555555555", supabaseId: "55555555-5555-4555-8555-555555555555" }, "", "55555555-5555-4555-8555-555555555555"),
  "supabase id admin",
);
assert(!isAllowlistedAdmin({ email: "ada@example.com", id: "legacy-ada" }, "", ""), "empty allowlists are off");

const dir = mkdtempSync(join(tmpdir(), "haw-auth-"));
const accounts = join(dir, "accounts.json");
writeFileSync(
  accounts,
  JSON.stringify({
    secret: "0123456789abcdef0123456789abcdef",
    users: [
      {
        id: "legacy-ada",
        email: "ada@example.com",
        name: "Ada",
        color: "#f4a261",
        xp: 40,
        createdAt: 1,
        lastLoginAt: 1,
      },
    ],
    sessions: [],
    codes: [],
  }),
);
process.env.SUPABASE_URL = "https://tddtdrdhtgsbjqgmqjwe.supabase.co";
setAccountsStoreForTests(accounts);
setSupabaseVerifierForTests(async () => ({
  sub: "77777777-7777-4777-8777-777777777777",
  email: "ada@example.com",
  emailVerified: true,
  name: "Ada Slack",
  avatarUrl: "",
  googleSub: "",
}));
try {
  for (const pathname of ["/__auth/email/start", "/__auth/email/verify", "/__auth/google"]) {
    for (const method of ["GET", "POST"]) {
      const retired = await dispatchAuthForTests({ method, pathname, body: "{}" });
      assert(retired.status === 410, `${method} ${pathname} -> ${retired.status}`);
      assert(!JSON.stringify(retired.json).includes("devCode"), `${pathname} must not mint a code`);
    }
  }
  const minted = await dispatchAuthForTests({
    method: "POST",
    pathname: "/__auth/supabase",
    body: JSON.stringify({ accessToken: "test-token", name: "Ada" }),
  });
  assert(minted.status === 200, `supabase mint ${minted.status} ${JSON.stringify(minted.json)}`);
  assert(minted.json.user.id === "legacy-ada", "http mint keeps the legacy id");
  assert(userIdForToken(minted.json.token) === "legacy-ada", "minted session resolves");
} finally {
  setSupabaseVerifierForTests(null);
  setAccountsStoreForTests(null);
  rmSync(dir, { recursive: true, force: true });
}

async function assertRejects(promise, code) {
  try {
    await promise;
  } catch (err) {
    assert(err instanceof SupabaseTokenError, `expected SupabaseTokenError, got ${err}`);
    assert(err.code === code, `expected ${code}, got ${err.code}`);
    return;
  }
  throw new Error(`expected ${code}`);
}

console.log("supabase auth ok");
