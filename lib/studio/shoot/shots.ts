/** Shoot page rules, shared by the page, the Mac assembly and tests. A shot's footage is an ordinary footage upload of the piece
 * whose file name says which beat it belongs to ("Shot 03 take 2.mp4"): no new storage, table or pipeline. */
export const MAX_SHOTS = 40;

export const shotFileName = (shot: number, take: number, extension: string) =>
  `Shot ${String(shot).padStart(2, "0")} take ${take}.${extension.replace(/^\./, "").toLowerCase()}`;

const shotName = /^Shot (\d{1,2}) take (\d{1,3})\.[a-z0-9]{2,5}$/i;
export function parseShotFileName(name: string): { shot: number; take: number } | null {
  const m = shotName.exec(name.trim());
  if (!m) return null;
  const shot = Number(m[1]), take = Number(m[2]);
  return shot >= 1 && shot <= MAX_SHOTS && take >= 1 ? { shot, take } : null;
}

/** The newest take of each shot wins; earlier takes are kept but never used. Keys are file names. */
export function currentShotFiles<T extends { name: string }>(files: readonly T[]): Map<number, T> {
  const best = new Map<number, { file: T; take: number }>();
  for (const file of files) {
    const parsed = parseShotFileName(file.name);
    if (!parsed) continue;
    const old = best.get(parsed.shot);
    if (!old || parsed.take > old.take) best.set(parsed.shot, { file, take: parsed.take });
  }
  return new Map([...best].map(([shot, v]) => [shot, v.file]));
}

export const nextTake = (files: readonly { name: string }[], shot: number) =>
  files.reduce((n, f) => { const p = parseShotFileName(f.name); return p && p.shot === shot ? Math.max(n, p.take) : n; }, 0) + 1;

/** Names of footage that is a shot take but not the current one (not copied into the edit). */
export function supersededShotFiles(names: readonly string[]): Set<string> {
  const current = new Set([...currentShotFiles(names.map(name => ({ name }))).values()].map(f => f.name));
  return new Set(names.filter(n => parseShotFileName(n) && !current.has(n)));
}

/** Per beat index (1-based) -> the file shot for it. */
export function shotFilesByBeat(names: readonly string[]): string[] {
  const out: string[] = [];
  for (const [shot, file] of currentShotFiles(names.map(name => ({ name })))) out[shot] = file.name;
  return out;
}
