const KEY = "haw-blocked";

function read(): string[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY) ?? "[]") as unknown;
    return Array.isArray(parsed) ? parsed.map((id) => String(id)).filter(Boolean) : [];
  } catch {
    return [];
  }
}

function write(ids: string[]) {
  localStorage.setItem(KEY, JSON.stringify([...new Set(ids)]));
}

export function readBlocked() {
  return read();
}

export function writeBlocked(ids: string[]) {
  write(ids);
}

export function addBlocked(id: string) {
  const next = [...new Set([...read(), id])];
  write(next);
  return next;
}

export function removeBlocked(id: string) {
  const next = read().filter((row) => row !== id);
  write(next);
  return next;
}
