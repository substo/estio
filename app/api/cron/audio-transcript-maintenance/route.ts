import { NextRequest, NextResponse } from "next/server";
import { CronGuard } from "@/lib/cron/guard";
import { runAudioTranscriptMaintenanceJob } from "@/lib/ai/audio/transcript-maintenance";

export const dynamic = "force-dynamic";
export const maxDuration = 180;

const guard = new CronGuard("audio-transcript-maintenance");

export async function GET(request: NextRequest) {
    const authHeader = request.headers.get("authorization");
    const cronSecret = process.env.CRON_SECRET;

    if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const resources = await guard.checkResources(400, 5.0);
    if (!resources.ok) {
        return NextResponse.json({ skipped: true, reason: resources.reason });
    }

    if (!(await guard.acquire())) {
        return NextResponse.json({ skipped: true, reason: "locked" });
    }

    try {
        const stats = await runAudioTranscriptMaintenanceJob({
            maxRetries: Number(process.env.AUDIO_TRANSCRIPT_MAX_RETRIES || 3),
            staleProcessingMinutes: Number(process.env.AUDIO_TRANSCRIPT_STALE_PROCESSING_MINUTES || 35),
            stalePendingMinutes: Number(process.env.AUDIO_TRANSCRIPT_STALE_PENDING_MINUTES || 60),
            retryFailedAfterMinutes: Number(process.env.AUDIO_TRANSCRIPT_RETRY_FAILED_AFTER_MINUTES || 20),
            batchSize: Number(process.env.AUDIO_TRANSCRIPT_MAINTENANCE_BATCH_SIZE || 100),
            applyRetention: String(process.env.AUDIO_TRANSCRIPT_RETENTION_ENABLED || "true").toLowerCase() !== "false",
        });

        return NextResponse.json({
            success: true,
            stats,
        });
    } catch (error: any) {
        return NextResponse.json(
            {
                success: false,
                error: error?.message || "Audio transcript maintenance failed",
            },
            { status: 500 }
        );
    } finally {
        await guard.release();
    }
}
