import { Prisma } from "@prisma/client";
import type { StudioDb } from "./db";
import { DEFAULT_RELEVANCE_THRESHOLDS, type RelevanceContext } from "./video-transcription-policy";

/** Worker-safe (no server-only imports): discovery runs in the hosted Studio worker. */
export type ProfileLoader = (locationId: string) => Promise<Record<string, string>>;
/** The Business profile summary the Mac may use for relevance. Failure only drops the profile hint; it never blocks discovery. */
export const loadBusinessProfileHint: ProfileLoader = async locationId => {
  try {
    const { getBusinessProfile } = await import("../business-profile/service");
    const p = (await getBusinessProfile(locationId)).profile as unknown as Record<string, Record<string, unknown> | undefined> | null;
    const known = (fact: unknown) => fact && typeof fact === "object" && (fact as { status?: string }).status === "known" ? String((fact as { value?: unknown }).value ?? "") : "";
    const entries: Array<[string, string]> = [["summary", known(p?.identity?.summary)], ["tagline", known(p?.identity?.tagline)], ["offer", known(p?.offer?.description)], ["audience", known(p?.audienceMarket?.audience)]];
    return Object.fromEntries(entries.filter(([, v]) => v).map(([k, v]) => [k, v.slice(0, 300)]));
  } catch { return {}; }
};

/** Bounded, untrusted context for the Mac's relevance judgement: approved Library source titles, approved ("pinned") knowledge statements and a profile summary. No secrets, contacts or media. */
export async function buildRelevanceContext(db: StudioDb, locationId: string, loadProfile: ProfileLoader = loadBusinessProfileHint): Promise<RelevanceContext> {
  const [titles, pinned, profile] = await Promise.all([
    db.rows<{ title: string }>(Prisma.sql`select title from studio.studio_records where location_id=${locationId} and kind='reference' and approved and not archived order by updated_at desc limit 30`),
    db.rows<{ statement: string }>(Prisma.sql`select statement from studio.studio_knowledge_insights where location_id=${locationId} and status='approved' order by id limit 20`),
    loadProfile(locationId),
  ]);
  return { approvedTitles: titles.map(t => t.title.slice(0, 120)), pinnedKnowledge: pinned.map(i => i.statement.slice(0, 200)), profile };
}

export interface VideoDiscoveryFence { location: string; run: string; job: string; worker: string; lease: string }
/** After a discovery result is saved: approved-channel videos get gated Mac jobs, other sources become suggestions only. Idempotent per run. */
export async function enqueueDiscoveredVideos(db: StudioDb, fence: VideoDiscoveryFence, loadProfile?: ProfileLoader) {
  const context = await buildRelevanceContext(db, fence.location, loadProfile);
  return db.call<{ videos: Array<{ recordId: string; videoId: string; status: string }> }>("studio_enqueue_discovered_video_transcriptions", {
    p_location: fence.location, p_run: fence.run, p_job: fence.job, p_worker: fence.worker, p_lease: fence.lease,
    p_context: { thresholds: DEFAULT_RELEVANCE_THRESHOLDS, context } });
}
