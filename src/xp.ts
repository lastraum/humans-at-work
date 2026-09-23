/** Time on the floor, banked by the server from the room connection.
 *  1 XP per full minute, which is 30 XP per 30 minutes.
 *  Seconds stay in remainderMs until they add up to a minute. */

export const XP_PER_MINUTE = 1;
export const XP_BLOCK_MINUTES = 30;
export const XP_PER_BLOCK = XP_PER_MINUTE * XP_BLOCK_MINUTES;
/** Unsigned time on one room connection. Signing in lifts it. */
export const GUEST_SHIFT_MS = 5 * 60 * 1000;
const MINUTE_MS = 60_000;

export function xpRateLabel() {
  return `${XP_PER_BLOCK} XP every ${XP_BLOCK_MINUTES} minutes`;
}

/** How much of `elapsedMs` still banks while this connection is a guest. */
export function guestGrant(opts: {
  guestMs: number;
  elapsedMs: number;
  signedIn: boolean;
  held: boolean;
}) {
  const elapsed = Math.max(0, opts.elapsedMs);
  const used = Math.max(0, opts.guestMs);
  if (opts.signedIn) return { grant: elapsed, guestMs: used, held: false };
  if (opts.held) return { grant: 0, guestMs: used, held: true };
  const grant = Math.min(elapsed, Math.max(0, GUEST_SHIFT_MS - used));
  const guestMs = used + grant;
  return { grant, guestMs, held: guestMs >= GUEST_SHIFT_MS };
}

export function bankMinutes(remainderMs: number, elapsedMs: number) {
  const total = Math.max(0, remainderMs) + Math.max(0, elapsedMs);
  const minutes = Math.floor(total / MINUTE_MS);
  return {
    xp: minutes * XP_PER_MINUTE,
    remainderMs: total - minutes * MINUTE_MS,
  };
}
