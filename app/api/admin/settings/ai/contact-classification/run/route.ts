import { NextRequest, NextResponse } from "next/server";
import { autoApplyConfidentContactVerificationProposals } from "@/lib/ai/contact-verification/service";
import {
    getContactProfileVerificationQueueStatus,
} from "@/lib/ai/contact-profile-verification/cron";
import { getCurrentContactClassificationRun } from "@/lib/ai/contact-classification/job";
import { enqueueContactClassificationRun } from "@/lib/queue/contact-classification";
import { authorizeContactClassificationRequest } from "../_shared";

export const dynamic = "force-dynamic";
export const maxDuration = 180;

export async function POST(request: NextRequest) {
    const body = await request.json().catch(() => ({}));
    const locationId = String(body?.locationId || "").trim();
    const authorization = await authorizeContactClassificationRequest(locationId);
    if (!authorization.ok) return authorization.response;

    try {
        const run = await getCurrentContactClassificationRun({ locationId: authorization.locationId });
        if (run?.id && ["queued", "running"].includes(String(run.status))) {
            await enqueueContactClassificationRun({ runId: run.id });
        }
        const autoApply = await autoApplyConfidentContactVerificationProposals({
            locationId: authorization.locationId,
            actorUserId: null,
            limit: Number(body?.autoApplyLimit || 200),
        });
        const status = await getContactProfileVerificationQueueStatus({ locationId: authorization.locationId });
        console.info("[contact-classification:run] Processed batch", {
            locationId: authorization.locationId,
            runId: run?.id || null,
            checked: run?.checked || 0,
            verified: run?.verified || 0,
            proposals: run?.proposals || 0,
            failures: run?.failures || 0,
            applied: autoApply.applied,
            autoApplyFailures: autoApply.failures,
            queued: status.queued,
            model: run?.model || null,
        });
        return NextResponse.json({
            success: true,
            stats: {
                checked: 0,
                verified: 0,
                proposals: 0,
                skipped: 0,
                failures: 0,
                reprocessedCampaignBlocks: 0,
            },
            autoApply,
            status,
            run,
        });
    } catch (error: unknown) {
        console.error("[contact-classification:run] Error:", error);
        return NextResponse.json(
            { success: false, error: error instanceof Error ? error.message : "Failed to run Contact Classification." },
            { status: 500 },
        );
    }
}
