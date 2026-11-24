export type AssetGroup = "footage" | "narration" | "exports";
export interface AssetUpload { id: string; name: string; contentType: string; byteSize: number; createdAt: string; status: string; note?: string | null }
export interface PendingUpload { id: string; name: string; byteSize: number }
export interface Asset { id: string; name: string; kind: "video" | "audio" | "other"; provenance: string; size: string; note: string | null }
export interface NarrationRun { stamp: string; ids: string[]; count: number; provenance: string }
export interface AssetGroups { footage: Asset[]; narration: NarrationRun[]; exports: Asset[]; attention: { id: string; name: string; why: string }[] }

const narrationName = /^Narration (\d{4}-\d{2}-\d{2} \d{4}) (\d+)\.mp3$/i;
export const classifyUpload = (name: string): AssetGroup => /^Edited video /i.test(name) ? "exports" : narrationName.test(name) || /^Narration /i.test(name) ? "narration" : "footage";
export const mediaKind = (contentType: string): Asset["kind"] => contentType.startsWith("video/") ? "video" : contentType.startsWith("audio/") ? "audio" : "other";
export const formatBytes = (n: number) => n >= 1e9 ? `${(n / 1e9).toFixed(1)} GB` : n >= 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1e3))} KB`;
const when = (iso: string) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? "" : d.toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }); };

/** Footage you uploaded, narration the app generated (grouped per generation), exports it made. Unfinished uploads are never in the lists: they wait under "attention". */
export function groupAssets(uploads: AssetUpload[], pending: PendingUpload[]): AssetGroups {
  const out: AssetGroups = { footage: [], narration: [], exports: [], attention: [] };
  const runs = new Map<string, NarrationRun>();
  for (const u of uploads) {
    if (u.status !== "uploaded") { out.attention.push({ id: u.id, name: u.name, why: "Upload did not finish" }); continue; }
    const group = classifyUpload(u.name), kind = mediaKind(u.contentType);
    if (group === "narration") {
      const stamp = narrationName.exec(u.name)?.[1] ?? u.createdAt;
      const run = runs.get(stamp) ?? { stamp, ids: [], count: 0, provenance: `Generated narration · ${when(u.createdAt)}` };
      run.ids.push(u.id); run.count++; runs.set(stamp, run);
    } else if (group === "exports") out.exports.push({ id: u.id, name: u.name, kind, provenance: `Made from your script · ${when(u.createdAt)}`, size: formatBytes(u.byteSize), note: null });
    else out.footage.push({ id: u.id, name: u.name, kind, provenance: `You uploaded · ${when(u.createdAt)}`, size: formatBytes(u.byteSize), note: u.note ?? null });
  }
  out.narration = [...runs.values()].sort((a, b) => b.stamp.localeCompare(a.stamp));
  const seen = new Set(out.attention.map(a => a.id));
  for (const p of pending) if (!seen.has(p.id)) out.attention.push({ id: p.id, name: p.name, why: classifyUpload(p.name) === "exports" ? "A made video did not finish saving" : "Upload not finished" });
  return out;
}
