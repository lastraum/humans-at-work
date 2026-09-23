/** Avatar colors and gender. Shirt is also the legacy `color` field. */

export type AvatarGender = "f" | "m";

export type AvatarLook = {
  gender: AvatarGender;
  skin: string;
  hair: string;
  eyes: string;
  shirt: string;
  pants: string;
};

export const SKINS = ["#f1d2b6", "#e8c4a8", "#c68642", "#8d5524", "#6b3e26"] as const;
export const HAIRS = ["#1a1a1a", "#2a2118", "#4a3728", "#5c3317", "#c4a574", "#d8d2c8"] as const;
export const EYES = ["#1a1a2e", "#4a3428", "#2f6b4a", "#3d6cb5", "#7a8494", "#6b4a2a"] as const;
export const SHIRTS = [
  "#f4a261",
  "#e76f51",
  "#2a9d8f",
  "#e9c46a",
  "#9b5de5",
  "#00bbf9",
  "#f15bb5",
  "#80b918",
] as const;
export const PANTS = ["#2c3340", "#3a3f4a", "#343a32", "#3d342e"] as const;

export const LOOK_PARTS = [
  { key: "skin", label: "Skin", colors: SKINS },
  { key: "hair", label: "Hair", colors: HAIRS },
  { key: "eyes", label: "Eyes", colors: EYES },
  { key: "shirt", label: "Shirt", colors: SHIRTS },
  { key: "pants", label: "Pants", colors: PANTS },
] as const;

export type LookPart = (typeof LOOK_PARTS)[number]["key"];

const PALETTES: Record<LookPart, readonly string[]> = {
  skin: SKINS,
  hair: HAIRS,
  eyes: EYES,
  shirt: SHIRTS,
  pants: PANTS,
};

export function hashId(id: string) {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  return h >>> 0;
}

function hex(value: unknown) {
  const color = String(value ?? "").trim().toLowerCase();
  return /^#[0-9a-f]{6}$/.test(color) ? color : "";
}

function fromList(list: readonly string[], value: unknown) {
  const color = hex(value);
  return list.includes(color) ? color : "";
}

export function clampLook(value: unknown): AvatarLook | undefined {
  if (!value || typeof value !== "object") return undefined;
  const raw = value as Partial<AvatarLook>;
  const gender = raw.gender === "f" || raw.gender === "m" ? raw.gender : "";
  const skin = fromList(SKINS, raw.skin);
  const hair = fromList(HAIRS, raw.hair);
  const eyes = fromList(EYES, raw.eyes);
  const shirt = fromList(SHIRTS, raw.shirt);
  const pants = fromList(PANTS, raw.pants);
  if (!gender || !skin || !hair || !eyes || !shirt || !pants) return undefined;
  return { gender, skin, hair, eyes, shirt, pants };
}

/** Stable look for someone who has not saved one. Skin, hair, and pants use the old id hash. */
export function lookFromId(id: string, shirt?: string): AvatarLook {
  const seed = hashId(id || "you");
  const picked = hex(shirt);
  return {
    gender: (seed >>> 15) & 1 ? "f" : "m",
    skin: SKINS[seed % SKINS.length]!,
    hair: HAIRS[(seed >>> 3) % HAIRS.length]!,
    eyes: EYES[(seed >>> 18) % EYES.length]!,
    shirt: SHIRTS.includes(picked as (typeof SHIRTS)[number])
      ? picked
      : SHIRTS[seed % SHIRTS.length]!,
    pants: PANTS[(seed >>> 6) % PANTS.length]!,
  };
}

export function resolveLook(avatar: { id?: string; color?: string; look?: AvatarLook | null }): AvatarLook {
  const explicit = clampLook(avatar.look);
  if (explicit) return explicit;
  const derived = lookFromId(avatar.id || "you", avatar.color);
  const shirt = hex(avatar.color);
  if (shirt) derived.shirt = shirt;
  return derived;
}

export function sameLook(a: AvatarLook, b: AvatarLook) {
  return (
    a.gender === b.gender &&
    a.skin === b.skin &&
    a.hair === b.hair &&
    a.eyes === b.eyes &&
    a.shirt === b.shirt &&
    a.pants === b.pants
  );
}

function pick(list: readonly string[], rng: () => number) {
  const index = Math.min(list.length - 1, Math.floor(rng() * list.length));
  return list[Math.max(0, index)]!;
}

/** New colors for every part except gender. */
export function randomLook(gender: AvatarGender, avoid?: AvatarLook, rng: () => number = Math.random): AvatarLook {
  const roll = (): AvatarLook => ({
    gender,
    skin: pick(PALETTES.skin, rng),
    hair: pick(PALETTES.hair, rng),
    eyes: pick(PALETTES.eyes, rng),
    shirt: pick(PALETTES.shirt, rng),
    pants: pick(PALETTES.pants, rng),
  });
  let next = roll();
  for (let i = 0; i < 4 && avoid && sameLook(next, { ...avoid, gender }); i++) next = roll();
  return next;
}
