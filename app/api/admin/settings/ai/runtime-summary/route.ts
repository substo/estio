import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { verifyUserIsLocationAdmin } from "@/lib/auth/permissions";
import { loadAiRuntimeSummary } from "@/lib/ai/settings/runtime-summary";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
    const { userId } = await auth();
    if (!userId) {
        return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    }

    const locationId = String(request.nextUrl.searchParams.get("locationId") || "").trim();
    if (!locationId) {
        return NextResponse.json({ success: false, error: "Missing location ID." }, { status: 400 });
    }

    const isAdmin = await verifyUserIsLocationAdmin(userId, locationId);
    if (!isAdmin) {
        return NextResponse.json({ success: false, error: "Unauthorized: Admin access is required." }, { status: 403 });
    }

    const summary = await loadAiRuntimeSummary(locationId);
    return NextResponse.json({ success: true, summary });
}
