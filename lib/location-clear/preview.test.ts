import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildLocationClearPreview,
  locationClearClassificationIsComplete,
} from './preview';

test('every requested reset root is classified without duplicates', () => {
  assert.equal(locationClearClassificationIsComplete(), true);
});

test('preview totals are derived from server row counts', () => {
  const preview = buildLocationClearPreview({ Contact: 4, Conversation: 3, Message: 8, Property: 2, AiUsage: 5 });
  assert.equal(preview.totalRows, 22);
  assert.equal(preview.groups.find((group) => group.key === 'contacts')?.count, 15);
  assert.equal(preview.groups.find((group) => group.key === 'properties')?.count, 2);
  assert.equal(preview.groups.find((group) => group.key === 'usage')?.count, 5);
});

test('preview uses user-facing categories and reports retained account data', () => {
  const preview = buildLocationClearPreview({});
  assert.deepEqual(preview.groups.map((group) => group.label), [
    'Reports and AI usage',
    'Contacts and customer work',
    'Prospecting',
    'Companies',
    'Projects',
    'Properties and listing activity',
  ]);
  assert.ok(preview.groups.find((group) => group.key === 'properties')?.details.includes('Media references'));
  assert.ok(preview.retained.includes('Team members, permissions, and sign-in access'));
  assert.ok(preview.retained.includes('Connected-service settings and credentials'));
});
