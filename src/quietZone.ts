import { kindAt } from "./grid";
import type { FloorPlate, OfficeInstance } from "./types";

export function isQuietCell(plate: FloorPlate, col: number, row: number) {
  return kindAt(plate, col, row) === "library";
}

export function libraryAtCell(plate: FloorPlate, col: number, row: number): OfficeInstance | null {
  for (const room of plate.libraries ?? []) {
    const w = room.cols ?? 1;
    const h = room.rows ?? 1;
    if (col >= room.col && col < room.col + w && row >= room.row && row < room.row + h) {
      return room;
    }
  }
  return null;
}

export function poseInQuietZone(
  plate: FloorPlate,
  pose: { x: number; y: number; col?: number; row?: number },
) {
  const col = pose.col ?? Math.floor(pose.x / plate.grid.cellSize);
  const row = pose.row ?? Math.floor(pose.y / plate.grid.cellSize);
  return isQuietCell(plate, col, row);
}

/** Pause page/zone audio while inside the library. Restores what we paused. */
export function setAmbientSilent(on: boolean) {
  if (typeof document === "undefined") return;
  document.querySelectorAll("audio, video").forEach((node) => {
    const media = node as HTMLMediaElement;
    if (on) {
      if (!media.paused) {
        media.dataset.quietPaused = "1";
        media.pause();
      }
      return;
    }
    if (media.dataset.quietPaused === "1") {
      delete media.dataset.quietPaused;
      void media.play().catch(() => undefined);
    }
  });
}
