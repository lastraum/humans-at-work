import { blocksWhispers, clampPrivacy, privacyLabel } from "../src/protocol.ts";
import { canStayInPrivate, clampAdmitted, doorOutsideCell, worldDoorEdge } from "../src/privateOffice.ts";

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

assert(clampPrivacy("private") === "private", "private is a privacy value");
assert(clampPrivacy("busy") === "busy" && clampPrivacy("focus") === "focus", "busy and focus stay");
assert(clampPrivacy("nope") === "open", "unknown privacy falls open");
assert(privacyLabel("private") === "Private", "private label");
assert(privacyLabel("open") === "Open", "open label");
assert(blocksWhispers("private") && blocksWhispers("busy") && blocksWhispers("focus"), "closed modes skip whispers");
assert(!blocksWhispers("open"), "open still takes whispers");

const claim = { privacy: "private", peerId: "owner", admitted: ["owner", "guest"] };
assert(canStayInPrivate(claim, "owner"), "claimer stays even after stepping out");
assert(canStayInPrivate({ privacy: "private", peerId: "owner", admitted: ["guest"] }, "owner"), "claimer is admitted without being listed");
assert(canStayInPrivate(claim, "guest"), "snapshotted visitor stays");
assert(!canStayInPrivate(claim, "stranger"), "newcomer is blocked");
assert(!canStayInPrivate({ privacy: "private", peerId: "owner", admitted: ["owner"] }, "guest"), "visitor who left cannot re-enter");
assert(canStayInPrivate({ privacy: "open", peerId: "owner" }, "stranger"), "leaving private restores open entry");
assert(canStayInPrivate({ privacy: "busy", peerId: "owner" }, "stranger"), "busy is not a hard cell block");

const ids = clampAdmitted(["guest", "guest", "not an id", "owner"], "owner");
assert(ids[0] === "owner" && ids.length === 2 && ids[1] === "guest", "admitted list keeps claimer and drops junk");

assert(worldDoorEdge("n", 180) === "s", "rot 180 turns a north door south");
assert(worldDoorEdge("n", 90) === "e", "rot 90 turns a north door east");
const office04 = doorOutsideCell({ col: 2, row: 0, cols: 1, rows: 1, rot: 180, doorEdge: "n" });
assert(office04.col === 2 && office04.row === 1, "office_04 kick lands in the hall south of the door");
const north = doorOutsideCell({ col: 3, row: 4, rot: 0, doorEdge: "n" });
assert(north.col === 3 && north.row === 3, "unrotated north door exits north");
const cube = doorOutsideCell({ col: 4, row: 6 });
assert(cube.col === 4 && cube.row === 7, "a cubicle with no door exits south");

console.log("privacy ok");
