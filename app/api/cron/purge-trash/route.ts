import { NextRequest, NextResponse } from 'next/server';
import db from '@/lib/db';

export const dynamic = 'force-dynamic';

/**
 * Auto-purge expired conversations from trash
 * 
 * This cron job permanently deletes conversations that have been in the trash
 * for more than 30 days. Run daily via Vercel Cron or external scheduler.
 * 
 * Endpoint: GET /api/cron/purge-trash
 * Schedule: Daily at 2:00 AM UTC (0 2 * * *)
 */
export async function GET(request: NextRequest) {
    // Optional: Verify cron secret for security
    const authHeader = request.headers.get('authorization');
    if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    try {
        const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

        const result = await db.conversation.deleteMany({
            where: {
                deletedAt: { lt: thirtyDaysAgo }
            }
        });

        console.log(`[Cron: purge-trash] Permanently deleted ${result.count} expired conversations.`);

        return NextResponse.json({
            success: true,
            purged: result.count,
            message: `Permanently deleted ${result.count} conversations older than 30 days in trash.`
        });

    } catch (error: any) {
        console.error('[Cron: purge-trash] Error:', error);
        return NextResponse.json({
            success: false,
            error: error.message
        }, { status: 500 });
    }
}
