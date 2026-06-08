import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { verifyUserIsLocationAdmin } from "@/lib/auth/permissions";
import { triggerGlobalContactProfileRecertification } from "@/lib/ai/contact-profile-verification/cron";

export async function POST(request: NextRequest) {
    const { userId } = await auth();
    if (!userId) {
        return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    const locationId = String(body?.locationId || "").trim();
    if (!locationId) {
        return NextResponse.json({ success: false, error: "Missing location ID." }, { status: 400 });
    }

    const isAdmin = await verifyUserIsLocationAdmin(userId, locationId);
    if (!isAdmin) {
        return NextResponse.json({ success: false, error: "Unauthorized: Admin access is required." }, { status: 403 });
    }

    try {
        const result = await triggerGlobalContactProfileRecertification({ locationId });
        return NextResponse.json(result);
    } catch (error: unknown) {
        console.error("[contact-classification:queue-all] Error:", error);
        return NextResponse.json(
            { success: false, error: error instanceof Error ? error.message : "Could not queue contacts for classification." },
            { status: 500 },
        );
    }
}
