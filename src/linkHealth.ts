/** Room-socket health. A protocol ping every 30s. Two missed pongs in a row
 *  start a recovery instead of ending the shift. The silent stretch is not
 *  time on the clock. */

export const PING_MS = 30_000;
/** Consecutive missed pongs before we close the socket and wait for hello. */
export const PING_MISSES = 2;
/** How long the desk, seat, and shift stay reserved after that close. */
export const RECOVERY_MS = 90_000;

export type PingSample = { alive: boolean; misses: number };

export function nextPingSample(sample: PingSample) {
  if (sample.alive) return { misses: 0, recover: false };
  const misses = sample.misses + 1;
  return { misses, recover: misses >= PING_MISSES };
}

export type ContactClock = {
  lastTickAt: number;
  suspended: boolean;
  droppedMs: number;
};

/** Bank only through the last pong. Later silence stays off the clock. */
export function holdContact(clock: ContactClock, goodAt: number, now: number) {
  if (clock.suspended) return 0;
  const until = Math.min(now, Math.max(clock.lastTickAt, goodAt));
  const grantMs = Math.max(0, until - clock.lastTickAt);
  clock.lastTickAt = until;
  clock.suspended = true;
  return grantMs;
}

/** They came back. The gap since the last counted instant is not granted. */
export function resumeContact(clock: ContactClock, now: number) {
  if (!clock.suspended) return;
  clock.droppedMs += Math.max(0, now - clock.lastTickAt);
  clock.suspended = false;
  clock.lastTickAt = now;
}

export function countedMs(startedAt: number, clock: ContactClock, now: number) {
  const quiet = clock.droppedMs + (clock.suspended ? Math.max(0, now - clock.lastTickAt) : 0);
  return Math.max(0, now - startedAt - quiet);
}
