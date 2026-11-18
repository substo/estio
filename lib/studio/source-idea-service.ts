import { Prisma } from "@prisma/client";
import type { StudioDb } from "./db";
import { createRecordLinkService } from "./record-link-service";
import { recordLinkId } from "./record-link-policy";

type Access = { locationId: string; app: "estio" | "substo"; userId: string };

/** Compose existing record CRUD and audited linking in the caller's transaction. */
export function createSourceIdeaService(deps: {
  authorize: (locationId: string) => Promise<Access | null>;
  isImpersonating: () => Promise<boolean>;
  transaction: <T>(run: (db: StudioDb) => Promise<T>) => Promise<T>;
}) {
  return async (locationId: string, sourceId: string, ideaId: string, title: string, summary: string) => {
    const access = await deps.authorize(locationId);
    if (!access || await deps.isImpersonating()) throw new Error("Use your own authorized account to create an idea.");
    title = title.trim(); summary = summary.trim();
    if (!recordLinkId(sourceId) || !recordLinkId(ideaId) || sourceId.toLowerCase() === ideaId.toLowerCase()
      || !title || title.length > 180 || !summary || summary.length > 20_000) throw new Error("Enter an idea title and concept.");
    sourceId = sourceId.toLowerCase(); ideaId = ideaId.toLowerCase();
    return deps.transaction(async db => {
      const source = await db.one<{ id: string }>(Prisma.sql`
        select id from studio.studio_records where location_id=${access.locationId}
        and id=${sourceId}::uuid and kind='reference' and archived=false for share`);
      if (!source) throw new Error("Choose an active library source in this Location.");
      const idea = await db.call<{ version: number }>("studio_save_record", {
        p_location_id: access.locationId, p_record_id: ideaId, p_kind: "content", p_title: title,
        p_payload_patch: { title, summary, stage: "idea", level: "discover", approved: false, archived: false },
        p_expected_version: 0, p_clerk_user_id: access.userId,
      });
      const links = createRecordLinkService({ authorize: async () => access, isImpersonating: deps.isImpersonating, db });
      await links.change(access.locationId, ideaId, sourceId, Number(idea.version), "add");
      return ideaId;
    });
  };
}
