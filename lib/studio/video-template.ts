import "server-only";
import { Prisma } from "@prisma/client";
import { getStudioAccess } from "./access";
import { StudioCommandError } from "./command-error";
import { StudioDbError } from "./db";
import type { StudioTextRun } from "./idea-review";
import { SCRIPT_TEMPLATE_UUID, type ScriptTemplateDraft } from "./script-template-policy";
import { requireStudioTemplateWriter } from "./script-templates";
import { studioDb } from "./studio-db";
import { canonicalYoutubeVideo } from "./video-transcription-policy";
import type { readVideoTemplateCommand, VideoTemplateResult, VideoTemplateSnapshot } from "./video-template-policy";

export async function getVideoTemplateInput(locationId: string, sourceId: string) {
  const access = await getStudioAccess(locationId);
  if (!access || !SCRIPT_TEMPLATE_UUID.test(sourceId)) return null;
  const source = await studioDb.one<{ id: string; version: number; title: string; source_url: string | null }>(Prisma.sql`
    SELECT id,version,title,source_url FROM studio.studio_records WHERE location_id=${access.locationId}
      AND id=${sourceId}::uuid AND kind='reference' AND NOT archived`);
  return source && canonicalYoutubeVideo(source.source_url) ? source : null;
}

export async function getVideoTemplateCoverage(locationId: string, sourceId: string, version: number) {
  try {
    const snapshot = await studioDb.call<VideoTemplateSnapshot>("studio_build_video_template_snapshot", {
      p_location: locationId, p_source: sourceId, p_version: version,
    });
    return { coverage: snapshot.coverage, error: null };
  } catch (error) {
    if (error instanceof StudioDbError) {
      if (error.code === "P2013") return { coverage: null, error: "Save a timestamped transcript on this source first. Use the paired Mac transcription on the source page." };
      if (error.code === "P2010") return { coverage: null, error: "This saved evidence exceeds the extraction limit. Use a shorter video source." };
      if (error.code === "40001") return { coverage: null, error: "The video source changed. Reload to check its evidence." };
    }
    throw error;
  }
}

export async function enqueueVideoTemplate(locationId: string, command: ReturnType<typeof readVideoTemplateCommand>) {
  const access = await requireStudioTemplateWriter(locationId);
  const source = await getVideoTemplateInput(access.locationId, command.sourceId);
  if (!source) throw new StudioCommandError("Choose an active saved YouTube video.", 404);
  try {
    return await studioDb.call<{ reviewId: string }>("studio_enqueue_video_template", {
      p_location: access.locationId, p_app: access.app, p_actor: access.userId, p_command: command,
    });
  } catch (error) {
    if (error instanceof StudioDbError) {
      if (error.code === "P2013") throw new StudioCommandError("Save a current timestamped transcript before extracting a template.");
      if (error.code === "P2010") throw new StudioCommandError("This saved evidence exceeds the extraction limit. Use a shorter video source.");
      if (error.code === "P2015") throw new StudioCommandError("An extraction is already queued or running for this source. Reload and open the latest extraction.", 409);
      if (error.code === "P2014") throw new StudioCommandError("Your paired Mac must be ready with the updated companion, Text work, subscription sign-in and capacity.");
      if (error.code === "22023" && command.provider === "openai") throw new StudioCommandError("Check that the Location OpenAI API key is saved, then reload the source and try again.");
    }
    throw error;
  }
}

export async function getLatestVideoTemplateReview(locationId: string, sourceId: string) {
  const access = await getStudioAccess(locationId);
  if (!access || !SCRIPT_TEMPLATE_UUID.test(sourceId)) return null;
  return studioDb.one<{ id: string }>(Prisma.sql`
    SELECT id FROM studio.studio_idea_reviews WHERE location_id=${access.locationId} AND actor_app=${access.app}
      AND workflow='knowledge_extract' AND snapshot->>'mode'='script_template' AND snapshot#>>'{source,id}'=${sourceId}
    ORDER BY created_at DESC,id LIMIT 1`);
}

type Review = StudioTextRun<VideoTemplateResult, VideoTemplateSnapshot> & {
  status: string; last_error_message: string | null; template_id: string | null; stale: boolean;
};

export async function getVideoTemplateReview(locationId: string, reviewId: string) {
  const access = await getStudioAccess(locationId);
  if (!access || !SCRIPT_TEMPLATE_UUID.test(reviewId)) return null;
  return studioDb.one<Review>(Prisma.sql`
    SELECT r.id,r.job_id,r.model,r.prompt_version,r.snapshot,r.result,r.created_at,r.completed_at,r.stale_at_completion,
      j.status,j.last_error_message,t.template_id,
      CASE WHEN r.result IS NOT NULL AND t.id IS NULL THEN coalesce(r.stale_at_completion,true)
        OR NOT studio.studio_knowledge_snapshot_current(r.location_id,r.snapshot) ELSE false END AS stale
    FROM studio.studio_idea_reviews r
    JOIN studio.studio_jobs j ON j.location_id=r.location_id AND j.id=r.job_id
    LEFT JOIN studio.studio_script_template_versions t ON t.location_id=r.location_id AND t.source_review_id=r.id
    WHERE r.location_id=${access.locationId} AND r.actor_app=${access.app} AND r.id=${reviewId}::uuid
      AND r.workflow='knowledge_extract' AND r.snapshot->>'mode'='script_template'`);
}

export async function saveVideoTemplateDraft(locationId: string, reviewId: string, templateId: string, id: string, draft: ScriptTemplateDraft) {
  const access = await requireStudioTemplateWriter(locationId);
  return studioDb.call("studio_save_video_template_draft", {
    p_location: access.locationId, p_app: access.app, p_actor: access.userId, p_review: reviewId,
    p_template_id: templateId, p_id: id, p_name: draft.name, p_purpose: draft.purpose, p_beats: draft.beats,
  });
}
