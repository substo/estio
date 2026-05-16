"use server";

import { auth } from "@clerk/nextjs/server";
import { revalidatePath } from "next/cache";
import db from "@/lib/db";
import { getLocationContext } from "@/lib/auth/location-context";
import { verifyUserIsLocationAdmin } from "@/lib/auth/permissions";
import { buildGhlDisconnectData } from "@/lib/ghl/disconnect";

async function resolveGhlAdminContext() {
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

    return { userId, locationId: location.id };
}

export async function disconnectGhlIntegration(formData: FormData) {
    const { locationId } = await resolveGhlAdminContext();
    const mode = String(formData.get("mode") || "").trim();

    await db.location.update({
        where: { id: locationId },
        data: buildGhlDisconnectData(mode),
    });

    revalidatePath("/admin/settings/integrations/ghl");
    revalidatePath("/admin/settings/integrations");

    return { success: true };
}
