import { appendSourceNote } from "./source-assistant-policy";

export type SourceNoteResult = { ok: true } | { ok: false; error: string };
export interface SourceNoteDeps {
  hasAccess(locationId: string): Promise<boolean>;
  getSource(locationId: string, recordId: string): Promise<{ kind: string; title: string; version: number; archived: boolean; payload: Record<string, unknown> } | null>;
  save(locationId: string, recordId: string, draft: { kind: "reference"; title: string; payload: Record<string, string> }, version: number): Promise<unknown>;
  isConflict(error: unknown): boolean;
}
/** Scoped to one Location and one active source; appends a single dated entry and patches only `notes`. */
export async function saveSourceNote(deps: SourceNoteDeps, locationId: string, recordId: string, note: string, now = new Date()): Promise<SourceNoteResult> {
  if (!await deps.hasAccess(locationId)) return { ok: false, error: "You no longer have access to this Business." };
  const source = await deps.getSource(locationId, recordId);
  if (!source || source.kind !== "reference") return { ok: false, error: "This source is no longer available." };
  if (source.archived) return { ok: false, error: "Archived sources are read-only. Restore it in Edit source first." };
  const next = appendSourceNote(source.payload.notes, note, now);
  if (!next.ok) return next;
  try { await deps.save(locationId, recordId, { kind: "reference", title: source.title, payload: { title: source.title, notes: next.value } }, source.version); }
  catch (error) {
    if (deps.isConflict(error)) return { ok: false, error: "This source changed in another tab. Your note is still here; try saving again." };
    return { ok: false, error: "Studio could not save this note. Your words are still here; try again." };
  }
  return { ok: true };
}
