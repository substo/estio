import { NextRequest, NextResponse } from 'next/server';
import { verifyCronAuthorization } from '@/lib/cron/auth';
import { CronGuard } from '@/lib/cron/guard';
import { processViewingReminderBatch } from '@/lib/viewings/reminders';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const guard = new CronGuard('viewing-reminders');

export async function GET(request: NextRequest) {
    const auth = verifyCronAuthorization(request);
    if (!auth.ok) return auth.response;

    const resources = await guard.checkResources(300, 5.0);
    if (!resources.ok) {
        return NextResponse.json({ skipped: true, reason: resources.reason });
    }

    if (!(await guard.acquire())) {
        return NextResponse.json({ skipped: true, reason: 'locked' });
    }

    try {
        const stats = await processViewingReminderBatch({ batchSize: 50 });
        return NextResponse.json({ success: true, stats });
    } catch (error: any) {
        return NextResponse.json(
            {
                success: false,
                error: error?.message || 'Viewing reminder processing failed',
            },
            { status: 500 }
        );
    } finally {
        await guard.release();
    }
}
