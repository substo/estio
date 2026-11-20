import { NextRequest, NextResponse } from "next/server";
import { resumeContactClassificationRun } from "@/lib/ai/contact-classification/job";
import { enqueueContactClassificationRun } from "@/lib/queue/contact-classification";
import { authorizeContactClassificationRequest } from "../../../_shared";

export const dynamic = "force-dynamic";

export async function POST(
    request: NextRequest,
    context: { params: Promise<{ runId: string }> },
) {
    const body = await request.json().catch(() => ({}));
    const locationId = String(body?.locationId || "").trim();
    const authorization = await authorizeContactClassificationRequest(locationId);
    if (!authorization.ok) return authorization.response;
    const { runId } = await context.params;

    const run = await resumeContactClassificationRun({ locationId: authorization.locationId, runId });
    if (run?.id) {
        await enqueueContactClassificationRun({ runId: run.id });
    }
    return NextResponse.json({ success: true, run });
}
