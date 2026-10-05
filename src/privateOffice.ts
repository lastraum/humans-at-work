import type { Privacy } from "./protocol";

const EDGES = ["n", "e", "s", "w"] as const;
export type DoorEdge = (typeof EDGES)[number];

export function normalizeDoorEdge(value: unknown): DoorEdge {
  return value === "n" || value === "e" || value === "s" || value === "w" ? value : "s";
}

/** Room rot is clockwise. Template door edges rotate with the office. */
export function worldDoorEdge(edge: DoorEdge, rot: number): DoorEdge {
  const steps = Math.round((((rot % 360) + 360) % 360) / 90) % 4;
  return EDGES[(EDGES.indexOf(edge) + steps) % 4];
}

export function cellInsideFootprint(
  col: number,
  row: number,
  desk: { col: number; row: number; cols?: number; rows?: number },
) {
  const cols = desk.cols && desk.cols > 0 ? desk.cols : 1;
  const rows = desk.rows && desk.rows > 0 ? desk.rows : 1;
  return col >= desk.col && col < desk.col + cols && row >= desk.row && row < desk.row + rows;
}

/** Cell just outside the door. Defaults to the south side when the desk has no door. */
export function doorOutsideCell(desk: {
  col: number;
  row: number;
  cols?: number;
  rows?: number;
  rot?: number;
  doorEdge?: string;
}): { col: number; row: number } {
  const cols = desk.cols && desk.cols > 0 ? desk.cols : 1;
  const rows = desk.rows && desk.rows > 0 ? desk.rows : 1;
  const edge = worldDoorEdge(normalizeDoorEdge(desk.doorEdge), desk.rot ?? 0);
  const midC = desk.col + Math.floor((cols - 1) / 2);
  const midR = desk.row + Math.floor((rows - 1) / 2);
  if (edge === "n") return { col: midC, row: desk.row - 1 };
  if (edge === "s") return { col: midC, row: desk.row + rows };
  if (edge === "w") return { col: desk.col - 1, row: midR };
  return { col: desk.col + cols, row: midR };
}

/** Claimer is always admitted. Everyone else must still be in the snapshot. */
export function canStayInPrivate(
  claim: { privacy: Privacy | string; peerId: string; admitted?: readonly string[] },
  peerId: string,
) {
  if (claim.privacy !== "private") return true;
  if (claim.peerId === peerId) return true;
  return Boolean(claim.admitted?.includes(peerId));
}

export function clampAdmitted(value: unknown, claimerId: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (raw: unknown) => {
    const id = String(raw ?? "").slice(0, 64);
    if (!/^[A-Za-z0-9._:-]+$/.test(id) || seen.has(id)) return;
    seen.add(id);
    out.push(id);
  };
  push(claimerId);
  if (Array.isArray(value)) {
    for (const id of value) push(id);
  }
  return out;
}
