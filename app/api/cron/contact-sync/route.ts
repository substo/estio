import { NextRequest, NextResponse } from 'next/server';
import { CronGuard } from '@/lib/cron/guard';
import { verifyCronAuthorization } from '@/lib/cron/auth';
import { processContactSyncOutboxBatch } from '@/lib/contacts/sync-engine';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const guard = new CronGuard('contact-sync');

export async function GET(request: NextRequest) {
  const auth = verifyCronAuthorization(request);
  if (!auth.ok) return auth.response;

  const resources = await guard.checkResources(400, 5.0);
  if (!resources.ok) {
    return NextResponse.json({ skipped: true, reason: resources.reason });
  }

  if (!(await guard.acquire())) {
    return NextResponse.json({ skipped: true, reason: 'locked' });
  }

  try {
    const stats = await processContactSyncOutboxBatch({ batchSize: 25 });
    return NextResponse.json({ success: true, stats });
  } catch (error: any) {
    return NextResponse.json(
      {
        success: false,
        error: error?.message || 'Contact sync processing failed',
      },
      { status: 500 }
    );
  } finally {
    await guard.release();
  }
}
