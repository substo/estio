import { appendSourceNote, SOURCE_NOTES_LIMIT } from "./source-assistant-policy";

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

/** The user reviewed a proposed change and applied it: replaces My notes with exactly that text. Version-fenced; patches only `notes`. */
export async function replaceSourceNotes(deps: SourceNoteDeps, locationId: string, recordId: string, text: string, expectedVersion: number): Promise<SourceNoteResult> {
  if (!await deps.hasAccess(locationId)) return { ok: false, error: "You no longer have access to this Business." };
  const source = await deps.getSource(locationId, recordId);
  if (!source || source.kind !== "reference") return { ok: false, error: "This source is no longer available." };
  if (source.archived) return { ok: false, error: "Archived sources are read-only." };
  if (source.version !== expectedVersion) return { ok: false, error: "My notes changed in another tab. Reload to see the latest, then apply again." };
  const value = text.replace(/\s+$/, "");
  if (value.length > SOURCE_NOTES_LIMIT) return { ok: false, error: "My notes are too long for this source. Shorten them and apply again." };
  try { await deps.save(locationId, recordId, { kind: "reference", title: source.title, payload: { title: source.title, notes: value } }, source.version); }
  catch (error) {
    if (deps.isConflict(error)) return { ok: false, error: "My notes changed in another tab. Reload to see the latest, then apply again." };
    return { ok: false, error: "Studio could not save your notes. Your edit is still here; try again." };
  }
  return { ok: true };
}
