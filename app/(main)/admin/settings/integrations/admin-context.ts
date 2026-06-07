import { auth } from "@clerk/nextjs/server";
import { getLocationContext } from "@/lib/auth/location-context";
import { verifyUserIsLocationAdmin } from "@/lib/auth/permissions";

export async function resolveIntegrationAdminContext() {
    const { userId } = await auth();
    if (!userId) {
        throw new Error("Unauthorized");
    }

    const location = await getLocationContext();
    if (!location?.id) {
        throw new Error("No location found");
    }

    const isAdmin = await verifyUserIsLocationAdmin(userId, location.id);
    if (!isAdmin) {
        throw new Error("Unauthorized");
    }

    return {
        userId,
        locationId: location.id,
    };
}
