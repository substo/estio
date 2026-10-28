import { Prisma } from "@prisma/client";
import { studioDb } from "@/lib/studio/studio-db";
import "server-only";
import { getPlatformProfile } from "../platform/profile";
import { getStudioAccess } from "./access";
import { canReviewTranscription, ReconciliationError, type ReconciliationCommand } from "./transcription-reconciliation-policy";

async function requireManager(locationId: string) {
  const [profile, access] = await Promise.all([getPlatformProfile(), getStudioAccess(locationId)]);
  if (!profile || !access || !canReviewTranscription(profile, access)) {
    throw new ReconciliationError("Only a workspace AI manager, signed in as themselves, can review paid attempts.", 403);
  }
  return access;
}

export async function reviewStudioTranscription(locationId: string, command: ReconciliationCommand) {
  const access = await requireManager(locationId);
  return studioDb.call("studio_review_ai_attempt", {
    p_location_id: access.locationId, p_actor_app: access.app, p_clerk_user_id: access.userId,
    p_attempt_id: command.attemptId, p_request_id: command.requestId, p_expected_version: command.expectedVersion,
    p_action: command.action, p_evidence: command.evidence, p_cost_micros: command.costMicros, p_confirm_paid: command.confirmPaid });
}

export interface ReviewedTranscriptionAttempt {
  id: string; job_id: string; operation: string; idea_review_id: string | null; upload_id: string | null; chunk_index: number | null; duration_seconds: number | null; status: string;
  review_version: number; billing_outcome: "no_charge" | "billed" | null; replacement_authorized: boolean;
  created_at: string; usage_id: string;
}
export interface TranscriptionReviewEvent {
  id: string; attempt_id: string; actor_clerk_user_id: string; action: string; evidence: string;
  cost_micros: number | null; created_at: string; version: number;
}

export async function listStudioTranscriptionReviews(locationId: string, page: number) {
  let access;
  try { access = await requireManager(locationId); }
  catch (error) { if (error instanceof ReconciliationError) return null; throw error; }
  const workspace = access.locationId;
  const rows = await studioDb.rows<ReviewedTranscriptionAttempt>(Prisma.sql`select id,job_id,operation,idea_review_id,upload_id,chunk_index,duration_seconds,status,review_version,billing_outcome,replacement_authorized,created_at,usage_id from studio.studio_ai_attempts t where location_id = ${workspace} and status in ('started','uncertain') order by created_at desc,id asc limit 26 offset ${page * 25}`);
  const attempts = rows.slice(0, 25);
  if (!attempts.length) return { attempts, events: [], usage: [], hasMore: false };
  const [events, usage] = await Promise.all([
    studioDb.rows<TranscriptionReviewEvent>(Prisma.sql`select id,attempt_id,actor_clerk_user_id,action,evidence,cost_micros,created_at,version from studio.studio_ai_attempt_reviews t where location_id = ${workspace} and attempt_id = any(string_to_array(${attempts.map(a => a.id).join(",")}, ',')::uuid[]) order by created_at asc,id asc limit 100`),
    studioDb.rows<{ id: string; status: string; reserved_micros: number; cost_micros: number | null; usage_month: string }>(Prisma.sql`select id,status,reserved_micros,cost_micros,usage_month from studio.studio_ai_usage t where location_id = ${workspace} and id = any(string_to_array(${attempts.map(a => a.usage_id).join(",")}, ',')::uuid[]) limit 25`),
  ]);
  return { attempts, events, usage, hasMore: rows.length > 25 };
}
