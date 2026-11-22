import "server-only";
import { resolveStudioTextCommand } from "./text-route";
import { auth } from "@clerk/nextjs/server";
import { Prisma } from "@prisma/client";
import { getStudioAccess, type StudioAccess } from "./access";
import { StudioCommandError } from "./command-error";
import { StudioDbError } from "./db";
import { requireOwnStudioCommandLocation } from "./paid-workspace";
import { studioDb } from "./studio-db";
import { replaceSelection, stageDraft, stageTextLimit, type CreationCommand, type CreationRecord, type CreationSource, type CreationStage, type CreationState, type LinkedDraft, type StageDraft } from "./creation-policy";
import { CREATION_PROMPT, readCreationTextResult, type CreationRun, type CreationRunInput, type CreationSnapshot } from "./creation-text-policy";

export type StoredRecord = { id: string; title: string; version: number; payload: Record<string, unknown>; script_template_version_id: string | null };
type StoredRun = { id: string; model: string; snapshot: CreationSnapshot; result: unknown; status: string; last_error_message: string | null; stale: boolean };
const missing = () => new StudioCommandError("Creation draft unavailable.", 404);

export function expose(record: StoredRecord): CreationRecord {
  const state = record.payload.creation as CreationState;
  const script = typeof record.payload.script === "string" ? record.payload.script : "";
  const savedScript = stageDraft(state, "Script");
  // The normal content form can also edit the canonical script.
  if (script !== savedScript.text) state.stages = { ...state.stages,
    Script: { ...savedScript, text: script, approved: false, previous: { text: savedScript.text, approved: savedScript.approved } } };
  return { id: record.id, version: record.version, templateId: record.script_template_version_id, state };
}

export async function loadRecord(access: StudioAccess, id: string) {
  return studioDb.one<StoredRecord>(Prisma.sql`
    SELECT id, title, version, payload, script_template_version_id FROM studio.studio_records
    WHERE location_id=${access.locationId} AND id=${id}::uuid AND kind='content' AND NOT archived AND payload#>>'{creation,schema}'='1'`);
}
export async function loadSource(access: StudioAccess, id: string): Promise<CreationSource | null> {
  const row = await studioDb.one<{ id: string; title: string; version: number; transcript: string; description: string }>(Prisma.sql`
    SELECT id,title,version,left(btrim(payload->>'transcript'),420) AS transcript,
      left(btrim(coalesce(payload->>'description',payload->>'sourceDescription')),240) AS description
    FROM studio.studio_records WHERE location_id=${access.locationId} AND id=${id}::uuid AND kind='reference' AND NOT archived`);
  return row && { id: row.id, title: row.title, version: row.version, concept: row.description || row.title,
    basis: row.transcript ? "Saved transcript available for drafting" : row.description ? "Saved description for reference" : "Saved source title" };
}
export async function getCreationPage(locationId: string, id?: string, sourceId?: string) {
  const [access, session] = await Promise.all([getStudioAccess(locationId), auth()]);
  if (!access || session.actor || session.userId !== access.userId) return null;
  const saved = id ? await loadRecord(access, id) : null;
  const record = saved && expose(saved);
  const original = record?.state.source;
  const linked = original && await studioDb.one<{ id: string }>(Prisma.sql`
    SELECT r.id FROM studio.studio_record_links l
    JOIN studio.studio_records r ON r.id=l.target_id AND r.location_id=l.location_id
    WHERE l.location_id=${access.locationId} AND l.source_id=${id}::uuid AND r.id=${original.id}::uuid
      AND r.kind='reference' AND NOT r.archived LIMIT 1`);
  const source = record ? linked ? original! : null : sourceId ? await loadSource(access, sourceId) : null;
  if ((id && !record) || (sourceId && source?.id !== sourceId)) return null;
  const runs = id ? await studioDb.rows<{ id: string; stage: string; kind: string; created_at: string }>(Prisma.sql`
    SELECT id,snapshot#>>'{operation,stage}' AS stage,snapshot#>>'{operation,kind}' AS kind,created_at
    FROM studio.studio_idea_reviews WHERE location_id=${access.locationId} AND actor_app=${access.app}
      AND created_by_clerk_user_id=${access.userId} AND workflow='script_brief' AND prompt_version=${CREATION_PROMPT}
      AND snapshot#>>'{ideas,0,id}'=${id}
    ORDER BY created_at DESC LIMIT 30`) : [];
  const linkedDrafts = id ? await studioDb.rows<LinkedDraft>(Prisma.sql`
    SELECT s.id,s.version,s.title FROM studio.studio_record_links l
    JOIN studio.studio_records s ON s.location_id=l.location_id AND s.id=l.target_id
    WHERE l.location_id=${access.locationId} AND l.source_id=${id}::uuid AND s.kind='content' AND NOT s.archived
      AND nullif(btrim(s.payload->>'script'),'') IS NOT NULL
    ORDER BY s.updated_at DESC,s.id LIMIT 30`) : [];
  return { record, source, publisher: access.locationName, runs, linkedDrafts };
}
async function loadRun(access: StudioAccess, reviewId: string) {
  return studioDb.one<StoredRun>(Prisma.sql`
    SELECT r.id,r.model,r.snapshot,r.result,j.status,j.last_error_message,
      (r.stale_at_completion IS TRUE OR c.id IS NULL OR c.archived OR c.version::text<>r.snapshot#>>'{ideas,0,version}'
        OR EXISTS(SELECT 1 FROM jsonb_array_elements(r.snapshot#>'{ideas,0,sources}') s
          WHERE NOT EXISTS(SELECT 1 FROM studio.studio_records source WHERE source.location_id=r.location_id
            AND source.id=(s->>'id')::uuid AND NOT source.archived AND source.version::text=s->>'version'))
        OR (r.snapshot#>>'{priorDraft,id}' IS NOT NULL AND NOT EXISTS(SELECT 1 FROM studio.studio_records d
          WHERE d.location_id=r.location_id AND d.id=(r.snapshot#>>'{priorDraft,id}')::uuid AND NOT d.archived
            AND d.version::text=r.snapshot#>>'{priorDraft,version}'))) AS stale
    FROM studio.studio_idea_reviews r JOIN studio.studio_jobs j ON j.location_id=r.location_id AND j.id=r.job_id
    LEFT JOIN studio.studio_records c ON c.location_id=r.location_id AND c.id=(r.snapshot#>>'{ideas,0,id}')::uuid
    WHERE r.id=${reviewId}::uuid AND r.location_id=${access.locationId} AND r.actor_app=${access.app}
      AND r.created_by_clerk_user_id=${access.userId} AND r.workflow='script_brief' AND r.prompt_version=${CREATION_PROMPT}`);
}
export async function getCreationRun(locationId: string, reviewId: string): Promise<CreationRun | null> {
  const access = await requireCreationWriter(locationId);
  const row = await loadRun(access, reviewId);
  if (!row) return null;
  const { snapshot } = row;
  const state = row.result ? "done" : ["failed", "dead", "cancelled"].includes(row.status) ? "failed" : row.status === "running" ? "running" : "queued";
  return { id: row.id, recordId: snapshot.ideas[0].id, version: snapshot.ideas[0].version, operation: snapshot.operation,
    state, snapshot, stale: row.stale, error: state === "failed" ? row.last_error_message ?? "Generation stopped." : null,
    result: row.result ? readCreationTextResult(row.result, snapshot) : null, model: row.model, evidence: snapshot.evidence,
    profileVersion: snapshot.profile?.version ?? null,
    template: snapshot.template ? `${snapshot.template.name} · version ${snapshot.template.version}` : null };
}

export async function requireCreationWriter(locationId: string) {
  const [access, session] = await Promise.all([requireOwnStudioCommandLocation(locationId), auth()]);
  if (session.actor || session.userId !== access.userId) throw new StudioCommandError("Use your own Location account.", 403);
  return access;
}

type SaveOptions = { template?: string | null; source?: CreationSource | null; reviewId?: string };
export async function save(access: StudioAccess, id: string, version: number, title: string, patch: Record<string, unknown>, options: SaveOptions = {}) {
  const record = await studioDb.call<StoredRecord>("studio_save_creation", {
    p_location: access.locationId, p_app: access.app, p_actor: access.userId, p_id: id, p_version: version,
    p_title: title, p_patch: patch, p_template_selected: options.template !== undefined, p_template_id: options.template ?? null,
    p_source_id: options.source?.id ?? null, p_source_version: options.source?.version ?? null, p_review_id: options.reviewId ?? null,
  });
  return { record: expose(record) };
}

/** Mirrors a stage change onto the canonical record fields (title, summary, script). */
export function applyStagePatch(row: StoredRecord, current: StageDraft, next: StageDraft, stage: CreationStage, patch: Record<string, unknown>) {
  let title = row.title;
  if (stage === "Title" && current.text !== next.text && next.text.trim()) title = next.text.trim().slice(0, 180);
  patch.title = title;
  if (stage === "Concept" && current.text !== next.text) patch.summary = next.text;
  if (stage === "Script" && current.text !== next.text) {
    patch.script = next.text;
    patch.approved = false;
    if (next.text.trim() && row.payload.stage === "idea") patch.stage = "script";
    if (!next.text.trim() && row.payload.stage === "script") patch.stage = "idea";
  }
  return { title };
}

export async function executeCreationCommand(locationId: string, command: CreationCommand) {
  const access = await requireCreationWriter(locationId);
  const { recordId, version } = command;
  if (command.action === "create") {
    const source = command.sourceId ? await loadSource(access, command.sourceId) : null;
    if (command.sourceId && (!source || source.version !== command.sourceVersion)) throw new StudioCommandError("The source changed. Reload before creating.", 409);
    const state: CreationState = { schema: 1, source, brief: command.brief, direction: command.direction, stages: {}, history: [] };
    const title = (command.brief.trim().split(/\r?\n/)[0] || source?.title || "Untitled video").slice(0, 180);
    return save(access, recordId, version, title, { creation: state, stage: "idea", title, approved: false }, { source, template: command.templateId });
  }
  const row = await loadRecord(access, recordId);
  if (!row) throw missing();
  if (row.version !== version) throw new StudioCommandError("This draft changed in another view. Reload before applying an edit.", 409);
  const { state } = expose(row);
  if (command.action === "generate") {
    const { kind, stage, feedback, includeReferences, linkedDraft } = command;
    const context = { includeReferences, linkedDraft };
    let operation: CreationRunInput;
    if (kind === "rewrite") {
      const text = stageDraft(state, stage).text;
      replaceSelection(text, command.selection, command.selection.text);
      const { start, end } = command.selection;
      operation = { ...context, kind, stage, feedback, selection: command.selection, instruction: command.instruction,
        before: text.slice(Math.max(0, start - 280), start), after: text.slice(end, end + 280) };
    } else operation = { ...context, kind, stage, feedback };
    try {
      return await studioDb.call<{ reviewId: string }>("studio_enqueue_routed_text_run", {
        p_location_id: access.locationId, p_actor_app: access.app, p_clerk_user_id: access.userId, p_workflow: "script_brief",
        p_command: await resolveStudioTextCommand(access, "script_brief", { requestId: command.requestId, provider: command.provider,
          confirmPaid: command.confirmPaid, confirmSubscription: command.confirmSubscription, focus: "",
          ideas: [{ id: recordId, version, creation: operation }] }),
      });
    } catch (error) {
      if (error instanceof StudioDbError && error.code === "SC001") throw new StudioCommandError("Update your paired Mac companion and check Text work, sign-in and capacity.");
      throw error;
    }
  }
  const patch: Record<string, unknown> = { creation: state };
  const change = (note: string, detail: Omit<CreationState["history"][number], "at" | "note"> = {}) => {
    state.history = [{ note, ...detail, at: new Date().toISOString() }, ...state.history].slice(0, 40);
  };
  if (command.action === "direction") {
    const fields = (["publisher", "viewer", "goal", "angle"] as const).filter(key => state.direction[key] !== command.direction[key]);
    const changes = [...fields.map(field => field === "viewer" ? "target viewer" : field), ...(state.brief !== command.brief ? ["supplied brief"] : [])];
    state.brief = command.brief;
    state.direction = command.direction;
    if (changes.includes("angle") && state.stages.Angle?.approved) {
      state.stages.Angle = { ...state.stages.Angle, approved: false };
    }
    change(changes.length ? `Confirmed changes to ${changes.join(", ")}. ${command.direction.rationale}` : command.direction.rationale);
    return save(access, recordId, version, row.title, patch);
  }
  if (command.action === "template") {
    change(command.templateId ? "Pinned an approved template version." : "Removed the template pin.");
    return save(access, recordId, version, row.title, patch, { template: command.templateId });
  }
  const stage = command.stage;
  const current = stageDraft(state, stage);
  let next: StageDraft = { ...current };
  let reviewId: string | undefined;
  let note: string;
  let quote: string | undefined;
  function update(text: string, approved: boolean) {
    if (text === current.text && approved === current.approved) return;
    if (text.length > stageTextLimit(stage)) throw new StudioCommandError(`Shorten this stage to ${stageTextLimit(stage)} characters before saving.`);
    next = { ...current, text, approved, previous: { text: current.text, approved: current.approved } };
  }
  if (command.action === "save" || command.action === "use") {
    update(command.text, command.action === "use");
    note = command.action === "use" ? "Approved for use." : "Saved a direct edit.";
  } else if (command.action === "shortlist") {
    if (current.shortlist.length >= 8 && !current.shortlist.includes(command.text)) throw new StudioCommandError("This stage already has eight shortlisted options.");
    next.shortlist = [...new Set([...current.shortlist, command.text])];
    note = "Shortlisted an option.";
  } else if (command.action === "replace") {
    update(replaceSelection(current.text, command.selection, command.text), false);
    note = "Replaced selected words as supplied.";
    quote = command.selection.text;
  } else if (command.action === "comment") {
    if (command.selection) replaceSelection(current.text, command.selection, command.selection.text);
    change(command.text, { stage, quote: command.selection?.text });
    return save(access, recordId, version, row.title, patch);
  } else if (command.action === "clear") {
    if (!current.text.trim()) throw new StudioCommandError(`This ${stage} is already empty.`, 409);
    // Kept as the stage's previous value, so the existing Undo restores it; the canonical script field is emptied with it.
    next = { text: "", approved: false, shortlist: current.shortlist, previous: { text: current.text, approved: current.approved } };
    note = `Removed the saved ${stage}. Undo restores it.`;
  } else if (command.action === "undo") {
    if (!current.previous) throw new StudioCommandError("No stage edit to undo.");
    next = { text: current.previous.text, approved: current.previous.approved, shortlist: current.shortlist };
    note = "Undid the last edit to this stage.";
  } else {
    const run = await loadRun(access, command.reviewId);
    const input = run?.snapshot.ideas[0];
    if (!run?.result || run.stale || input?.id !== recordId || input.version !== version || run.snapshot.operation.stage !== stage)
      throw new StudioCommandError("This proposal is stale or unavailable. Keep the draft and request a fresh proposal.", 409);
    const result = readCreationTextResult(run.result, run.snapshot);
    const operation = run.snapshot.operation;
    const suggestion = command.candidate === null ? null : result.options[command.candidate];
    if (operation.kind === "suggest" && !suggestion || operation.kind !== "suggest" && command.candidate !== null)
      throw new StudioCommandError("Choose a proposal to apply.");
    if (operation.kind === "rewrite") {
      update(replaceSelection(current.text, operation.selection, result.text!), false);
      quote = operation.selection.text;
    } else update(suggestion?.text ?? result.text!, true);
    reviewId = run.id;
    note = suggestion?.rationale ?? result.rationale;
  }
  state.stages = { ...state.stages, [stage]: next };
  change(note, { stage, reviewId, quote });
  const { title } = applyStagePatch(row, current, next, stage, patch);
  return save(access, recordId, version, title, patch, { reviewId });
}
