import { auth } from "@clerk/nextjs/server";
import { getLocationContext } from "@/lib/auth/location-context";
import { verifyUserIsLocationAdmin } from "@/lib/auth/permissions";
import { verifyUserHasAccessToLocation } from "@/lib/auth/permissions";
import { canManageLocationAiIntegrations } from "@/lib/ai/integration-access-policy";

export async function resolveIntegrationMemberContext() {
    const { userId } = await auth();
    if (!userId) throw new Error("Unauthorized");
    const location = await getLocationContext();
    if (!location?.id || !await verifyUserHasAccessToLocation(userId, location.id)) throw new Error("Unauthorized");
    return { userId, locationId: location.id };
}

export async function resolveIntegrationAdminContext() {
    const { userId, locationId } = await resolveIntegrationMemberContext();
    const isAdmin = await verifyUserIsLocationAdmin(userId, locationId);
    if (!canManageLocationAiIntegrations({ isActiveLocationMember: true, isActiveLocationAdmin: isAdmin })) {
        throw new Error("Unauthorized");
    }

    return {
        userId,
        locationId,
    };
}
