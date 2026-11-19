import "server-only";
import { Prisma } from "@prisma/client";
import { getStudioAccess } from "./access";
import { StudioCommandError } from "./command-error";
import { StudioDbError } from "./db";
import { requireOwnStudioCommandLocation } from "./paid-workspace";
import { studioDb } from "./studio-db";
import type { readSourceAssistCommand, SourceAssistResult, SourceAssistSnapshot } from "./source-assist-policy";

export async function enqueueSourceAssist(locationId: string, command: ReturnType<typeof readSourceAssistCommand>) {
  const access = await requireOwnStudioCommandLocation(locationId);
  try {
    return await studioDb.call<{ reviewId: string; jobId: string }>("studio_enqueue_source_assist", {
      p_location: access.locationId, p_app: access.app, p_actor: access.userId, p_command: command });
  } catch (error) {
    if (error instanceof StudioDbError) {
      if (error.code === "P2013") throw new StudioCommandError("Save a transcript or description on this source first.");
      if (error.code === "P2010") throw new StudioCommandError("This saved evidence exceeds the assistant limit. Use a shorter source.");
      if (error.code === "P2015") throw new StudioCommandError("The assistant is already working on this source. Wait for its answer.", 409);
      if (error.code === "P2016") throw new StudioCommandError("Your paired Mac must be ready with the updated companion, Text work, a subscription sign-in and capacity.");
      if (error.code === "22023" && command.provider === "openai") throw new StudioCommandError("Check that the Location OpenAI API key is saved, then try again.");
      if (error.code === "22023") throw new StudioCommandError("Your paired Mac must be ready with Text work and a subscription provider applied in Setup.");
    }
    throw error;
  }
}

export interface SourceAssistRun {
  id: string; status: "queued" | "running" | "done" | "failed"; error: string | null; provider: string; model: string; intent: string; message: string;
  stale: boolean; result: SourceAssistResult | null; sourceId: string;
  evidence: { selected: number; total: number; kind: "transcript" | "description" }; citedAt: Record<string, number | null>;
}
/** Only the requesting account's own run in the active Location/app is readable. */
export async function getSourceAssistRun(locationId: string, reviewId: string): Promise<SourceAssistRun | null> {
  const access = await getStudioAccess(locationId);
  if (!access || !/^[0-9a-f-]{36}$/i.test(reviewId)) return null;
  const row = await studioDb.one<{ id: string; model: string; snapshot: SourceAssistSnapshot; result: SourceAssistResult | null; stale_at_completion: boolean | null;
    status: string; last_error_message: string | null; execution_provider: string; current: boolean }>(Prisma.sql`
    SELECT r.id,r.model,r.snapshot,r.result,r.stale_at_completion,j.status,j.last_error_message,r.execution_provider,
      studio.studio_knowledge_snapshot_current(r.location_id,r.snapshot) AS current
    FROM studio.studio_idea_reviews r JOIN studio.studio_jobs j ON j.location_id=r.location_id AND j.id=r.job_id
    WHERE r.location_id=${access.locationId} AND r.actor_app=${access.app} AND r.created_by_clerk_user_id=${access.userId}
      AND r.id=${reviewId}::uuid AND r.workflow='knowledge_extract' AND r.snapshot->>'mode'='source_assist'`);
  if (!row) return null;
  const done = row.result !== null;
  const status = done ? "done" : row.status === "failed" || row.status === "cancelled" || row.status === "dead" ? "failed" : row.status === "running" ? "running" : "queued";
  return { id: row.id, status, error: status === "failed" ? row.last_error_message ?? "The assistant could not complete. Start a new request." : null,
    provider: row.execution_provider, model: row.model, intent: row.snapshot.inputId, message: row.snapshot.focus, sourceId: row.snapshot.source.id,
    stale: done ? row.stale_at_completion === true || !row.current : false, result: row.result,
    evidence: { selected: row.snapshot.coverage.selectedUnits, total: row.snapshot.coverage.totalUnits, kind: row.snapshot.units[0]?.id.startsWith("description") ? "description" : "transcript" },
    citedAt: Object.fromEntries((row.result?.citations ?? []).map(c => [c.unitId, row.snapshot.units.find(u => u.id === c.unitId)?.startSeconds ?? null])) };
}
