import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyAssignmentRecovery,
  countAssignmentRecovery,
  createAssignmentRecoveryFingerprint,
  createAssignmentRecoveryToken,
  requiredAssignmentRecoveryPhrase,
  verifyAssignmentRecoveryToken,
} from './assignment-recovery';

test('recovery counts every current user-scoped category without treating conversations as mutable ownership', async () => {
  const calls: Array<[string, any]> = [];
  const counter = (name: string, value: number) => ({ count: async (args: any) => { calls.push([name, args]); return value; } });
  const counts = await countAssignmentRecovery({
    contact: counter('contact', 10), conversation: counter('conversation', 8), dealContext: counter('deal', 4),
    contactTask: counter('task', 3), viewingSession: counter('session', 2), viewing: counter('viewing', 1),
  }, { locationId: 'loc_a', targetUserId: 'user_a', viewingCutoff: new Date('2026-08-01T00:00:00Z') });
  assert.deepEqual(counts, { contacts: 10, inheritedConversations: 8, deals: 4, openTasks: 3, nonTerminalViewingSessions: 2, futureActionableViewings: 1 });
  assert.equal(calls.length, 6);
  for (const [, args] of calls) assert.match(JSON.stringify(args), /loc_a/);
  assert.match(JSON.stringify(calls.find(([name]) => name === 'conversation')?.[1]), /assignedUserId/);
});

test('recovery updates responsibilities in place and never updates conversation or message rows', async () => {
  const calls: Array<[string, any]> = [];
  const updater = (name: string, count: number) => ({ updateMany: async (args: any) => { calls.push([name, args]); return { count }; } });
  const changes = await applyAssignmentRecovery({
    contact: updater('contact', 10), dealContext: updater('deal', 4), contactTask: updater('task', 3),
    viewingSession: updater('session', 2), viewing: updater('viewing', 1),
  }, { locationId: 'loc_a', targetUserId: 'user_a', taskIds: ['task_a'], viewingIds: ['viewing_a'], viewingCutoff: new Date('2026-08-01T00:00:00Z') });
  assert.deepEqual(changes, { contacts: 10, deals: 4, openTasks: 3, nonTerminalViewingSessions: 2, futureActionableViewings: 1 });
  assert.deepEqual(calls.map(([name]) => name), ['contact', 'deal', 'task', 'session', 'viewing']);
  assert.deepEqual(calls[0][1].data, { assignedUserId: 'user_a', leadAssignedToAgent: 'user_a' });
  assert.ok(!calls.some(([name]) => name === 'conversation' || name === 'message'));
});

test('signed recovery confirmation binds the target and deterministic counts', () => {
  const previous = process.env.OFFBOARDING_CONFIRMATION_SECRET;
  process.env.OFFBOARDING_CONFIRMATION_SECRET = 'x'.repeat(64);
  try {
    const counts = { contacts: 10, inheritedConversations: 8, deals: 4, openTasks: 3, nonTerminalViewingSessions: 2, futureActionableViewings: 1 };
    const previewFingerprint = createAssignmentRecoveryFingerprint({ locationId: 'loc_a', targetUserId: 'user_a', counts });
    const payload = { confirmationId: 'confirmation_a', actorUserId: 'admin_a', locationId: 'loc_a', targetUserId: 'user_a', targetClerkId: 'clerk_a', targetEmail: 'source@example.com', previewFingerprint, responsibilityCutoff: '2026-08-01T00:00:00.000Z', issuedAt: Date.now() };
    const token = createAssignmentRecoveryToken(payload)!;
    assert.deepEqual(verifyAssignmentRecoveryToken(token), payload);
    assert.throws(() => verifyAssignmentRecoveryToken(`${token}x`), /Invalid/);
    assert.equal(requiredAssignmentRecoveryPhrase(' Source@Example.com '), 'ASSIGN ALL RESPONSIBILITIES TO source@example.com');
  } finally {
    if (previous === undefined) delete process.env.OFFBOARDING_CONFIRMATION_SECRET;
    else process.env.OFFBOARDING_CONFIRMATION_SECRET = previous;
  }
});
