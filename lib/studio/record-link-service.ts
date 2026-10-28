import { Prisma } from "@prisma/client";
import type { StudioDb } from "./db";
import { recordLinkId, validRecordLinkChange, type RecordLinkKind } from "./record-link-policy";
export interface RecordLinkSummary { id: string; title: string; kind: "reference" | "channel" | "content"; archived: boolean; }
export interface RecordLinkChange { sourceId: string; targetId: string; version: number; changed: boolean; }

export function createRecordLinkService<Access extends { locationId: string; app: "estio" | "substo"; userId: string }>(dependencies: {
  authorize: (locationId: string) => Promise<Access | null>;
  isImpersonating: () => Promise<boolean>;
  db: StudioDb;
}) {
  const { authorize, isImpersonating, db } = dependencies;
  return {
    async list(locationId: string, sourceId: string, pages: { links: number; candidates: number }, kind: RecordLinkKind) {
      if (!recordLinkId(sourceId) || !Object.values(pages).every(p => Number.isSafeInteger(p) && p >= 0 && p <= 99_999)) return null;
      const access = await authorize(locationId);
      if (!access) return null;
      const location = access.locationId;
      const records = await db.rows<RecordLinkSummary & { version: number }>(Prisma.sql`
        select id, title, kind, archived, version from studio.studio_records
        where location_id = ${location} and id = ${sourceId}::uuid limit 1`);
      if (!records[0]) return null;
      const [links, candidates] = await Promise.all([
        db.rows<{ target_id: string }>(Prisma.sql`select target_id from studio.studio_record_links
          where location_id = ${location} and source_id = ${sourceId}::uuid
          order by target_id asc limit 21 offset ${pages.links * 20}`),
        db.rows<RecordLinkSummary>(Prisma.sql`select id, title, kind, archived from studio.studio_records
          where location_id = ${location} and id <> ${sourceId}::uuid
          ${kind === "all" ? Prisma.empty : Prisma.sql`and kind = ${kind}`}
          order by title asc, id asc limit 21 offset ${pages.candidates * 20}`),
      ]);
      const visibleLinks = links.slice(0, 20); const visibleCandidates = candidates.slice(0, 20);
      const [labels, candidateLinks] = await Promise.all([
        visibleLinks.length ? db.rows<RecordLinkSummary>(Prisma.sql`select id, title, kind, archived from studio.studio_records
          where location_id = ${location} and id in (${Prisma.join(visibleLinks.map(l => Prisma.sql`${l.target_id}::uuid`))}) limit 20`) : Promise.resolve([]),
        visibleCandidates.length ? db.rows<{ target_id: string }>(Prisma.sql`select target_id from studio.studio_record_links
          where location_id = ${location} and source_id = ${sourceId}::uuid
          and target_id in (${Prisma.join(visibleCandidates.map(c => Prisma.sql`${c.id}::uuid`))}) limit 20`) : Promise.resolve([]),
      ]);
      const labelsById = new Map(labels.map(label => [label.id, label]));
      const linkedCandidates = new Set(candidateLinks.map(link => link.target_id));
      const currentLinks = visibleLinks.map(link => {
        const label = labelsById.get(link.target_id);
        if (!label) throw new Error("Studio returned incomplete link labels. Reload the record.");
        return label;
      });
      return { access, record: records[0], links: currentLinks,
        candidates: visibleCandidates.map(c => ({ ...c, linked: linkedCandidates.has(c.id) })), hasMoreLinks: links.length > 20, hasMoreCandidates: candidates.length > 20 };
    },
    async change(locationId: string, sourceId: string, targetId: string, version: number, action: string) {
      const access = await authorize(locationId);
      if (!access || await isImpersonating()) throw new Error("Use your own authorized Location account to change links.");
      if (!validRecordLinkChange(sourceId, targetId, version, action)) throw new Error("Invalid record link request.");
      const result = await db.call<RecordLinkChange>("studio_change_record_link", {
        p_location_id: access.locationId, p_source_id: sourceId, p_target_id: targetId, p_action: action,
        p_expected_version: version, p_actor_app: access.app, p_clerk_user_id: access.userId,
      });
      if (!result || result.sourceId !== sourceId.toLowerCase() || result.targetId !== targetId.toLowerCase()
        || typeof result.changed !== "boolean" || !Number.isSafeInteger(result.version)
        || result.version !== version + (result.changed ? 1 : 0)) throw new Error("Studio did not confirm the link change. Reload before retrying.");
      return result;
    },
  };
}
