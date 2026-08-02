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

test('preview explicitly reports retained and external data', () => {
  const preview = buildLocationClearPreview({});
  assert.ok(preview.retained.some((entry) => entry.includes('Users, memberships, roles')));
  assert.ok(preview.external.some((entry) => entry.includes('Cloudflare Images')));
  assert.ok(preview.external.some((entry) => entry.includes('WhatsApp')));
  assert.ok(preview.external.some((entry) => entry.includes('recreate cleared records')));
});
