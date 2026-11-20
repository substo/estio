import { NextRequest, NextResponse } from "next/server";
import { autoApplyConfidentContactVerificationProposals } from "@/lib/ai/contact-verification/service";
import {
    getContactProfileVerificationQueueStatus,
} from "@/lib/ai/contact-profile-verification/cron";
import { startContactClassificationRun } from "@/lib/ai/contact-classification/job";
import { enqueueContactClassificationRun } from "@/lib/queue/contact-classification";
import { normalizeContactProfileVerificationBatchSize } from "@/lib/ai/contact-profile-verification/config";
import { GEMINI_FLASH_LATEST_ALIAS } from "@/lib/ai/models";
import { authorizeContactClassificationRequest } from "../_shared";

export const dynamic = "force-dynamic";
export const maxDuration = 180;

export async function POST(request: NextRequest) {
    const body = await request.json().catch(() => ({}));
    const locationId = String(body?.locationId || "").trim();
    const authorization = await authorizeContactClassificationRequest(locationId);
    if (!authorization.ok) return authorization.response;

    const batchSize = normalizeContactProfileVerificationBatchSize(body?.batchSize);
    const modelOverride = String(body?.model || "").trim() || null;

    try {
        const firstAutoApply = await autoApplyConfidentContactVerificationProposals({
            locationId: authorization.locationId,
            actorUserId: null,
            limit: 200,
        });
        const job = await startContactClassificationRun({
            locationId: authorization.locationId,
            model: modelOverride || GEMINI_FLASH_LATEST_ALIAS,
            requestedByUserId: authorization.userId,
        });
        if (job.run?.id && ["queued", "running"].includes(String(job.run.status))) {
            await enqueueContactClassificationRun({ runId: job.run.id });
        }
        const status = await getContactProfileVerificationQueueStatus({ locationId: authorization.locationId });

        console.info("[contact-classification:verify-now] Started contact verification", {
            locationId: authorization.locationId,
            runId: job.run?.id || null,
            queued: job.run?.totalQueued || 0,
            applied: Number(firstAutoApply.applied || 0),
            remainingQueued: status.queued,
            pendingReview: status.pendingReview,
            model: modelOverride || "saved_setting",
        });

        return NextResponse.json({
            success: true,
            batchSize,
            queued: { success: true, due: job.run?.totalQueued || 0 },
            firstAutoApply,
            status,
            run: job.run,
            model: modelOverride,
        });
    } catch (error: unknown) {
        console.error("[contact-classification:verify-now] Error:", error);
        return NextResponse.json(
            { success: false, error: error instanceof Error ? error.message : "Could not verify contacts." },
            { status: 500 },
        );
    }
}
