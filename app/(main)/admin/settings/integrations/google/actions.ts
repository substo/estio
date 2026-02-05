"use server";

import { auth } from "@clerk/nextjs/server";
import db from "@/lib/db";
import { revalidatePath } from "next/cache";

export async function updateGoogleSyncDirection(direction: string) {
    const { userId: clerkUserId } = await auth();
    if (!clerkUserId) throw new Error("Unauthorized");

    // Validate direction value
    if (!["ESTIO_TO_GOOGLE", "GOOGLE_TO_ESTIO"].includes(direction)) {
        throw new Error("Invalid sync direction");
    }

    await db.user.update({
        where: { clerkId: clerkUserId },
        data: { googleSyncDirection: direction }
    });

    revalidatePath("/admin/settings/integrations/google");
    return { success: true };
}
