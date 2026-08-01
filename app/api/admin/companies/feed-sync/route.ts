import { auth } from '@clerk/nextjs/server';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import db from '@/lib/db';
import { getLocationContext } from '@/lib/auth/location-context';
import { CronGuard } from '@/lib/cron/guard';
import { FeedService } from '@/lib/feed/feed-service';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const requestSchema = z.object({
    companyId: z.string().trim().min(1),
});

const guard = new CronGuard('sync-feeds');

export async function POST(request: NextRequest) {
    const { userId } = await auth();
    if (!userId) {
        return NextResponse.json({ success: false, error: 'Unauthorized.' }, { status: 401 });
    }

    const location = await getLocationContext();
    if (!location) {
        return NextResponse.json({ success: false, error: 'Active location unavailable.' }, { status: 403 });
    }

    let body: unknown;
    try {
        body = await request.json();
    } catch {
        return NextResponse.json({ success: false, error: 'Invalid JSON body.' }, { status: 400 });
    }

    const validated = requestSchema.safeParse(body);
    if (!validated.success) {
        return NextResponse.json({ success: false, error: 'A company ID is required.' }, { status: 400 });
    }

    let company;
    try {
        company = await db.company.findFirst({
            where: { id: validated.data.companyId, locationId: location.id },
            select: {
                id: true,
                feeds: {
                    where: { isActive: true },
                    select: { id: true },
                },
            },
        });
    } catch (error) {
        console.error('[manualFeedSync] Company lookup failed:', error);
        return NextResponse.json({ success: false, error: 'Feed sync unavailable.' }, { status: 500 });
    }

    if (!company) {
        return NextResponse.json({ success: false, error: 'Company not found or access denied.' }, { status: 404 });
    }

    const resources = await guard.checkResources(350, 6.0);
    if (!resources.ok) {
        return NextResponse.json(
            { success: false, error: 'Feed sync is temporarily unavailable.' },
            { status: 503 },
        );
    }

    if (!(await guard.acquire())) {
        return NextResponse.json(
            { success: false, error: 'A feed sync is already running.' },
            { status: 409 },
        );
    }

    try {
        const results = [];
        for (const feed of company.feeds) {
            try {
                const result = await FeedService.syncFeed(feed.id);
                results.push({ feedId: feed.id, status: 'success', ...result });
            } catch (error) {
                console.error(`[manualFeedSync] Feed ${feed.id} failed:`, error);
                results.push({ feedId: feed.id, status: 'error', error: 'Feed sync failed.' });
            }
        }

        const failed = results.filter((result) => result.status === 'error').length;
        return NextResponse.json({
            success: failed === 0,
            message: failed === 0 ? 'Feed sync completed.' : `${failed} feed sync${failed === 1 ? '' : 's'} failed.`,
            results,
        });
    } catch (error) {
        console.error('[manualFeedSync] Command failed:', error);
        return NextResponse.json({ success: false, error: 'Feed sync failed.' }, { status: 500 });
    } finally {
        await guard.release();
    }
}
