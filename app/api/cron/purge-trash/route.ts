import { NextRequest, NextResponse } from 'next/server';
import db from '@/lib/db';
import { CronGuard } from '@/lib/cron/guard';
import { verifyCronAuthorization } from '@/lib/cron/auth';

export const dynamic = 'force-dynamic';

/**
 * Auto-purge expired conversations from trash.
 */

const guard = new CronGuard('purge-trash');

export async function GET(request: NextRequest) {
  const auth = verifyCronAuthorization(request);
  if (!auth.ok) return auth.response;

  const resources = await guard.checkResources(300, 6.0);
  if (!resources.ok) {
    return NextResponse.json({ skipped: true, reason: resources.reason });
  }

  if (!(await guard.acquire())) {
    return NextResponse.json({ skipped: true, reason: 'locked' });
  }

  try {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const result = await db.conversation.deleteMany({
      where: {
        deletedAt: { lt: thirtyDaysAgo },
      },
    });

    return NextResponse.json({
      success: true,
      purged: result.count,
      message: `Permanently deleted ${result.count} conversations older than 30 days in trash.`,
    });
  } catch (error: any) {
    return NextResponse.json(
      {
        success: false,
        error: error?.message || 'Purge trash failed',
      },
      { status: 500 }
    );
  } finally {
    await guard.release();
  }
}
