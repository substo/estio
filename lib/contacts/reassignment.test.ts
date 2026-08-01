import assert from 'node:assert/strict';
import test from 'node:test';
import { reassignContactsWithinLocation } from './reassignment';

test('reassignment is one location-scoped update with no create or history rewrite capability', async () => {
  const calls: unknown[] = [];
  const result = await reassignContactsWithinLocation({
    contact: {
      async updateMany(args) {
        calls.push(args);
        return { count: 3 };
      },
    },
  }, { locationId: 'loc_a', sourceUserId: 'user_old', successorUserId: 'user_new' });

  assert.deepEqual(result, { reassignedCount: 3 });
  assert.deepEqual(calls, [{
    where: { locationId: 'loc_a', assignedUserId: 'user_old' },
    data: { assignedUserId: 'user_new', leadAssignedToAgent: 'user_new' },
  }]);
});

test('reassignment rejects identical identities before touching the repository', async () => {
  let called = false;
  await assert.rejects(() => reassignContactsWithinLocation({
    contact: { async updateMany() { called = true; return { count: 0 }; } },
  }, { locationId: 'loc_a', sourceUserId: 'same', successorUserId: 'same' }), /different users/);
  assert.equal(called, false);
});
