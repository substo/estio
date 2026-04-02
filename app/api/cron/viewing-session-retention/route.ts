import { NextRequest, NextResponse } from "next/server";
import { verifyCronAuthorization } from "@/lib/cron/auth";
import { CronGuard } from "@/lib/cron/guard";
import { runViewingSessionRetentionCleanup } from "@/lib/viewings/sessions/retention";

export const dynamic = "force-dynamic";

const guard = new CronGuard("viewing-session-retention");

function asBoolean(value: string | null): boolean {
    const normalized = String(value || "").trim().toLowerCase();
    return normalized === "1" || normalized === "true" || normalized === "yes";
}

export async function GET(request: NextRequest) {
    const auth = verifyCronAuthorization(request);
    if (!auth.ok) return auth.response;

    const resources = await guard.checkResources(300, 6.0);
    if (!resources.ok) {
        return NextResponse.json({ skipped: true, reason: resources.reason });
    }

    if (!(await guard.acquire())) {
        return NextResponse.json({ skipped: true, reason: "locked" });
    }

    try {
        const dryRun = asBoolean(request.nextUrl.searchParams.get("dryRun"));
        const locationId = String(request.nextUrl.searchParams.get("locationId") || "").trim() || null;
        const batchSize = Number(request.nextUrl.searchParams.get("batchSize") || 200);

        const result = await runViewingSessionRetentionCleanup({
            dryRun,
            locationId,
            batchSize,
        });

        return NextResponse.json(result);
    } catch (error: any) {
        return NextResponse.json(
            {
                success: false,
                error: String(error?.message || "Viewing-session retention cleanup failed."),
            },
            { status: 500 }
        );
    } finally {
        await guard.release();
    }
}
