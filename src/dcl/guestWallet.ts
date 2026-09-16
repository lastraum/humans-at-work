/**
 * Guest: stable ETH wallet per user id in localStorage.
 * Signed-in: one wallet per login session. Private keys never go in accounts.json.
 */
import { Authenticator } from "@dcl/crypto";
import { createUnsafeIdentity } from "@dcl/crypto/dist/crypto";
import type { AuthIdentity, IdentityType } from "@dcl/crypto/dist/types";

const TTL_MS = 24 * 60 * 60 * 1000;

export type GuestWallet = {
  address: string;
  identity: AuthIdentity;
};

type Stored = {
  privateKey: string;
  publicKey: string;
  address: string;
  identity?: {
    expiration: string;
    authChain: AuthIdentity["authChain"];
    ephemeralIdentity: IdentityType;
  };
};

function guestKey(userId: string) {
  return `haw-dcl-guest:${userId}`;
}

function sessionKey(token: string) {
  return `haw-dcl-session:${token.slice(0, 24)}`;
}

function normalizeAddress(value: string) {
  const address = value.trim().toLowerCase();
  return /^0x[a-f0-9]{40}$/.test(address) ? address : null;
}

function rootFrom(rec: Stored): IdentityType | null {
  const address = normalizeAddress(rec.address);
  if (!address || !rec.privateKey?.trim() || !rec.publicKey?.trim()) return null;
  return {
    privateKey: rec.privateKey.replace(/^0x/i, "").toLowerCase(),
    publicKey: rec.publicKey.replace(/^0x/i, "").toLowerCase(),
    address,
  };
}

function revive(raw: Stored["identity"]): AuthIdentity | null {
  if (!raw) return null;
  try {
    const expiration = new Date(raw.expiration);
    if (Number.isNaN(expiration.getTime()) || expiration.getTime() <= Date.now() + 60_000) return null;
    return {
      ephemeralIdentity: raw.ephemeralIdentity,
      expiration,
      authChain: raw.authChain,
    };
  } catch {
    return null;
  }
}

function readStored(key: string): Stored | null {
  try {
    return JSON.parse(localStorage.getItem(key) ?? "null") as Stored | null;
  } catch {
    return null;
  }
}

async function walletAt(key: string, fresh = false): Promise<GuestWallet> {
  let rec = fresh ? null : readStored(key);
  let root = rec ? rootFrom(rec) : null;
  if (!root) {
    const created = createUnsafeIdentity();
    rec = {
      privateKey: created.privateKey.replace(/^0x/i, "").toLowerCase(),
      publicKey: created.publicKey.replace(/^0x/i, "").toLowerCase(),
      address: created.address.toLowerCase(),
    };
    root = rootFrom(rec)!;
    localStorage.setItem(key, JSON.stringify(rec));
  }

  let identity = revive(rec!.identity);
  if (!identity) {
    const ephemeral = createUnsafeIdentity();
    identity = await Authenticator.initializeAuthChain(
      root.address,
      ephemeral,
      Math.max(1, Math.floor(TTL_MS / 60_000)),
      async (message) => Authenticator.createSignature(root, message),
    );
    rec = {
      ...rec!,
      address: root.address,
      identity: {
        expiration: identity.expiration.toISOString(),
        authChain: identity.authChain,
        ephemeralIdentity: identity.ephemeralIdentity,
      },
    };
    localStorage.setItem(key, JSON.stringify(rec));
  }

  return { address: root.address, identity };
}

export async function ensureGuestWallet(userId: string): Promise<GuestWallet> {
  return walletAt(guestKey(userId));
}

export async function ensureSessionWallet(token: string, fresh = false): Promise<GuestWallet> {
  return walletAt(sessionKey(token), fresh);
}

export function dropSessionWallet(token: string) {
  localStorage.removeItem(sessionKey(token));
}
