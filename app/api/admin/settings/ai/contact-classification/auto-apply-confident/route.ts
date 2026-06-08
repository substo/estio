import { NextRequest, NextResponse } from "next/server";
import { autoApplyConfidentContactVerificationProposals } from "@/lib/ai/contact-verification/service";
import { getContactProfileVerificationQueueStatus } from "@/lib/ai/contact-profile-verification/cron";
import { authorizeContactClassificationRequest } from "../_shared";

export const dynamic = "force-dynamic";
export const maxDuration = 180;

export async function POST(request: NextRequest) {
    const body = await request.json().catch(() => ({}));
    const locationId = String(body?.locationId || "").trim();
    const authorization = await authorizeContactClassificationRequest(locationId);
    if (!authorization.ok) return authorization.response;

    try {
        const result = await autoApplyConfidentContactVerificationProposals({
            locationId: authorization.locationId,
            actorUserId: authorization.userId,
            limit: Number(body?.limit || 100),
        });
        const status = await getContactProfileVerificationQueueStatus({ locationId: authorization.locationId });
        console.info("[contact-classification:auto-apply-confident] Applied pending decisions", {
            locationId: authorization.locationId,
            checked: result.checked,
            applied: result.applied,
            skipped: result.skipped,
            failures: result.failures,
            remainingBatchAvailable: result.remainingBatchAvailable,
            pendingReview: status.pendingReview,
        });
        return NextResponse.json({ ...result, status });
    } catch (error: unknown) {
        console.error("[contact-classification:auto-apply-confident] Error:", error);
        return NextResponse.json(
            { success: false, error: error instanceof Error ? error.message : "Could not apply confident contact classifications." },
            { status: 500 },
        );
    }
}
