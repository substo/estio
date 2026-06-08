import { NextRequest, NextResponse } from "next/server";
import {
    getContactProfileVerificationQueueStatus,
    triggerGlobalContactProfileRecertification,
} from "@/lib/ai/contact-profile-verification/cron";
import { authorizeContactClassificationRequest } from "../_shared";

export async function GET(request: NextRequest) {
    const locationId = String(request.nextUrl.searchParams.get("locationId") || "").trim();
    const authorization = await authorizeContactClassificationRequest(locationId);
    if (!authorization.ok) return authorization.response;

    try {
        const status = await getContactProfileVerificationQueueStatus({ locationId: authorization.locationId });
        return NextResponse.json({ success: true, status });
    } catch (error: unknown) {
        console.error("[contact-classification:queue-status] Error:", error);
        return NextResponse.json(
            { success: false, error: error instanceof Error ? error.message : "Could not load contact classification status." },
            { status: 500 },
        );
    }
}

export async function POST(request: NextRequest) {
    const body = await request.json().catch(() => ({}));
    const locationId = String(body?.locationId || "").trim();
    const authorization = await authorizeContactClassificationRequest(locationId);
    if (!authorization.ok) return authorization.response;

    try {
        const result = await triggerGlobalContactProfileRecertification({ locationId: authorization.locationId });
        const status = await getContactProfileVerificationQueueStatus({ locationId: authorization.locationId });
        console.info("[contact-classification:queue-all] Queued contacts", {
            locationId: authorization.locationId,
            due: result.due,
            queued: status.queued,
        });
        return NextResponse.json({ ...result, status });
    } catch (error: unknown) {
        console.error("[contact-classification:queue-all] Error:", error);
        return NextResponse.json(
            { success: false, error: error instanceof Error ? error.message : "Could not queue contacts for classification." },
            { status: 500 },
        );
    }
}
