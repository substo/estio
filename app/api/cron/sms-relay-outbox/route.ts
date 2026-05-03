/**
 * GET /api/cron/sms-relay-outbox
 *
 * Cron job that runs every minute to:
 * 1. Recover stale processing locks (dead worker recovery)
 * 2. Enqueue due SmsRelayOutbox rows into BullMQ
 *
 * Mirrors app/api/cron/provider-outbox/route.ts exactly.
 */

import { NextRequest, NextResponse } from "next/server";
import { CronGuard } from "@/lib/cron/guard";
import { verifyCronAuthorization } from "@/lib/cron/auth";
import {
    enqueueDueSmsRelayOutboxJobs,
    initSmsRelayOutboxWorker,
} from "@/lib/queue/sms-relay-outbox";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const guard = new CronGuard("sms-relay-outbox");

export async function GET(request: NextRequest) {
    const auth = verifyCronAuthorization(request);
    if (!auth.ok) return auth.response;

    const resources = await guard.checkResources(300, 5.0);
    if (!resources.ok) {
        return NextResponse.json({ skipped: true, reason: resources.reason });
    }

    if (!(await guard.acquire())) {
        return NextResponse.json({ skipped: true, reason: "locked" });
    }

    try {
        try {
            await initSmsRelayOutboxWorker();
        } catch (workerError) {
            console.error("[Cron] Failed to initialize SMS relay outbox worker:", workerError);
        }

        const stats = await enqueueDueSmsRelayOutboxJobs({ limit: 300 });
        return NextResponse.json({ success: true, stats });
    } catch (error: any) {
        return NextResponse.json(
            {
                success: false,
                error: error?.message || "SMS relay outbox cron failed.",
            },
            { status: 500 }
        );
    } finally {
        await guard.release();
    }
}
