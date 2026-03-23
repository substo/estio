import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isOpenScrapedListingStatus,
  normalizeScrapedListingStatus,
  resolveProspectingReviewState,
} from './prospecting-status';

test('normalizeScrapedListingStatus uppercases and trims', () => {
  assert.equal(normalizeScrapedListingStatus(' imported '), 'IMPORTED');
  assert.equal(normalizeScrapedListingStatus(null), '');
});

test('isOpenScrapedListingStatus accepts NEW and REVIEWING', () => {
  assert.equal(isOpenScrapedListingStatus('new'), true);
  assert.equal(isOpenScrapedListingStatus('REVIEWING'), true);
  assert.equal(isOpenScrapedListingStatus('IMPORTED'), false);
});

test('resolveProspectingReviewState prioritizes prospect terminal state', () => {
  assert.equal(resolveProspectingReviewState({ listingStatus: 'NEW', prospectStatus: 'accepted' }), 'accepted');
  assert.equal(resolveProspectingReviewState({ listingStatus: 'IMPORTED', prospectStatus: 'rejected' }), 'rejected');
  assert.equal(resolveProspectingReviewState({ listingStatus: 'NEW', prospectStatus: 'new' }), 'new');
});
