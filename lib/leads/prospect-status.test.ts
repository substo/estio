import assert from 'node:assert/strict';
import test from 'node:test';
import { isProspectStatusLinkable, normalizeProspectStatus } from './prospect-status';

test('normalizeProspectStatus lowercases and trims', () => {
  assert.equal(normalizeProspectStatus(' NEW '), 'new');
  assert.equal(normalizeProspectStatus('Reviewing'), 'reviewing');
  assert.equal(normalizeProspectStatus(null), '');
});

test('isProspectStatusLinkable handles mixed-case status values', () => {
  assert.equal(isProspectStatusLinkable('new'), true);
  assert.equal(isProspectStatusLinkable('REVIEWING'), true);
  assert.equal(isProspectStatusLinkable('accepted'), false);
  assert.equal(isProspectStatusLinkable(undefined), false);
});
