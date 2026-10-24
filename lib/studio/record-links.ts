import "server-only";
import { auth } from "@clerk/nextjs/server";
import { getStudioWorkspaceAccess } from "./access";
import { studioRest } from "./rest";
import { createRecordLinkService } from "./record-link-service";
const service = createRecordLinkService({ authorize: getStudioWorkspaceAccess, request: studioRest,
  isImpersonating: async () => Boolean((await auth()).actor) });
export const listStudioRecordLinks = service.list;
export const changeStudioRecordLink = service.change;
