import type { IncomingMessage } from "node:http";

/** True only for a client that connected straight to this process on loopback.
 *  nginx sets X-Real-IP / X-Forwarded-For on every public request, including
 *  websockets, so those must not count as local. */
export function isDirectLoopback(req: IncomingMessage) {
  const addr = req.socket?.remoteAddress ?? "";
  const loop = addr === "127.0.0.1" || addr === "::1" || addr === "::ffff:127.0.0.1";
  if (!loop) return false;
  if (req.headers["x-real-ip"] || req.headers["x-forwarded-for"]) return false;
  return true;
}

/** Client address as nginx records it. X-Real-IP is the connecting peer.
 *  A client-supplied X-Forwarded-For is not trusted on its own. */
export function clientIp(req: IncomingMessage) {
  const real = req.headers["x-real-ip"];
  const realIp = (Array.isArray(real) ? real[0] : real)?.trim();
  if (realIp) return realIp.slice(0, 64);
  const fwd = req.headers["x-forwarded-for"];
  const raw = Array.isArray(fwd) ? fwd[fwd.length - 1] : fwd;
  const parts = String(raw ?? "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  const last = parts[parts.length - 1];
  return (last || req.socket?.remoteAddress || "unknown").slice(0, 64);
}
