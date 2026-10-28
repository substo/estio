import "server-only";
import { auth } from "@clerk/nextjs/server";
import { getStudioAccess } from "./access";
import { studioDb } from "./studio-db";
import { createRecordLinkService } from "./record-link-service";
const service = createRecordLinkService({ authorize: getStudioAccess, db: studioDb,
  isImpersonating: async () => Boolean((await auth()).actor) });
export const listStudioRecordLinks = service.list;
export const changeStudioRecordLink = service.change;
