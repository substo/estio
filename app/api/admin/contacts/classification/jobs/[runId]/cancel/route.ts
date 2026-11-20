import { NextRequest, NextResponse } from "next/server";
import { cancelContactClassificationRun } from "@/lib/ai/contact-classification/job";
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

    const run = await cancelContactClassificationRun({ locationId: authorization.locationId, runId });
    return NextResponse.json({ success: true, run });
}
