"use server";

import { revalidatePath } from "next/cache";
import db from "@/lib/db";
import { buildGhlDisconnectData } from "@/lib/ghl/disconnect";
import { resolveIntegrationAdminContext } from "../admin-context";

export async function disconnectGhlIntegration(formData: FormData) {
    const { locationId } = await resolveIntegrationAdminContext();
    const mode = String(formData.get("mode") || "").trim();

    await db.location.update({
        where: { id: locationId },
        data: buildGhlDisconnectData(mode),
    });

    revalidatePath("/admin/settings/integrations/ghl");
    revalidatePath("/admin/settings/integrations");

    return { success: true };
}
