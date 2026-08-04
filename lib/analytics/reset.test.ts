import assert from 'node:assert/strict';
import test from 'node:test';
import type { ActiveContactsAccess } from '@/lib/contacts/active-location-access';
import { performResetAnalytics, RESET_ANALYTICS_CONFIRMATION } from './reset';

const adminAccess: ActiveContactsAccess = {
  userId: 'clerk-admin',
  internalUserId: 'user-admin',
  locationId: 'location-active',
  role: 'ADMIN',
  contactAccessScope: 'LOCATION_WIDE',
};

function harness({ authorized = true } = {}) {
  const calls: Array<{ model: string; args: any }> = [];
  let transactions = 0;
  const tx = {
    userLocationRole: {
      findFirst: async (args: unknown) => {
        calls.push({ model: 'authorization', args });
        return authorized ? { id: 'role-admin' } : null;
      },
    },
    analyticsEvent: { deleteMany: async (args: unknown) => (calls.push({ model: 'events', args }), { count: 4 }) },
    analyticsSession: { deleteMany: async (args: unknown) => (calls.push({ model: 'sessions', args }), { count: 3 }) },
    analyticsVisitor: { deleteMany: async (args: unknown) => (calls.push({ model: 'visitors', args }), { count: 2 }) },
    analyticsDailyRollup: { deleteMany: async (args: unknown) => (calls.push({ model: 'dailyRollups', args }), { count: 1 }) },
    settingsAuditLog: { create: async (args: unknown) => { calls.push({ model: 'auditCreate', args }); return {}; } },
  };
  const database = {
    $transaction: async <T>(callback: (client: typeof tx) => Promise<T>) => {
      transactions += 1;
      return callback(tx);
    },
  };
  return { calls, database, get transactions() { return transactions; } };
}

test('ADMIN resets analytics for only the server-resolved active location in dependency order', async () => {
  const testHarness = harness();
  const result = await performResetAnalytics({
    confirmation: RESET_ANALYTICS_CONFIRMATION,
    getAccess: async () => adminAccess,
    database: testHarness.database,
    now: () => new Date('2026-08-04T10:00:00.000Z'),
  });

  assert.deepEqual(result.deletedCounts, { events: 4, sessions: 3, visitors: 2, dailyRollups: 1 });
  assert.deepEqual(testHarness.calls.map(({ model }) => model), [
    'authorization', 'events', 'sessions', 'visitors', 'dailyRollups', 'auditCreate',
  ]);
  for (const call of testHarness.calls.filter(({ model }) => ['events', 'sessions', 'visitors', 'dailyRollups'].includes(model))) {
    assert.deepEqual(call.args, { where: { locationId: 'location-active' } });
  }

  const audit = testHarness.calls.at(-1)?.args.data;
  assert.equal(audit.actorUserId, 'user-admin');
  assert.equal(audit.scopeId, 'location-active');
  assert.equal(audit.afterJson.operationName, 'RESET_ANALYTICS');
  assert.deepEqual(audit.afterJson.deletedCounts, { events: 4, sessions: 3, visitors: 2, dailyRollups: 1 });
  assert.equal(audit.afterJson.timestamp, '2026-08-04T10:00:00.000Z');

  // A foreign client value has no input path; every mutation is fixed to the active location.
  assert.doesNotMatch(JSON.stringify(testHarness.calls), /location-foreign/);
  // Only the four analytics models and one append-only audit create are touched.
  assert.deepEqual(new Set(testHarness.calls.map(({ model }) => model)), new Set([
    'authorization', 'events', 'sessions', 'visitors', 'dailyRollups', 'auditCreate',
  ]));
});

test('MEMBER and unauthenticated callers are denied without starting a transaction', async () => {
  for (const access of [{ ...adminAccess, role: 'MEMBER' as const }, null]) {
    const testHarness = harness();
    const result = await performResetAnalytics({
      confirmation: RESET_ANALYTICS_CONFIRMATION,
      getAccess: async () => access,
      database: testHarness.database,
    });
    assert.equal(result.success, false);
    assert.equal(testHarness.transactions, 0);
  }
});

test('incorrect confirmation performs no mutation', async () => {
  const testHarness = harness();
  const result = await performResetAnalytics({
    confirmation: 'RESET',
    getAccess: async () => adminAccess,
    database: testHarness.database,
  });
  assert.equal(result.success, false);
  assert.equal(testHarness.transactions, 0);
  assert.deepEqual(testHarness.calls, []);
});

test('ADMIN authorization is rechecked inside the transaction before deletion', async () => {
  const testHarness = harness({ authorized: false });
  await assert.rejects(() => performResetAnalytics({
    confirmation: RESET_ANALYTICS_CONFIRMATION,
    getAccess: async () => adminAccess,
    database: testHarness.database,
  }), /current ADMIN/);
  assert.deepEqual(testHarness.calls.map(({ model }) => model), ['authorization']);
});
