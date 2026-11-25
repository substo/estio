import "server-only";
import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import type { StudioAccess } from "./access";
import { StudioCommandError } from "./command-error";
import { StudioDbError } from "./db";
import { resolveStudioTextCommand } from "./text-route";
import { studioDb } from "./studio-db";
import { applyStagePatch, expose, hasCreationState, loadRecord, loadSource, requireCreationWriter, save, type StoredRecord } from "./creation";
import { stageDraft, stageTextLimit, type CreationStage, type CreationState } from "./creation-policy";
import { AGENT_MAX_ROUNDS, AGENT_PROMPT, isAgentSnapshot, readAgentResult, type AgentApplyCommand, type AgentFinal, type AgentSelection, type AgentResearch, type AgentItem, type AgentObservation, type AgentProposal, type AgentSnapshot, type AgentToolCall, type readAgentSendCommand } from "./agent-policy";
import { runAgentTool } from "./agent-tools";
import { SPEAKING_WPM, formatClock, lengthFit, parseDurationRequest, scriptStats, aimWords, type LengthFit } from "./script-length";
import { agentRoundRequestId } from "./agent-request";

type TurnRow = { id: string; location_id: string; record_id: string; seq: number; message: string; provider: string; status: "running" | "done" | "failed";
  rounds: Array<{ round: number; reviewId: string; tool: AgentToolCall | null; observation: AgentObservation | null }>; result: AgentFinal | null; error: string | null; created_by_clerk_user_id: string; created_at: string; target_seconds: number | null; selection: AgentSelection | null; evidence_choice: AgentItem[] | null };
export type AgentTurnView = {
  id: string; seq: number; message: string; provider: "location_order" | "subscription" | "openai"; status: "running" | "done" | "failed"; error: string | null;
  /** Real activity only: what the assistant actually read, in order. */
  activity: string[]; waiting: "queued" | "running" | null; route: string | null;
  /** Approximate runtime the owner asked for as of this message, in seconds. */
  target: number | null;
  /** The saved text span this message was about (Expand / Tighten / Rewrite). */
  selection: AgentSelection | null;
  result: (Omit<AgentFinal, "proposals"> & { proposals: Array<AgentProposal & { length?: { spokenWords: number; cueWords: number; estimatedSeconds: number; targetSeconds: number | null; fit: LengthFit | null }; evidence: Array<{ id: string; label: string; quote: string; sourceId: string | null; at: number | null }> }> }) | null;
  inputs: { reads: Array<{ tool: string; items: string[] }>; checks: string[]; context: string[] };
};

const q = (value: string) => `“${value.length > 60 ? value.slice(0, 57) + "…" : value}”`;
export function describeAgentStep(tool: AgentToolCall, observation: AgentObservation | null) {
  const n = observation?.items.filter(item => item.cite).length ?? 0;
  if (observation?.error) return `Could not ${tool.name.replace("_", " ")}: ${observation.error}`;
  switch (tool.name) {
    case "search_source": return `Searched the saved source${tool.query ? ` for ${q(tool.query)}` : ""} · ${n} passage${n === 1 ? "" : "s"}`;
    case "read_source": return `Read a saved passage${tool.offset ? ` at character ${tool.offset}` : ""}`;
    case "list_findings": return `Checked approved findings${tool.query ? ` for ${q(tool.query)}` : ""} · ${n} found`;
    case "read_stage": return `Read the current ${tool.stage ?? "stage"}`;
    case "search_library": return `Searched saved sources by title${tool.query ? ` for ${q(tool.query)}` : ""}`;
    case "load_skill": return `Loaded the ${(tool.skill ?? "").replaceAll("_", " ")} procedure`;
    case "search_knowledge": return `Searched approved Knowledge across the Library${tool.query ? ` for ${q(tool.query)}` : ""} · ${n} finding${n === 1 ? "" : "s"}`;
  }
}

async function loadTurn(access: StudioAccess, id: string) {
  return studioDb.one<TurnRow>(Prisma.sql`
    SELECT id,location_id,record_id,seq,message,provider,status,rounds,result,error,created_by_clerk_user_id,created_at,target_seconds,selection,evidence_choice
    FROM studio.studio_agent_turns WHERE id=${id}::uuid AND location_id=${access.locationId} AND created_by_clerk_user_id=${access.userId} AND actor_app=${access.app}`);
}

function measure(text: string, target: number | null) {
  const stats = scriptStats(text);
  return { spokenWords: stats.spokenWords, cueWords: stats.cueWords, estimatedSeconds: stats.seconds, targetSeconds: target, fit: target ? lengthFit(target, stats.seconds) : null };
}

async function views(access: StudioAccess, turns: TurnRow[], pending: Map<string, { waiting: "queued" | "running" | null }> = new Map()): Promise<AgentTurnView[]> {
  const reviewIds = turns.flatMap(t => t.rounds.map(r => r.reviewId));
  const models = reviewIds.length ? await studioDb.rows<{ id: string; execution_provider: string; model: string }>(Prisma.sql`
    SELECT id::text,execution_provider,model FROM studio.studio_idea_reviews WHERE location_id=${access.locationId} AND id=ANY(${reviewIds}::uuid[])`) : [];
  const model = new Map(models.map(m => [m.id, m]));
  return turns.map(turn => {
    const chosen = turn.evidence_choice ?? null;
    const items = new Map<string, AgentItem>((chosen ?? []).map(item => [item.id, item]));
    for (const round of turn.rounds) for (const item of round.observation?.items ?? []) items.set(item.id, item);
    const last = turn.rounds.at(-1);
    const run = last ? model.get(last.reviewId) : undefined;
    return { id: turn.id, seq: turn.seq, message: turn.message, provider: turn.provider as AgentTurnView["provider"], status: turn.status, error: turn.error,
      activity: turn.rounds.filter(r => r.tool || r.observation?.summary).map(r => r.tool ? describeAgentStep(r.tool, r.observation) : r.observation!.summary!),
      target: turn.target_seconds, selection: turn.selection ?? null,
      waiting: turn.status === "running" ? pending.get(turn.id)?.waiting ?? "queued" : null,
      route: run ? `${run.execution_provider === "subscription" ? "Your Mac subscription" : "Location OpenAI key (paid)"} · ${run.model.replace(/^mac_/, "")}` : null,
      result: turn.result && { ...turn.result, plan: turn.result.plan ?? [], proposals: turn.result.proposals.map(p => ({ ...p, ...(p.stage === "Script" && !p.replaces ? { length: measure(p.text, turn.target_seconds) } : {}),
        evidence: p.evidenceIds.flatMap(id => { const item = items.get(id); return item ? [{ id, label: item.label, quote: item.text, sourceId: item.sourceId ?? null, at: item.at ?? null }] : []; }) })) },
      inputs: { reads: [
        ...(chosen === null ? [] : [{ tool: chosen.length ? "Selected source evidence" : "No source evidence", items: chosen.map(item => item.label) }]),
        ...turn.rounds.filter(r => r.tool).map(r => ({ tool: describeAgentStep(r.tool!, r.observation), items: (r.observation?.items ?? []).map(i => i.label) })),
      ],
        // Length checks and kept-original outcomes are separate from reads: they say what the server measured, not what the model looked at.
        checks: turn.rounds.filter(r => !r.tool && r.observation?.summary).map(r => r.observation!.summary!),
        context: ["Your message", "The current draft stages", "Business profile as voice context, not as the publisher",
          ...(chosen === null ? ["Earlier choices and the last six exchanges", "Linked source list (text only through reads)"] : [])] } };
  });
}

export async function getAgentEvidenceChoices(locationId: string, recordId: string | null, sourceId: string | null) {
  const access = await requireCreationWriter(locationId);
  if (recordId && !await loadRecord(access, recordId, true)) throw new StudioCommandError("Creation draft unavailable.", 404);
  return studioDb.rows<{ id: string; statement: string; quote: string; title: string; source_id: string }>(Prisma.sql`
    SELECT id,statement,quote,title,source_id
    FROM studio.studio_agent_evidence_options(${access.locationId},${recordId}::uuid,${sourceId}::uuid,NULL::uuid[])`);
}

/** Everything the page needs to reopen a draft's conversation. Read-only; the poll route advances running turns. */
export async function getAgentConversation(locationId: string, recordId: string) {
  const access = await requireCreationWriter(locationId);
  const rows = await studioDb.rows<TurnRow>(Prisma.sql`
    SELECT id,location_id,record_id,seq,message,provider,status,rounds,result,error,created_by_clerk_user_id,created_at,target_seconds,selection,evidence_choice FROM (
      SELECT * FROM studio.studio_agent_turns WHERE location_id=${access.locationId} AND record_id=${recordId}::uuid
        AND actor_app=${access.app} AND created_by_clerk_user_id=${access.userId} ORDER BY seq DESC LIMIT 40) t ORDER BY seq`);
  const turns = await views(access, rows);
  const plan = [...turns].reverse().find(t => t.result)?.result?.plan ?? [];
  return { turns, plan, target: turns.at(-1)?.target ?? null };
}

async function enqueueRound(access: StudioAccess, turn: TurnRow, round: number) {
  const requestId = agentRoundRequestId(turn.id, round);
  const existing = await studioDb.one<{ id: string }>(Prisma.sql`SELECT id FROM studio.studio_idea_reviews WHERE location_id=${access.locationId} AND request_id=${requestId}::uuid`);
  if (existing) return;
  const record = await loadRecord(access, turn.record_id);
  if (!record) throw new StudioCommandError("Creation draft unavailable.", 404);
  const provider = turn.provider as "location_order" | "subscription" | "openai";
  try {
    await studioDb.call("studio_enqueue_routed_text_run", {
      p_location_id: access.locationId, p_actor_app: access.app, p_clerk_user_id: access.userId, p_workflow: "script_brief",
      p_command: await resolveStudioTextCommand(access, "script_brief", { requestId, provider, confirmPaid: provider === "openai", confirmSubscription: provider === "subscription",
        confirmRoute: provider === "location_order", focus: "", ideas: [{ id: record.id, version: record.version, agent: { turnId: turn.id, round } }] }),
    });
  } catch (error) {
    if (error instanceof StudioDbError && (error.code === "SC001" || error.code === "P2017")) throw new StudioCommandError("Update your paired Mac companion and check Text work, sign-in and capacity.");
    throw error;
  }
}

const failTurn = (access: StudioAccess, turnId: string, message: string) => studioDb.call<TurnRow>("studio_agent_fail_turn",
  { p_location: access.locationId, p_app: access.app, p_actor: access.userId, p_turn: turnId, p_error: message });

export async function sendAgentMessage(locationId: string, command: ReturnType<typeof readAgentSendCommand>) {
  const access = await requireCreationWriter(locationId);
  let row = command.version === 0 ? null : await loadRecord(access, command.recordId, true);
  if (command.version > 0 && !row) throw new StudioCommandError("Creation draft unavailable.", 404);
  if (!row) {
    // A new draft needs no form: no brief, direction or goal. It starts empty and linked to the source, if any.
    const source = command.sourceId ? await loadSource(access, command.sourceId) : null;
    if (command.sourceId && (!source || source.version !== command.sourceVersion)) throw new StudioCommandError("The source changed. Reload before creating.", 409);
    const state: CreationState = { schema: 1, source, brief: "", direction: { choice: "conversation", publisher: "", viewer: "", goal: "", angle: "", rationale: "" }, stages: {}, history: [] };
    const title = (source?.title ?? "Untitled video").slice(0, 180);
    await save(access, command.recordId, 0, title, { creation: state, stage: "idea", title, approved: false }, { source });
    row = await loadRecord(access, command.recordId);
    if (!row) throw new StudioCommandError("Creation draft unavailable.", 404);
  }
  if (command.selection) {
    // A selection edit is fenced twice: the span must still hold exactly the selected words, and the account's Mac (or hosted route) must run contract 4.
    const sel = command.selection;
    if (stageDraft(expose(row).state, sel.stage).text.slice(sel.start, sel.end) !== sel.text) throw new StudioCommandError("That text changed. Select the words again.", 409);
    const contract = await studioDb.call<number | null>("studio_agent_contract", { p_location: access.locationId, p_app: access.app, p_actor: access.userId });
    if (contract !== 4) throw new StudioCommandError("Update and restart the Studio companion on your Mac to edit a selection from here.");
  }
  if (!hasCreationState(row)) {
    try {
      row = await studioDb.call<StoredRecord>("studio_save_record", {
        p_location_id: access.locationId, p_record_id: row.id, p_kind: "content", p_title: row.title,
        p_payload_patch: { creation: expose(row).state }, p_expected_version: row.version, p_clerk_user_id: access.userId,
      });
    } catch (error) {
      if (error instanceof StudioDbError && error.code === "40001") throw new StudioCommandError("This piece changed. Reload before continuing.", 409);
      throw error;
    }
  }
  // The duration comes from the owner's own words, read here; -1 keeps the previous target, 0 clears it.
  const request = parseDurationRequest(command.message);
  const target = request?.kind === "set" ? request.seconds : request?.kind === "clear" ? 0 : -1;
  let begun: { turnId: string; seq: number };
  try {
    begun = await studioDb.call("studio_agent_begin_evidence_turn", { p_location: access.locationId, p_app: access.app, p_actor: access.userId,
      p_record: row.id, p_turn: command.turnId, p_message: command.message, p_provider: command.provider, p_target: target, p_selection: command.selection, p_evidence: command.evidenceIds });
  } catch (error) {
    if (error instanceof StudioDbError && error.code === "P2018") throw new StudioCommandError("Some selected passages changed or are no longer available. Refresh the evidence choices and try again.", 409);
    if (error instanceof StudioDbError && error.code === "23505") throw new StudioCommandError("That message was already sent with different inputs. Refresh the conversation before retrying.", 409);
    if (error instanceof StudioDbError && error.code === "P2015") throw new StudioCommandError("The assistant is still answering your last message.", 409);
    throw error;
  }
  const turn = await loadTurn(access, begun.turnId);
  if (!turn) throw new StudioCommandError("Message unavailable.", 404);
  if (turn.status === "running" && turn.rounds.length === 0) {
    try { await enqueueRound(access, turn, 1); }
    catch (error) {
      // Admission refused before any model call: close the turn so the owner can fix the route and resend.
      await failTurn(access, turn.id, error instanceof StudioCommandError ? error.message : "The assistant could not start. Nothing was sent to a model.");
      throw error;
    }
  }
  return { recordId: row.id, turnId: turn.id, version: row.version };
}

/** Read-only status of one turn. Never reads sources, queues a model call or changes state. */
export async function readAgentTurn(locationId: string, turnId: string): Promise<AgentTurnView | null> {
  const access = await requireCreationWriter(locationId);
  const turn = await loadTurn(access, turnId);
  return turn ? (await views(access, [turn]))[0] : null;
}

/** Drive one running turn forward by at most one step. Safe to call repeatedly and concurrently. */
async function advanceStep(locationId: string, turnId: string): Promise<AgentTurnView | null> {
  const access = await requireCreationWriter(locationId);
  const turn = await loadTurn(access, turnId);
  if (!turn) return null;
  const done = async (row: TurnRow, waiting: "queued" | "running" | null = null) => (await views(access, [row], new Map([[row.id, { waiting }]])))[0];
  if (turn.status !== "running") return done(turn);
  const round = turn.rounds.length + 1;
  const review = await studioDb.one<{ id: string; result: unknown; snapshot: unknown; status: string; error: string | null; prompt_version: string }>(Prisma.sql`
    SELECT r.id::text,r.prompt_version,r.result,r.snapshot,j.status,j.last_error_message AS error FROM studio.studio_idea_reviews r
    JOIN studio.studio_jobs j ON j.location_id=r.location_id AND j.id=r.job_id
    WHERE r.location_id=${access.locationId} AND r.request_id=${agentRoundRequestId(turn.id, round)}::uuid AND r.created_by_clerk_user_id=${access.userId}`);
  const fail = async (message: string) => done(await failTurn(access, turn.id, message));
  // At most one length correction per message. If it was sent, the earlier valid reply is kept as the fallback.
  const revision = turn.rounds.find(r => r.observation?.lengthRevision);
  const keepOriginal = async (summary: string, atRound: number, reviewId: string) => {
    try { return await done(await studioDb.call<TurnRow>("studio_agent_keep_original", { p_location: access.locationId, p_app: access.app, p_actor: access.userId,
      p_turn: turn.id, p_round: atRound, p_review: reviewId, p_summary: summary })); }
    catch { return fail("The corrected version could not be completed. Nothing was changed; send your message again."); }
  };
  if (!review) {
    try { await enqueueRound(access, turn, round); } catch (error) {
      if (revision) return keepOriginal("Asked once for a closer length, but the correction could not be started; kept the first version", round, revision.reviewId);
      return fail(error instanceof StudioCommandError ? error.message : "The next step could not be queued. Nothing was changed; send your message again.");
    }
    return done(turn, "queued");
  }
  if (review.result === null) {
    if (["failed", "cancelled", "dead"].includes(review.status)) {
      if (revision) return keepOriginal("Asked once for a closer length, but the correction did not complete; kept the first version", round, revision.reviewId);
      return fail(review.error?.trim().slice(0, 280) || "The model run stopped before answering. Nothing was changed. Send your message again if you still want it.");
    }
    return done(turn, review.status === "running" ? "running" : "queued");
  }
  if (!isAgentSnapshot(review.snapshot)) return revision ? keepOriginal("The correction could not be read; kept the first version", round, revision.reviewId) : fail("The assistant result could not be read. Nothing was changed.");
  let step;
  try { step = readAgentResult(review.result, review.snapshot as AgentSnapshot, review.prompt_version); }
  catch { return revision ? keepOriginal("The correction could not be read; kept the first version", round, revision.reviewId) : fail("The assistant returned an unreadable result. Nothing was changed."); }
  const gap = (text: string | undefined) => text && turn.target_seconds ? Math.abs(scriptStats(text).seconds / turn.target_seconds - 1) : null;
  let observation: AgentObservation | null = null;
  if (step.step === "reply" && revision) {
    // The correction is accepted only when its Script is closer to the request than the first version; otherwise the first is kept.
    const originalRun = await studioDb.one<{ result: unknown; snapshot: unknown; prompt_version: string }>(Prisma.sql`
      SELECT result,snapshot,prompt_version FROM studio.studio_idea_reviews WHERE id=${revision.reviewId}::uuid AND location_id=${access.locationId}`);
    let before: number | null = null;
    try {
      const first = originalRun && isAgentSnapshot(originalRun.snapshot) ? readAgentResult(originalRun.result, originalRun.snapshot as AgentSnapshot, originalRun.prompt_version) : null;
      before = first && first.step === "reply" ? gap(first.proposals.find(p => p.stage === "Script")?.text) : null;
    } catch { before = null; }
    const after = gap(step.proposals.find(p => p.stage === "Script")?.text);
    if (before !== null && (after === null || after >= before)) return keepOriginal("Asked once for a closer length; the new version was no closer, so the first version is kept", round, revision.reviewId);
  }
  if (step.step === "reply" && turn.target_seconds && round <= 3 && !revision && !turn.selection && !step.proposals.some(p => p.replaces)) {
    // One bounded correction: a Script outside the +/-15% range is measured and sent back once, never shown as a pass. Up to round 3, so the
    // corrected reply still has a round of its own (the last round must reply).
    const script = step.proposals.find(p => p.stage === "Script");
    const stats = script && scriptStats(script.text), fit = stats && lengthFit(turn.target_seconds, stats.seconds);
    if (script && stats && fit && fit.state !== "match" && !fit.beyondSupported) {
      const range = aimWords(turn.target_seconds);
      observation = { items: [], untrusted: true, lengthRevision: true,
        summary: `Checked the script length: about ${formatClock(stats.seconds)} against ${formatClock(turn.target_seconds)} requested. Asked for a ${fit.state === "short" ? "fuller" : "tighter"} version`,
        note: `Length check by the server: your Script has ${stats.spokenWords} spoken words (about ${formatClock(stats.seconds)}) but the owner asked for about ${formatClock(turn.target_seconds)} (${range.min}-${range.max} spoken words at ${SPEAKING_WPM} words per minute). Return the Script again with ${range.min}-${range.max} spoken words. ${fit.state === "short" ? "Add substance from the draft, the decisions and the evidence, not filler." : "Tighten without cutting the promise or the payoff."} Bracketed cues are not counted.` };
    }
  }
  if (step.step === "tool") {
    const record = await loadRecord(access, turn.record_id);
    if (!record) return fail("This draft is no longer available.");
    const state = expose(record).state;
    const repeat = turn.rounds.some(r => r.tool && JSON.stringify(r.tool) === JSON.stringify(step.tool));
    observation = step.tool.name === "search_knowledge" && review.prompt_version !== AGENT_PROMPT ? { items: [], error: "That tool is not available in this conversation.", untrusted: true } : repeat ? { items: [], error: "Already read in this message.", untrusted: true }
      : turn.evidence_choice != null && ["search_source", "read_source", "list_findings", "search_library", "search_knowledge"].includes(step.tool.name)
        ? { items: [], error: "The owner restricted source evidence for this message. Use the passages already supplied, if any.", untrusted: true }
      : await runAgentTool(access, turn.record_id, step.tool, stage => stageDraft(state, stage as CreationStage).text).catch(() => ({ items: [], error: "That read failed. Continue without it.", untrusted: true as const }));
  }
  const recorded = await studioDb.call<TurnRow>("studio_agent_record_step", { p_location: access.locationId, p_app: access.app, p_actor: access.userId,
    p_turn: turn.id, p_round: round, p_review: review.id, p_observation: observation });
  if (recorded.status === "running" && recorded.rounds.length < AGENT_MAX_ROUNDS) {
    try { await enqueueRound(access, recorded, recorded.rounds.length + 1); } catch (error) {
      // A correction that cannot be queued (for example the snapshot would exceed its bound) must not lose the valid first reply.
      if (observation?.lengthRevision) return keepOriginal("Asked once for a closer length, but the correction could not be started; kept the first version", recorded.rounds.length + 1, review.id);
      return fail(error instanceof StudioCommandError ? error.message : "The next step could not be queued. Nothing was changed; send your message again.");
    }
  }
  return done(recorded, recorded.status === "running" ? "queued" : null);
}

/** Explicit owner action: write one proposed stage text, fenced to the draft version and the stage text they saw. */
export async function applyAgentProposal(locationId: string, command: AgentApplyCommand) {
  const access = await requireCreationWriter(locationId);
  const row = await loadRecord(access, command.recordId);
  if (!row) throw new StudioCommandError("Creation draft unavailable.", 404);
  if (row.version !== command.version) throw new StudioCommandError("This draft changed in another view. Reload before using a proposal.", 409);
  const turn = await loadTurn(access, command.turnId);
  const proposal = turn?.record_id === row.id && turn.status === "done" ? turn.result?.proposals[command.index] : undefined;
  if (!turn || !proposal) throw new StudioCommandError("That proposal is unavailable.", 404);
  const { state } = expose(row);
  const current = stageDraft(state, proposal.stage);
  if (current.text !== command.baseText) throw new StudioCommandError(`The ${proposal.stage} changed since this proposal. Ask for a fresh one.`, 409);
  const selection = turn.selection;
  let text = proposal.text;
  if (selection) {
    // A message about a selection can only be answered by a patch of exactly that span; never by a whole stage.
    if (!proposal.replaces || selection.stage !== proposal.stage) throw new StudioCommandError("That proposal does not replace your selection. Ask again.", 409);
    // The span is located by its saved offsets (so repeated phrases are unambiguous) and must still hold exactly the words that were selected.
    if (current.text.slice(selection.start, selection.end) !== selection.text) throw new StudioCommandError("The selected text changed. Select it again and ask for a fresh edit.", 409);
    const lead = /^\s*/.exec(selection.text)![0], trail = /\s*$/.exec(selection.text)![0];
    text = current.text.slice(0, selection.start) + lead + proposal.text + trail + current.text.slice(selection.end);
    if (text.length > stageTextLimit(proposal.stage)) throw new StudioCommandError(`This edit would make the ${proposal.stage} longer than its limit. Ask for a tighter version.`);
  }
  if (proposal.stage === "Script" && turn.rounds[0]) {
    const basis = await studioDb.one<{ version: string | null }>(Prisma.sql`
      SELECT snapshot#>>'{ideas,0,version}' AS version FROM studio.studio_idea_reviews
      WHERE location_id=${access.locationId} AND id=${turn.rounds[0].reviewId}::uuid`);
    if (basis?.version && basis.version !== String(row.version)) {
      throw new StudioCommandError("This piece changed after that script was requested. Ask for a fresh proposal.", 409);
    }
  }
  // The request that produced this text travels with it, so a later ask never relabels a saved script. Only Script carries a runtime;
  // a patch keeps the label of the script it edits (the measured length is always shown beside it).
  const requested = proposal.stage === "Script" && turn.target_seconds ? turn.target_seconds : undefined;
  const { targetSeconds: _drop, ...rest } = current;
  const carried = selection ? current.targetSeconds : requested;
  const next = { ...rest, text, approved: true, ...(carried ? { targetSeconds: carried } : {}),
    previous: { text: current.text, approved: current.approved, ...(current.targetSeconds ? { targetSeconds: current.targetSeconds } : {}) } };
  state.stages = { ...state.stages, [proposal.stage]: next };
  state.history = [{ stage: proposal.stage, note: `${selection ? `Edited a selection (${selection.action})` : "Used a proposal from the conversation"}: ${proposal.rationale}`.slice(0, 400), at: new Date().toISOString() }, ...state.history].slice(0, 40);
  const patch: Record<string, unknown> = { creation: state };
  const { title } = applyStagePatch(row as StoredRecord, current, next, proposal.stage, patch);
  return save(access, row.id, row.version, title, patch);
}

/** Advance one step and return the turn with the draft's current saved state (so Use/undo fences stay current). */
export async function advanceAgentTurn(locationId: string, turnId: string) {
  const turn = await advanceStep(locationId, turnId);
  if (!turn) return null;
  const access = await requireCreationWriter(locationId);
  const stored = await loadTurn(access, turnId);
  const row = stored && await loadRecord(access, stored.record_id);
  return { turn, record: row ? expose(row) : null };
}

/** The most recent draft this source started with the assistant, offered inline as Resume. Create itself always starts fresh. */
export async function latestSourceDraft(locationId: string, sourceId: string) {
  const access = await requireCreationWriter(locationId);
  const row = await studioDb.one<{ id: string; title: string; updated_at: string; turns: number }>(Prisma.sql`
    SELECT c.id,left(c.title,120) AS title,c.updated_at,
      (SELECT count(*)::int FROM studio.studio_agent_turns t WHERE t.location_id=c.location_id AND t.record_id=c.id
        AND t.actor_app=${access.app} AND t.created_by_clerk_user_id=${access.userId} AND t.status='done') AS turns
    FROM studio.studio_records c JOIN studio.studio_record_links l ON l.location_id=c.location_id AND l.source_id=c.id
    WHERE c.location_id=${access.locationId} AND c.kind='content' AND NOT c.archived AND c.payload#>>'{creation,schema}'='1'
      AND l.target_id=${sourceId}::uuid
    -- Prefer a draft with real work (a saved stage or script, or a completed exchange of this account); a draft that only has failed
    -- or empty attempts is offered only when nothing better exists. The other drafts stay reachable from the source's Script tab.
    ORDER BY (EXISTS(SELECT 1 FROM studio.studio_agent_turns t WHERE t.location_id=c.location_id AND t.record_id=c.id
        AND t.actor_app=${access.app} AND t.created_by_clerk_user_id=${access.userId} AND t.status='done')
      OR EXISTS(SELECT 1 FROM jsonb_each(coalesce(c.payload#>'{creation,stages}','{}'::jsonb)) st WHERE nullif(btrim(st.value->>'text'),'') IS NOT NULL)
      OR nullif(btrim(c.payload->>'script'),'') IS NOT NULL) DESC,
      c.updated_at DESC,c.id LIMIT 1`);
  return row ? { id: row.id, title: row.title, turns: row.turns, updatedAt: new Date(row.updated_at).toISOString() } : null;
}

/** Opaque per-account, per-Location key for remembering a route choice in this browser. */
export async function agentRouteScope(locationId: string) {
  const access = await requireCreationWriter(locationId);
  return createHash("sha256").update(`${access.app}:${access.userId}:${access.locationId}`).digest("hex").slice(0, 16);
}
