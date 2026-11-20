import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { getStudioAccess } from "@/lib/studio/access";
import { loadAiRuntimeSummary } from "@/lib/ai/settings/runtime-summary";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
    const { userId, actor } = await auth();
    if (!userId) {
        return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    }

    const locationId = String(request.nextUrl.searchParams.get("locationId") || "").trim();
    if (!locationId) {
        return NextResponse.json({ success: false, error: "Missing location ID." }, { status: 400 });
    }

    const access = await getStudioAccess(locationId);
    if (access?.app !== "estio" || access.role !== "ADMIN" || actor) {
        return NextResponse.json({ success: false, error: "Unauthorized: Admin access is required." }, { status: 403 });
    }

    const summary = await loadAiRuntimeSummary(locationId);
    return NextResponse.json({ success: true, summary });
}
