/** Discarding unfinished uploads: the rules that do not need a database. SQL enforces who and which rows; this only checks input and shapes the answer. */
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function readDiscardTarget(uploadId: unknown): { ok: true; uploadId: string | null } | { ok: false; error: string } {
  if (uploadId === null || uploadId === undefined) return { ok: true, uploadId: null };
  if (typeof uploadId !== "string" || !uuid.test(uploadId)) return { ok: false, error: "Choose a valid upload to discard." };
  return { ok: true, uploadId: uploadId.toLowerCase() };
}

export interface DiscardResult { discarded: number; objects: { id: string; key: string }[] }
/** The SQL answer, trusted only for its shape. Object keys must be under this Location's own uploads prefix before anything is deleted from storage. */
export function readDiscardResult(raw: unknown, locationId: string): DiscardResult {
  const value = (raw ?? {}) as { discarded?: unknown; objects?: unknown };
  const objects = Array.isArray(value.objects) ? value.objects.flatMap((o: { id?: unknown; key?: unknown }) =>
    typeof o?.id === "string" && uuid.test(o.id) && typeof o?.key === "string" && o.key === `${locationId}/uploads/${o.id}/original` ? [{ id: o.id, key: o.key }] : []) : [];
  const discarded = typeof value.discarded === "number" && Number.isInteger(value.discarded) && value.discarded >= 0 ? value.discarded : objects.length;
  return { discarded, objects };
}

/** What the confirm step says before anything is removed. Names exactly what goes and what stays. */
export function discardConfirmText(names: readonly string[]): string {
  const shown = names.slice(0, 3).join(", ") + (names.length > 3 ? `, and ${names.length - 3} more` : "");
  return names.length === 1
    ? `Discard the unfinished upload ${shown}? Only this reservation is removed. Finished footage, narration and videos stay.`
    : `Discard ${names.length} unfinished uploads (${shown})? Only these reservations are removed. Finished footage, narration and videos stay.`;
}
