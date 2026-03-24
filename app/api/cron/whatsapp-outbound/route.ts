import { NextRequest, NextResponse } from "next/server";
import { CronGuard } from "@/lib/cron/guard";
import { verifyCronAuthorization } from "@/lib/cron/auth";
import { enqueueDueWhatsAppOutboundOutboxJobs, initWhatsAppOutboundWorker } from "@/lib/queue/whatsapp-outbound";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const guard = new CronGuard("whatsapp-outbound");

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
        try {
            await initWhatsAppOutboundWorker();
        } catch (workerError) {
            console.error("[Cron] Failed to initialize WhatsApp outbound worker:", workerError);
        }

        const stats = await enqueueDueWhatsAppOutboundOutboxJobs({ limit: 400 });
        return NextResponse.json({ success: true, stats });
    } catch (error: any) {
        return NextResponse.json(
            {
                success: false,
                error: error?.message || "WhatsApp outbound cron failed.",
            },
            { status: 500 }
        );
    } finally {
        await guard.release();
    }
}
