import { forgetGate, rememberGate } from "../server/presence.ts";

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const rows = [];
rememberGate(rows, "person-a", 1);
rememberGate(rows, "person-a", 5);
assert(rows.length === 1 && rows[0].seen === 5, "a repeat visit is the same person");
rememberGate(rows, "person-b", 2);
assert(rows.length === 2, "someone new is counted");
forgetGate(rows, "person-a");
assert(rows.length === 2 && rows[0].entered === true, "clocking in keeps them in the all-time count");
assert(rows.filter((row) => !row.entered).length === 1, "they leave the still-waiting count");
forgetGate(rows, "person-a");
assert(rows.length === 2, "forgetting twice is safe");
rememberGate(rows, "person-a", 9);
assert(rows[0].entered === false && rows[0].seen === 9, "a later visit is waiting again");

console.log("gate visits ok");
