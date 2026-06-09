import { NextRequest, NextResponse } from "next/server";
import { autoApplyConfidentContactVerificationProposals } from "@/lib/ai/contact-verification/service";
import {
    getContactProfileVerificationQueueStatus,
    runContactProfileVerificationCron,
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
    const modelOverride = String(body?.model || "").trim() || null;

    try {
        const stats = await runContactProfileVerificationCron({
            locationId: authorization.locationId,
            batchSize: normalizeContactProfileVerificationBatchSize(body?.batchSize),
            source: "manual",
            force: true,
            modelOverride,
        });
        const autoApply = await autoApplyConfidentContactVerificationProposals({
            locationId: authorization.locationId,
            actorUserId: null,
            limit: Number(body?.autoApplyLimit || 200),
        });
        const status = await getContactProfileVerificationQueueStatus({ locationId: authorization.locationId });
        console.info("[contact-classification:run] Processed batch", {
            locationId: authorization.locationId,
            checked: stats.checked,
            verified: stats.verified,
            proposals: stats.proposals,
            failures: stats.failures,
            applied: autoApply.applied,
            autoApplyFailures: autoApply.failures,
            queued: status.queued,
            model: modelOverride || "saved_setting",
        });
        return NextResponse.json({ success: true, stats, autoApply, status });
    } catch (error: unknown) {
        console.error("[contact-classification:run] Error:", error);
        return NextResponse.json(
            { success: false, error: error instanceof Error ? error.message : "Failed to run Contact Classification." },
            { status: 500 },
        );
    }
}
