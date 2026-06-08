import { NextRequest, NextResponse } from "next/server";
import { autoApplyConfidentContactVerificationProposals } from "@/lib/ai/contact-verification/service";
import {
    getContactProfileVerificationQueueStatus,
    triggerGlobalContactProfileRecertification,
} from "@/lib/ai/contact-profile-verification/cron";
import { normalizeContactProfileVerificationBatchSize } from "@/lib/ai/contact-profile-verification/config";
import { authorizeContactClassificationRequest } from "../_shared";

export const dynamic = "force-dynamic";
export const maxDuration = 180;

export async function POST(request: NextRequest) {
    const body = await request.json().catch(() => ({}));
    const locationId = String(body?.locationId || "").trim();
    const authorization = await authorizeContactClassificationRequest(locationId);
    if (!authorization.ok) return authorization.response;

    const batchSize = normalizeContactProfileVerificationBatchSize(body?.batchSize);

    try {
        const firstAutoApply = await autoApplyConfidentContactVerificationProposals({
            locationId: authorization.locationId,
            actorUserId: null,
            limit: 200,
        });
        const queued = await triggerGlobalContactProfileRecertification({ locationId: authorization.locationId });
        const status = await getContactProfileVerificationQueueStatus({ locationId: authorization.locationId });

        console.info("[contact-classification:verify-now] Started contact verification", {
            locationId: authorization.locationId,
            queued: queued.due,
            applied: Number(firstAutoApply.applied || 0),
            remainingQueued: status.queued,
            pendingReview: status.pendingReview,
        });

        return NextResponse.json({
            success: true,
            batchSize,
            queued,
            firstAutoApply,
            status,
        });
    } catch (error: unknown) {
        console.error("[contact-classification:verify-now] Error:", error);
        return NextResponse.json(
            { success: false, error: error instanceof Error ? error.message : "Could not verify contacts." },
            { status: 500 },
        );
    }
}
