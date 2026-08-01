import { NextRequest, NextResponse } from 'next/server';
import { CronGuard } from '@/lib/cron/guard';
import { verifyCronAuthorization } from '@/lib/cron/auth';
import db from '@/lib/db';
import { publishConversationRealtimeEvent } from '@/lib/realtime/conversation-events';
import { runConversationTrashRetentionPurge } from '@/lib/conversations/trash-retention';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/**
 * Auto-purge expired conversations from trash.
 */

const guard = new CronGuard('purge-trash', {
  distributed: true,
  ttlMs: 10 * 60 * 1000,
});
const NOTIFICATION_CONCURRENCY = 50;

async function publishPurgeNotifications(locationIds: string[], cutoffAt: string): Promise<number> {
  let notified = 0;
  for (let index = 0; index < locationIds.length; index += NOTIFICATION_CONCURRENCY) {
    const batch = await Promise.all(locationIds.slice(index, index + NOTIFICATION_CONCURRENCY).map((locationId) => (
      publishConversationRealtimeEvent({
        locationId,
        type: 'conversation.trash_purged',
        payload: {
          source: 'automatic_retention',
          cutoffAt,
        },
      })
    )));
    notified += batch.filter(Boolean).length;
  }
  return notified;
}

export async function GET(request: NextRequest) {
  const auth = verifyCronAuthorization(request);
  if (!auth.ok) return auth.response;

  const resources = await guard.checkResources(300, 6.0);
  if (!resources.ok) {
    return NextResponse.json({ skipped: true, reason: resources.reason });
  }

  if (!(await guard.acquire())) {
    const reason = guard.getLastAcquireFailureReason() || 'locked';
    const lockInfrastructureFailed = reason === 'distributed_unavailable' || reason === 'acquire_error';
    return NextResponse.json(
      { skipped: true, reason },
      { status: lockInfrastructureFailed ? 503 : 200 },
    );
  }

  try {
    const result = await runConversationTrashRetentionPurge({
      repository: db.conversation,
      batchSize: Number(process.env.CONVERSATION_TRASH_PURGE_BATCH_SIZE || 100),
      maxBatches: Number(process.env.CONVERSATION_TRASH_PURGE_MAX_BATCHES || 20),
    });
    const locationsNotified = await publishPurgeNotifications(result.affectedLocationIds, result.cutoffAt);
    const { affectedLocationIds, ...publicResult } = result;

    return NextResponse.json({
      ...publicResult,
      locationsAffected: affectedLocationIds.length,
      locationsNotified,
      message: result.limitReached
        ? `Permanently deleted ${result.purged} expired conversations; the bounded run limit was reached and remaining rows will continue on the next run.`
        : `Permanently deleted ${result.purged} conversations older than ${result.retentionDays} days in trash.`,
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
