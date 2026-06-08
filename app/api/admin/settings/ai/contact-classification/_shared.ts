import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { verifyUserIsLocationAdmin } from "@/lib/auth/permissions";

export async function authorizeContactClassificationRequest(locationId: string) {
    const { userId } = await auth();
    if (!userId) {
        return { ok: false as const, response: NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 }) };
    }

    if (!locationId) {
        return { ok: false as const, response: NextResponse.json({ success: false, error: "Missing location ID." }, { status: 400 }) };
    }

    const isAdmin = await verifyUserIsLocationAdmin(userId, locationId);
    if (!isAdmin) {
        return { ok: false as const, response: NextResponse.json({ success: false, error: "Unauthorized: Admin access is required." }, { status: 403 }) };
    }

    return { ok: true as const, locationId, userId };
}
