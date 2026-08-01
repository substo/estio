import assert from 'node:assert/strict';
import test from 'node:test';
import { applyOffboardingResponsibilityMode, countOffboardingResponsibilities, shouldClearUserGlobalPrivateState } from './offboarding-responsibilities';

function repository(calls: Array<{ domain: string; args: unknown }>) {
  const domain = (name: string) => ({ updateMany: async (args: unknown) => {
    calls.push({ domain: name, args });
    return { count: 1 };
  } });
  return {
    contact: domain('contact'), dealContext: domain('deal'), contactTask: domain('task'),
    viewingSession: domain('session'), viewing: domain('viewing'),
  };
}

test('TRANSFER updates each active responsibility in place without create/copy operations', async () => {
  const calls: Array<{ domain: string; args: any }> = [];
  const counts = await applyOffboardingResponsibilityMode(repository(calls), {
    mode: 'TRANSFER', locationId: 'location_a', sourceUserId: 'source_a', successorUserId: 'successor_a',
    taskIds: ['task_a'], viewingIds: ['viewing_a'], viewingCutoff: new Date('2026-08-01T00:00:00Z'),
  });
  assert.deepEqual(counts, { contacts: 1, deals: 1, tasks: 1, viewingSessions: 1, futureViewings: 1 });
  assert.deepEqual(calls.map((call) => call.domain), ['contact', 'deal', 'task', 'session', 'viewing']);
  assert.deepEqual(calls[0].args.where, { locationId: 'location_a', assignedUserId: 'source_a' });
  assert.deepEqual(calls[1].args.where.stage, { not: 'CLOSED' });
  assert.deepEqual(calls[2].args.where, { id: { in: ['task_a'] }, locationId: 'location_a', assignedUserId: 'source_a', deletedAt: null, status: 'open' });
  assert.deepEqual(calls[3].args.where.status, { notIn: ['completed', 'expired'] });
  assert.deepEqual(calls[4].args.where.id, { in: ['viewing_a'] });
  assert.equal(calls[4].args.where.userId, 'source_a');
});

test('KEEP_ASSIGNED changes no responsibility assignment and requires no fake successor', async () => {
  const calls: Array<{ domain: string; args: unknown }> = [];
  const counts = await applyOffboardingResponsibilityMode(repository(calls), {
    mode: 'KEEP_ASSIGNED', locationId: 'location_a', sourceUserId: 'source_a', successorUserId: null,
    taskIds: [], viewingIds: [], viewingCutoff: new Date('2026-08-01T00:00:00Z'),
  });
  assert.deepEqual(counts, { contacts: 0, deals: 0, tasks: 0, viewingSessions: 0, futureViewings: 0 });
  assert.deepEqual(calls, []);
});

test('global private state clears only after the final location membership is removed', () => {
  assert.equal(shouldClearUserGlobalPrivateState(0, 0), true);
  assert.equal(shouldClearUserGlobalPrivateState(1, 0), false);
  assert.equal(shouldClearUserGlobalPrivateState(0, 1), false);
});

test('responsibility counts use one location, assignee, status set, and viewing cutoff', async () => {
  const calls: Array<{ domain: string; args: any }> = [];
  let next = 0;
  const count = (domain: string) => async (args: any) => {
    calls.push({ domain, args });
    return ++next;
  };
  const cutoff = new Date('2026-08-01T10:00:00.000Z');
  const counts = await countOffboardingResponsibilities({
    contact: { count: count('contact') }, conversation: { count: count('conversation') },
    dealContext: { count: count('deal') }, contactTask: { count: count('task') },
    viewingSession: { count: count('session') }, viewing: { count: count('viewing') },
  }, { locationId: 'location_a', sourceUserId: 'source_a', viewingCutoff: cutoff });
  assert.deepEqual(counts, {
    assignedContacts: 1, inheritedConversations: 2, activeAssignedDeals: 3,
    activeUnassignedDeals: 4, openTasks: 5, nonTerminalViewingSessions: 6,
    futureActionableViewings: 7,
  });
  assert.equal(calls[0].args.where.locationId, 'location_a');
  assert.equal(calls[1].args.where.contact.assignedUserId, 'source_a');
  assert.deepEqual(calls[4].args.where, { locationId: 'location_a', assignedUserId: 'source_a', deletedAt: null, status: 'open' });
  assert.equal(calls[6].args.where.date.gte, cutoff);
});
