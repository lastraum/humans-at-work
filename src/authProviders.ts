/** Supabase OAuth providers. `x` is Twitter OAuth 2.0. `slack_oidc` is Sign in with Slack. */
export const AUTH_PROVIDERS = ["google", "x", "discord", "slack_oidc"] as const;

export type AuthProvider = (typeof AUTH_PROVIDERS)[number];

const ALIASES: Record<string, AuthProvider> = {
  google: "google",
  x: "x",
  twitter: "x",
  discord: "discord",
  slack: "slack_oidc",
  slack_oidc: "slack_oidc",
};

/**
 * Unset means every provider. An empty string means none.
 * A list hides any provider it does not name.
 */
export function enabledAuthProviders(raw?: string | null): AuthProvider[] {
  if (raw == null) return [...AUTH_PROVIDERS];
  const trimmed = raw.trim();
  if (!trimmed) return [];
  const out: AuthProvider[] = [];
  for (const part of trimmed.split(/[,;\s]+/)) {
    const id = ALIASES[part.trim().toLowerCase()];
    if (id && !out.includes(id)) out.push(id);
  }
  return out;
}

export function authProviderLabel(provider: AuthProvider) {
  switch (provider) {
    case "google":
      return "Continue with Google";
    case "x":
      return "Continue with X";
    case "discord":
      return "Continue with Discord";
    case "slack_oidc":
      return "Continue with Slack";
  }
}
