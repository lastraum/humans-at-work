/** Camera presets for the film tools. Served only to an admin session. */

export type FilmLook = "w" | "e" | "s" | "n";

export type FilmShot = {
  x: number;
  y: number;
  zoom: number;
  film?: "hide" | "chat" | "hud";
  look?: FilmLook;
};

export const FILM_SHOTS: Record<string, FilmShot> = {
  elevator: { x: 448, y: 1214, zoom: 8 },
  kitchen: { x: 455, y: 1495, zoom: 8.6 },
  hall: { x: 300, y: 1580, zoom: 6.8 },
  rec: { x: 620, y: 2188, zoom: 8.3 },
  door: { x: 205, y: 1342, zoom: 9.2 },
  office: { x: 95, y: 1343, zoom: 10.2 },
  window: { x: 18, y: 1408, zoom: 8.4 },
  "lina-inside": { x: 95, y: 1343, zoom: 10.2, film: "chat" },
  "ash-inside": { x: 1288, y: 1343, zoom: 9.6, look: "w" },
  "ash-window": { x: 1288, y: 1343, zoom: 8.4, look: "w" },
  chat: { x: 455, y: 1495, zoom: 8.2, film: "chat" },
  whisper: { x: 455, y: 1495, zoom: 8.2, film: "chat" },
  focus: { x: 1288, y: 1343, zoom: 8.8, look: "w" },
  xp: { x: 360, y: 1520, zoom: 6.3, film: "hud" },
  clockout: { x: 448, y: 1214, zoom: 8 },
};
