import { bankMinutes, GUEST_SHIFT_MS, guestGrant, XP_BLOCK_MINUTES, XP_PER_BLOCK, XP_PER_MINUTE } from "../src/xp.ts";

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

assert(XP_PER_MINUTE === 1, "one xp per minute");
assert(XP_BLOCK_MINUTES === 30, "block is 30 minutes");
assert(XP_PER_BLOCK === 30, "30 xp per 30 minutes");

let banked = bankMinutes(0, 0);
assert(banked.xp === 0 && banked.remainderMs === 0, "zero");

banked = bankMinutes(0, 59_999);
assert(banked.xp === 0 && banked.remainderMs === 59_999, "partial minute waits");

banked = bankMinutes(1, 59_999);
assert(banked.xp === 1 && banked.remainderMs === 0, "remainder completes a minute");

banked = bankMinutes(0, 30 * 60_000);
assert(banked.xp === 30 && banked.remainderMs === 0, "half hour");

banked = bankMinutes(0, 60 * 60_000);
assert(banked.xp === 60 && banked.remainderMs === 0, "hour");

banked = bankMinutes(40_000, 30_000);
assert(banked.xp === 1 && banked.remainderMs === 10_000, "split minute");

banked = bankMinutes(0, -5);
assert(banked.xp === 0 && banked.remainderMs === 0, "negative elapsed");

assert(GUEST_SHIFT_MS === 5 * 60_000, "guest visit is five minutes");
const under = guestGrant({ guestMs: 0, elapsedMs: 60_000, signedIn: false, held: false });
assert(under.grant === 60_000 && under.guestMs === 60_000 && !under.held, "guest minute banks");
const cap = guestGrant({ guestMs: GUEST_SHIFT_MS - 1000, elapsedMs: 30_000, signedIn: false, held: false });
assert(cap.grant === 1000 && cap.held && cap.guestMs === GUEST_SHIFT_MS, "guest cap stops the extra");
const held = guestGrant({ guestMs: GUEST_SHIFT_MS, elapsedMs: 60_000, signedIn: false, held: true });
assert(held.grant === 0 && held.held, "held guest earns nothing");
const signed = guestGrant({ guestMs: GUEST_SHIFT_MS, elapsedMs: 60_000, signedIn: true, held: true });
assert(signed.grant === 60_000 && !signed.held, "sign-in lifts the hold");

console.log("xp ok");
