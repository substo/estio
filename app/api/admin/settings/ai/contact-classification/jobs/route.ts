import { NextRequest, NextResponse } from "next/server";
import {
    getCurrentContactClassificationRun,
    startContactClassificationRun,
} from "@/lib/ai/contact-classification/job";
import { enqueueContactClassificationRun } from "@/lib/queue/contact-classification";
import { authorizeContactClassificationRequest } from "../_shared";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
    const locationId = String(request.nextUrl.searchParams.get("locationId") || "").trim();
    const authorization = await authorizeContactClassificationRequest(locationId);
    if (!authorization.ok) return authorization.response;

    const run = await getCurrentContactClassificationRun({ locationId: authorization.locationId });
    return NextResponse.json({ success: true, run });
}

export async function POST(request: NextRequest) {
    const body = await request.json().catch(() => ({}));
    const locationId = String(body?.locationId || "").trim();
    const authorization = await authorizeContactClassificationRequest(locationId);
    if (!authorization.ok) return authorization.response;

    const model = String(body?.model || "").trim();
    if (!model) {
        return NextResponse.json({ success: false, error: "Missing contact classification model." }, { status: 400 });
    }

    try {
        const result = await startContactClassificationRun({
            locationId: authorization.locationId,
            model,
            requestedByUserId: authorization.userId,
        });
        if (result.run?.id && ["queued", "running"].includes(String(result.run.status))) {
            await enqueueContactClassificationRun({ runId: result.run.id });
        }
        return NextResponse.json({ success: true, ...result });
    } catch (error: unknown) {
        console.error("[contact-classification:jobs] Failed to start run:", error);
        return NextResponse.json(
            { success: false, error: error instanceof Error ? error.message : "Could not start contact classification." },
            { status: 500 },
        );
    }
}
