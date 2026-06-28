import { NextRequest, NextResponse } from "next/server";
import { CronGuard } from "@/lib/cron/guard";
import { verifyCronAuthorization } from "@/lib/cron/auth";
import { runAiProviderCatalogRefresh } from "@/lib/ai/provider-catalog-refresh";

export const dynamic = "force-dynamic";
export const maxDuration = 180;

const guard = new CronGuard("ai-provider-catalog");

export async function GET(request: NextRequest) {
    const auth = verifyCronAuthorization(request);
    if (!auth.ok) return auth.response;

    const resources = await guard.checkResources(350, 5.0);
    if (!resources.ok) {
        return NextResponse.json({ skipped: true, reason: resources.reason });
    }

    if (!(await guard.acquire())) {
        return NextResponse.json({ skipped: true, reason: "locked" });
    }

    try {
        const startedAt = Date.now();
        const stats = await runAiProviderCatalogRefresh();

        return NextResponse.json({
            success: true,
            durationMs: Date.now() - startedAt,
            stats,
        });
    } catch (error: any) {
        return NextResponse.json(
            {
                success: false,
                error: error?.message || "AI provider catalog refresh failed",
            },
            { status: 500 }
        );
    } finally {
        await guard.release();
    }
}
