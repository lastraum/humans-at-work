import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { floorIsFull, floorName, maxOpenFloor, selectableFloors } from "../src/floors.ts";

const offices = ["a", "b", "c"];
const fixtures = ["a"];

function byFloor(entries) {
  const map = new Map();
  for (const [floor, claims] of entries) map.set(floor, claims);
  return map;
}

function claim(deskId, kind = "office") {
  return { deskId, kind };
}

if (floorName(1) !== "1st floor" || floorName(2) !== "2nd floor" || floorName(3) !== "3rd floor" || floorName(11) !== "11th floor") {
  throw new Error("floorName suffixes");
}

if (floorIsFull(1, [], offices, fixtures)) throw new Error("empty floor 1 is not full");
if (!floorIsFull(1, [claim("b"), claim("c")], offices, fixtures)) throw new Error("floor 1 fixtures plus remaining offices is full");
if (floorIsFull(2, [claim("b"), claim("c")], offices, fixtures)) throw new Error("floor 2 fixtures do not count");
if (!floorIsFull(2, [claim("a"), claim("b"), claim("c")], offices, fixtures)) throw new Error("floor 2 needs every office");

if (maxOpenFloor(byFloor([]), offices, fixtures) !== 1) throw new Error("always at least floor 1");

if (maxOpenFloor(byFloor([[1, [claim("b"), claim("c")]]]), offices, fixtures) !== 2) {
  throw new Error("full floor 1 opens floor 2");
}

if (maxOpenFloor(byFloor([[1, [claim("b")]]]), offices, fixtures) !== 1) {
  throw new Error("vacancy on floor 1 does not open floor 2");
}

if (
  maxOpenFloor(
    byFloor([
      [1, [claim("b")]],
      [2, [claim("a")]],
    ]),
    offices,
    fixtures,
  ) !== 2
) {
  throw new Error("occupied floor 2 stays even when floor 1 has a vacancy");
}

if (
  maxOpenFloor(
    byFloor([
      [1, [claim("b"), claim("c")]],
      [2, [claim("a"), claim("b"), claim("c")]],
    ]),
    offices,
    fixtures,
  ) !== 3
) {
  throw new Error("full floor 2 opens floor 3");
}

if (
  maxOpenFloor(
    byFloor([
      [1, [claim("b")]],
      [2, []],
      [3, []],
    ]),
    offices,
    fixtures,
  ) !== 1
) {
  throw new Error("empty higher floors drop once their desks are gone");
}

if (
  maxOpenFloor(
    byFloor([
      [1, [claim("b")]],
      [2, []],
      [3, [claim("a")]],
    ]),
    offices,
    fixtures,
  ) !== 3
) {
  throw new Error("occupied floor 3 stays even if floor 2 is empty");
}

function list(...entries) {
  return selectableFloors(byFloor(entries), offices, fixtures).join(",");
}

if (list() !== "1") throw new Error("empty building is floor 1");
if (list([1, [claim("b"), claim("c")]]) !== "1,2") throw new Error("full floor 1 offers overflow 2");
if (list([1, [claim("b")]]) !== "1") throw new Error("vacancy on floor 1 does not offer floor 2");
if (list([1, [claim("b")]], [2, [claim("a")]]) !== "1,2") {
  throw new Error("floor 2 with an office stays selectable");
}
if (list([1, [claim("b")]], [2, []], [3, [claim("a")]]) !== "1,3") {
  throw new Error("empty floor 2 is not selectable just because 3 is busy");
}
if (list([1, [claim("b"), claim("c")]], [2, [claim("a"), claim("b"), claim("c")]]) !== "1,2,3") {
  throw new Error("full floor 2 offers overflow 3");
}

const plate = JSON.parse(
  readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "../data/floor-plate.json"), "utf8"),
);
const plateOffices = (plate.offices ?? []).map((office) => String(office.id)).filter(Boolean);
const plateFixtures = (plate.avatars ?? [])
  .map((avatar) => String(avatar.officeId ?? ""))
  .filter((id) => id && plateOffices.includes(id));

if (plateOffices.length < 2) throw new Error(`expected offices on the plate, got ${plateOffices.length}`);
if (plateFixtures.length !== 0) {
  throw new Error(`expected no fixture bots on the plate, got ${plateFixtures.join(",")}`);
}

function plateByFloor(entries) {
  const map = new Map();
  for (const [floor, claims] of entries) map.set(floor, claims);
  return map;
}

const vacantOnFloor1 = plateOffices.filter((id) => !plateFixtures.includes(id));
const fillFloor1 = vacantOnFloor1.map((id) => claim(id));
const fillFloor2 = plateOffices.map((id) => claim(id));

if (floorIsFull(1, [], plateOffices, plateFixtures)) {
  throw new Error("empty floor 1 is not full");
}
if (floorIsFull(1, fillFloor1.slice(0, -1), plateOffices, plateFixtures)) {
  throw new Error("one vacant office on floor 1 is not full");
}
if (!floorIsFull(1, fillFloor1, plateOffices, plateFixtures)) {
  throw new Error("floor 1 is full when every office is claimed");
}
if (floorIsFull(2, fillFloor1.slice(0, -1), plateOffices, plateFixtures)) {
  throw new Error("floor 2 is not full with a vacancy");
}
if (!floorIsFull(2, fillFloor2, plateOffices, plateFixtures)) {
  throw new Error("floor 2 is full only when every office is claimed");
}

if (maxOpenFloor(plateByFloor([]), plateOffices, plateFixtures) !== 1) {
  throw new Error("empty building is only floor 1");
}
if (maxOpenFloor(plateByFloor([[1, fillFloor1]]), plateOffices, plateFixtures) !== 2) {
  throw new Error("full floor 1 opens floor 2 for a new joiner");
}
if (selectableFloors(plateByFloor([[1, fillFloor1]]), plateOffices, plateFixtures).join(",") !== "1,2") {
  throw new Error("joiner on a packed floor 1 should see overflow floor 2");
}
if (
  maxOpenFloor(plateByFloor([[1, fillFloor1], [2, fillFloor2]]), plateOffices, plateFixtures) !== 3
) {
  throw new Error("full floor 2 opens floor 3");
}

console.log("floor occupancy ok");
