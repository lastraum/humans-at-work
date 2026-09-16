import type { AuthIdentity } from "@dcl/crypto/dist/types";
import signedFetch from "decentraland-crypto-fetch";

export const DCL_WORLD = "nflnetwork.dcl.eth";
const WORLDS_CONTENT = "https://worlds-content-server.decentraland.org";

export function parseLiveKitAdapter(raw: string): { url: string; token: string } {
  const trimmed = raw.trim();
  const without = trimmed.startsWith("livekit:") ? trimmed.slice("livekit:".length) : trimmed;
  const u = new URL(without);
  const token = u.searchParams.get("access_token");
  if (!token) throw new Error("connection_string_missing_access_token");
  return { url: `${u.protocol}//${u.host}${u.pathname}`, token };
}

function unwrapAdapter(raw: string) {
  let value = raw.trim();
  if (value.startsWith("fixed-adapter:")) value = value.slice("fixed-adapter:".length);
  return value;
}

export async function fetchWorldAbout(worldName = DCL_WORLD) {
  const res = await fetch(`${WORLDS_CONTENT}/world/${encodeURIComponent(worldName)}/about`, {
    headers: { Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`world about failed (${res.status})`);
  const json = (await res.json()) as {
    comms?: { adapter?: string };
    content?: { publicUrl?: string };
  };
  const adapter = json.comms?.adapter?.trim() ?? "";
  if (!adapter) throw new Error("world_comms_adapter_missing");
  return {
    adapter,
    contentUrl: json.content?.publicUrl?.replace(/\/$/, "") ?? "https://peer.decentraland.org/content",
  };
}

export async function signedLoginForWorld(identity: AuthIdentity, signedLoginUrl: string, contentUrl: string) {
  const metadata = {
    intent: "dcl:explorer:comms-handshake",
    signer: "dcl:explorer",
    isGuest: false,
    origin: typeof window !== "undefined" ? window.location.origin : contentUrl,
  };
  const res = await signedFetch(signedLoginUrl, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({}),
    identity,
    metadata,
  });
  const body = (await res.json().catch(() => null)) as { fixedAdapter?: string; adapter?: string; error?: string } | null;
  if (!res.ok) throw new Error(body?.error || `world_comms_error (${res.status})`);
  const adapter = body?.fixedAdapter || body?.adapter;
  if (!adapter) throw new Error("invalid_world_comms_response");
  return unwrapAdapter(adapter);
}

export async function resolveWorldLiveKit(identity: AuthIdentity, worldName = DCL_WORLD) {
  const about = await fetchWorldAbout(worldName);
  let adapter = unwrapAdapter(about.adapter);
  if (adapter.startsWith("signed-login:")) {
    adapter = await signedLoginForWorld(identity, adapter.slice("signed-login:".length), about.contentUrl);
    adapter = unwrapAdapter(adapter);
  }
  return parseLiveKitAdapter(adapter);
}
