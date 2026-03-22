import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createEmptyDeepScrapeRunSummary,
  resolveProspectDeepDecision,
  countOmission,
  countErrorCategory,
  categorizeScrapeError,
  canTransitionDeepScrapeRunStatus,
  isDeepScrapeTerminalStatus,
  isQueuedRunStale,
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
  assert.equal(
    categorizeScrapeError(new Error('page.goto: Protocol error (Page.navigate): Cannot navigate to invalid URL /items/author/7938012/')),
    'extraction'
  );
  assert.equal(
    categorizeScrapeError(new Error('navigating to "/items/author/7938012/" failed')),
    'unknown'
  );
  assert.equal(categorizeScrapeError(new Error('unhandled runtime failure')), 'unknown');
});

test('run status transition guards accept only valid deep lifecycle transitions', () => {
  assert.equal(canTransitionDeepScrapeRunStatus('queued', 'running'), true);
  assert.equal(canTransitionDeepScrapeRunStatus('queued', 'failed'), true);
  assert.equal(canTransitionDeepScrapeRunStatus('running', 'completed'), true);
  assert.equal(canTransitionDeepScrapeRunStatus('running', 'partial'), true);
  assert.equal(canTransitionDeepScrapeRunStatus('running', 'cancelled'), true);

  assert.equal(canTransitionDeepScrapeRunStatus('completed', 'running'), false);
  assert.equal(canTransitionDeepScrapeRunStatus('failed', 'completed'), false);
  assert.equal(canTransitionDeepScrapeRunStatus('queued', 'completed'), false);
});

test('queued stale detection and terminal status detection remain deterministic', () => {
  const now = Date.parse('2026-03-22T12:00:00.000Z');
  assert.equal(
    isQueuedRunStale('2026-03-22T11:58:50.000Z', now, 60_000),
    true
  );
  assert.equal(
    isQueuedRunStale('2026-03-22T11:59:30.000Z', now, 60_000),
    false
  );

  assert.equal(isDeepScrapeTerminalStatus('completed'), true);
  assert.equal(isDeepScrapeTerminalStatus('failed'), true);
  assert.equal(isDeepScrapeTerminalStatus('cancelled'), true);
  assert.equal(isDeepScrapeTerminalStatus('queued'), false);
  assert.equal(isDeepScrapeTerminalStatus('running'), false);
});
