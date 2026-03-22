import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createEmptyDeepScrapeRunSummary,
  resolveProspectDeepDecision,
  countOmission,
  countErrorCategory,
  categorizeScrapeError,
} from './deep-scrape-types.ts';

test('resolveProspectDeepDecision respects manual overrides', () => {
  assert.equal(
    resolveProspectDeepDecision({ isAgency: false, confidence: 95, manualOverride: true }),
    'agency'
  );
  assert.equal(
    resolveProspectDeepDecision({ isAgency: true, confidence: 95, manualOverride: false }),
    'private'
  );
});

test('resolveProspectDeepDecision uses confidence threshold for AI decisions', () => {
  assert.equal(
    resolveProspectDeepDecision({ isAgency: false, confidence: 80, manualOverride: null }),
    'private'
  );
  assert.equal(
    resolveProspectDeepDecision({ isAgency: true, confidence: 80, manualOverride: null }),
    'agency'
  );
  assert.equal(
    resolveProspectDeepDecision({ isAgency: false, confidence: 55, manualOverride: null }),
    'uncertain'
  );
  assert.equal(
    resolveProspectDeepDecision({ isAgency: null, confidence: null, manualOverride: null }),
    'uncertain'
  );
});

test('count helpers increment omission and error buckets deterministically', () => {
  const start = createEmptyDeepScrapeRunSummary();
  const withOmission = countOmission(start, 'missing_phone', 2);
  const withError = countErrorCategory(withOmission, 'network', 3);

  assert.equal(withError.omittedMissingPhone, 2);
  assert.equal(withError.errorsNetwork, 3);
  assert.equal(withError.errorsTotal, 3);
});

test('categorizeScrapeError maps common failures to stable categories', () => {
  assert.equal(categorizeScrapeError(new Error('session expired, auth required')), 'auth');
  assert.equal(categorizeScrapeError(new Error('network econnreset while fetch')), 'network');
  assert.equal(categorizeScrapeError(new Error('selector parse failed in extractor')), 'extraction');
  assert.equal(categorizeScrapeError(new Error('unhandled runtime failure')), 'unknown');
});
