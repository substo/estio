import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { verifyUserIsLocationAdmin } from '@/lib/auth/permissions';
import { getScrapingQueueDiagnostics } from '@/lib/queue/scraping-queue';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
    const { userId } = await auth();
    if (!userId) {
        return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const locationId = req.nextUrl.searchParams.get('locationId')?.trim();
    if (!locationId) {
        return NextResponse.json({ success: false, error: 'Missing locationId' }, { status: 400 });
    }

    const isAdmin = await verifyUserIsLocationAdmin(userId, locationId);
    if (!isAdmin) {
        return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
    }

    try {
        const diagnostics = await getScrapingQueueDiagnostics();
        return NextResponse.json({ success: true, diagnostics });
    } catch (error: any) {
        return NextResponse.json(
            {
                success: false,
                error: error?.message || 'Failed to load queue diagnostics',
            },
            { status: 500 },
        );
    }
}
