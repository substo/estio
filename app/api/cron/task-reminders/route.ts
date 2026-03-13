import { NextRequest, NextResponse } from 'next/server';
import { verifyCronAuthorization } from '@/lib/cron/auth';
import { CronGuard } from '@/lib/cron/guard';
import { getNotificationFeatureFlags } from '@/lib/notifications/feature-flags';
import { processTaskReminderBatch } from '@/lib/tasks/reminders';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const guard = new CronGuard('task-reminders');

export async function GET(request: NextRequest) {
  const auth = verifyCronAuthorization(request);
  if (!auth.ok) return auth.response;

  const flags = getNotificationFeatureFlags();
  if (!flags.reminderCron) {
    return NextResponse.json({ success: true, skipped: true, reason: 'disabled_by_feature_flag' });
  }

  const resources = await guard.checkResources(300, 5.0);
  if (!resources.ok) {
    return NextResponse.json({ skipped: true, reason: resources.reason });
  }

  if (!(await guard.acquire())) {
    return NextResponse.json({ skipped: true, reason: 'locked' });
  }

  try {
    const stats = await processTaskReminderBatch({ batchSize: 50 });
    return NextResponse.json({ success: true, stats });
  } catch (error: any) {
    return NextResponse.json(
      {
        success: false,
        error: error?.message || 'Task reminder processing failed',
      },
      { status: 500 }
    );
  } finally {
    await guard.release();
  }
}
