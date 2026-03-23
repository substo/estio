import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveListingStatusForRelevance } from './listing-scraper';

test('non-real-estate rows are always SKIPPED unless terminal business states must be preserved', () => {
    assert.equal(resolveListingStatusForRelevance('NEW', false), 'SKIPPED');
    assert.equal(resolveListingStatusForRelevance('REVIEWING', false), 'SKIPPED');
    assert.equal(resolveListingStatusForRelevance('SKIPPED', false), 'SKIPPED');
    assert.equal(resolveListingStatusForRelevance('IMPORTED', false), 'IMPORTED');
    assert.equal(resolveListingStatusForRelevance('REJECTED', false), 'REJECTED');
});

test('real-estate rows recover from SKIPPED into NEW', () => {
    assert.equal(resolveListingStatusForRelevance('SKIPPED', true), 'NEW');
    assert.equal(resolveListingStatusForRelevance('NEW', true), 'NEW');
    assert.equal(resolveListingStatusForRelevance(undefined, true), 'NEW');
});
