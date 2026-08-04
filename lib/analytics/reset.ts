import type { ActiveContactsAccess } from '@/lib/contacts/active-location-access';

export const RESET_ANALYTICS_CONFIRMATION = 'RESET ANALYTICS';

export type AnalyticsDeletedCounts = {
  events: number;
  sessions: number;
  visitors: number;
  dailyRollups: number;
};

export type ResetAnalyticsResult =
  | { success: true; message: string; deletedCounts: AnalyticsDeletedCounts }
  | { success: false; message: string; deletedCounts: null };

type TransactionClient = {
  userLocationRole: {
    findFirst(args: unknown): Promise<{ id: string } | null>;
  };
  analyticsEvent: { deleteMany(args: unknown): Promise<{ count: number }> };
  analyticsSession: { deleteMany(args: unknown): Promise<{ count: number }> };
  analyticsVisitor: { deleteMany(args: unknown): Promise<{ count: number }> };
  analyticsDailyRollup: { deleteMany(args: unknown): Promise<{ count: number }> };
  settingsAuditLog: { create(args: unknown): Promise<unknown> };
};

type ResetAnalyticsDatabase = {
  $transaction<T>(callback: (tx: TransactionClient) => Promise<T>): Promise<T>;
};

export async function performResetAnalytics({
  confirmation,
  getAccess,
  database,
  now = () => new Date(),
}: {
  confirmation: string;
  getAccess: () => Promise<ActiveContactsAccess | null>;
  database: ResetAnalyticsDatabase;
  now?: () => Date;
}): Promise<ResetAnalyticsResult> {
  if (confirmation !== RESET_ANALYTICS_CONFIRMATION) {
    return { success: false, message: `Type ${RESET_ANALYTICS_CONFIRMATION} exactly to continue.`, deletedCounts: null };
  }

  const access = await getAccess();
  if (!access || access.role !== 'ADMIN') {
    return { success: false, message: 'A current ADMIN role is required.', deletedCounts: null };
  }

  const deletedCounts = await database.$transaction(async (tx) => {
    // Recheck the authoritative membership inside the deletion transaction.
    const adminRole = await tx.userLocationRole.findFirst({
      where: {
        userId: access.internalUserId,
        locationId: access.locationId,
        role: 'ADMIN',
        user: { locations: { some: { id: access.locationId } } },
      },
      select: { id: true },
    });
    if (!adminRole) throw new Error('A current ADMIN role is required.');

    const events = await tx.analyticsEvent.deleteMany({ where: { locationId: access.locationId } });
    const sessions = await tx.analyticsSession.deleteMany({ where: { locationId: access.locationId } });
    const visitors = await tx.analyticsVisitor.deleteMany({ where: { locationId: access.locationId } });
    const dailyRollups = await tx.analyticsDailyRollup.deleteMany({ where: { locationId: access.locationId } });
    const counts = {
      events: events.count,
      sessions: sessions.count,
      visitors: visitors.count,
      dailyRollups: dailyRollups.count,
    };
    const timestamp = now();

    await tx.settingsAuditLog.create({
      data: {
        actorUserId: access.internalUserId,
        scopeType: 'LOCATION',
        scopeId: access.locationId,
        domain: 'analytics',
        operation: 'DELETE',
        afterJson: {
          operationName: 'RESET_ANALYTICS',
          timestamp: timestamp.toISOString(),
          deletedCounts: counts,
        },
        createdAt: timestamp,
      },
    });

    return counts;
  });

  return {
    success: true,
    message: `Analytics reset complete: ${deletedCounts.events.toLocaleString()} events, ${deletedCounts.sessions.toLocaleString()} sessions, ${deletedCounts.visitors.toLocaleString()} visitors, and ${deletedCounts.dailyRollups.toLocaleString()} daily rollups deleted. Collection has resumed immediately.`,
    deletedCounts,
  };
}
