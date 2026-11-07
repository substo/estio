import { getPlatformAdminContext } from "@/lib/auth/platform-access";
import { sameOrigin } from "@/lib/build/contract";
import { handleLegacyCredentialsApply } from "@/lib/platform/legacy-credentials-http";
import { runLegacyCredentialsMove } from "@/lib/settings/legacy-credentials-move-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Platform admin only (not while impersonating), same-origin POST. Runs on the server that holds the KMS keys.
export function POST(request: Request) {
    return handleLegacyCredentialsApply(request, { getActor: getPlatformAdminContext, sameOrigin, run: runLegacyCredentialsMove });
}
