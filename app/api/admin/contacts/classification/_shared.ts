import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { getStudioAccess } from "@/lib/studio/access";

export async function authorizeContactClassificationRequest(locationId: string) {
    const { userId, actor } = await auth();
    if (!userId) {
        return { ok: false as const, response: NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 }) };
    }

    if (!locationId) {
        return { ok: false as const, response: NextResponse.json({ success: false, error: "Missing location ID." }, { status: 400 }) };
    }

    const access = await getStudioAccess(locationId);
    if (access?.app !== "estio" || access.role !== "ADMIN" || actor) {
        return { ok: false as const, response: NextResponse.json({ success: false, error: "Unauthorized: Admin access is required." }, { status: 403 }) };
    }

    return { ok: true as const, locationId, userId };
}
