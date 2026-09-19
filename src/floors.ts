/** Story floors share one plate. Occupancy is a data filter, not extra geometry. */

export const FIRST_FLOOR = 1;

export type Occupancy = { deskId: string; kind: string };

export function floorName(n: number) {
  const v = Math.abs(Math.trunc(n)) % 100;
  const ones = v % 10;
  const suffix =
    v >= 11 && v <= 13 ? "th" : ones === 1 ? "st" : ones === 2 ? "nd" : ones === 3 ? "rd" : "th";
  return `${n}${suffix} floor`;
}

function occupiedOffices(claims: Iterable<Occupancy>, extraIds: Iterable<string> = []) {
  const taken = new Set<string>();
  for (const claim of claims) {
    if (claim.kind === "office") taken.add(claim.deskId);
  }
  for (const id of extraIds) taken.add(id);
  return taken;
}

export function floorHasDesk(claims: Iterable<Occupancy>) {
  for (const claim of claims) {
    if (claim.kind === "office" || claim.kind === "cubicle") return true;
  }
  return false;
}

export function floorHasOffice(claims: Iterable<Occupancy>) {
  for (const claim of claims) {
    if (claim.kind === "office") return true;
  }
  return false;
}

/** Floor 1 fixtures count as taken. Higher floors use the same office ids, vacant. */
export function floorIsFull(
  floor: number,
  claims: Iterable<Occupancy>,
  officeIds: string[],
  fixtureIds: string[] = [],
) {
  if (!officeIds.length) return false;
  const extra = floor === FIRST_FLOOR ? fixtureIds : [];
  const taken = occupiedOffices(claims, extra);
  return officeIds.every((id) => taken.has(id));
}

/**
 * Floors the elevator will offer to people who are not already there.
 * Floor 1 always. Any floor with a claimed office. One overflow floor
 * above each *full* floor so newcomers can still check in.
 *
 * A floor with no office claims is not selectable — even if people are
 * still walking on it, and even if a higher floor is busy. Those people
 * can stay until they ride away or disconnect; then the namespace is gone.
 */
export function selectableFloors(
  claimsByFloor: Map<number, Occupancy[]>,
  officeIds: string[],
  fixtureIds: string[] = [],
) {
  const open = new Set<number>([FIRST_FLOOR]);
  for (const [floor, claims] of claimsByFloor) {
    if (floor > FIRST_FLOOR && floorHasOffice(claims)) open.add(floor);
  }
  for (const floor of [...open].sort((a, b) => a - b)) {
    if (floorIsFull(floor, claimsByFloor.get(floor) ?? [], officeIds, fixtureIds)) {
      open.add(floor + 1);
    }
  }
  return [...open].sort((a, b) => a - b);
}

export function maxOpenFloor(
  claimsByFloor: Map<number, Occupancy[]>,
  officeIds: string[],
  fixtureIds: string[] = [],
) {
  const floors = selectableFloors(claimsByFloor, officeIds, fixtureIds);
  return floors[floors.length - 1] ?? FIRST_FLOOR;
}

export function sameFloors(a: number[], b: number[]) {
  return a.length === b.length && a.every((floor, i) => floor === b[i]);
}

export function groupClaimsByFloor<T extends Occupancy & { floor?: number }>(claims: Iterable<T>) {
  const byFloor = new Map<number, T[]>();
  for (const claim of claims) {
    const floor = Math.max(FIRST_FLOOR, Math.trunc(Number(claim.floor) || FIRST_FLOOR));
    const list = byFloor.get(floor);
    if (list) list.push(claim);
    else byFloor.set(floor, [claim]);
  }
  return byFloor;
}
