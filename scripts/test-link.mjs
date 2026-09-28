import {
  PING_MISSES,
  PING_MS,
  RECOVERY_MS,
  countedMs,
  holdContact,
  nextPingSample,
  resumeContact,
} from "../src/linkHealth.ts";

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

assert(PING_MS === 30_000, "ping every 30 seconds");
assert(PING_MISSES === 2, "two misses start recovery");
assert(RECOVERY_MS > PING_MS, "recovery waits at least one more interval");

assert(nextPingSample({ alive: true, misses: 1 }).misses === 0, "a pong clears the run");
assert(!nextPingSample({ alive: true, misses: 1 }).recover, "a pong does not recover");
const once = nextPingSample({ alive: false, misses: 0 });
assert(once.misses === 1 && !once.recover, "one miss is still on the clock");
const twice = nextPingSample({ alive: false, misses: once.misses });
assert(twice.misses === 2 && twice.recover, "two misses in a row start recovery");

const clock = { lastTickAt: 1_000, suspended: false, droppedMs: 0 };
const grant = holdContact(clock, 50_000, 90_000);
assert(grant === 49_000, "time through the last pong still counts");
assert(clock.suspended && clock.lastTickAt === 50_000, "silence after the pong is not pending");
assert(countedMs(1_000, clock, 90_000) === 49_000, "the notice delay is not time on the clock");
assert(holdContact(clock, 50_000, 120_000) === 0, "holding twice does not grant again");

resumeContact(clock, 120_000);
assert(!clock.suspended && clock.lastTickAt === 120_000, "a hello resumes the same shift");
assert(clock.droppedMs === 70_000, "the gap stays dropped after they return");
assert(countedMs(1_000, clock, 150_000) === 79_000, "time after the hello counts again");

const gone = { lastTickAt: 0, suspended: false, droppedMs: 0 };
holdContact(gone, 30_000, 60_000);
assert(countedMs(0, gone, 150_000) === 30_000, "giving up does not add the recovery window");

console.log("link health ok");
