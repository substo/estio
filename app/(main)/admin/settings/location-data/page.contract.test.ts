import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('./page.tsx', import.meta.url), 'utf8');
const actionSource = readFileSync(new URL('./actions.ts', import.meta.url), 'utf8');
const cardSource = readFileSync(new URL('./reset-analytics-card.tsx', import.meta.url), 'utf8');
const resetSource = readFileSync(new URL('../../../../../lib/analytics/reset.ts', import.meta.url), 'utf8');

test('location clear preview derives location and ADMIN role server-side', () => {
  assert.match(source, /getActiveContactsAccess\(\)/);
  assert.match(source, /access\.role !== 'ADMIN'/);
  assert.match(source, /selectLocationRows\(db, location\.id, LOCATION_CLEAR_MODELS\)/);
  assert.doesNotMatch(source, /searchParams/);
  assert.match(source, /locationId: location\.id/);
});

test('the full location preview remains read-only while analytics is separately scoped', () => {
  assert.match(source, /full location-data preview remains read-only/i);
  assert.match(source, /<ResetAnalyticsCard/);
  assert.doesNotMatch(source, /deleteMany|\.delete\(|\.update\(|\.create\(/);
});

test('the action accepts confirmation but no client location authority', () => {
  assert.match(actionSource, /formData\.get\('confirmation'\)/);
  assert.match(actionSource, /getActiveContactsAccess\(\)/);
  assert.doesNotMatch(actionSource, /formData\.get\(['"]locationId/);
  assert.match(actionSource, /revalidatePath\('\/admin\/analytics'\)/);
  assert.match(actionSource, /revalidatePath\('\/admin\/settings\/location-data'\)/);
});

test('the UI exposes an accessible destructive confirmation flow', () => {
  assert.match(cardSource, />Reset analytics<\/Button>/);
  assert.match(cardSource, /This deletion cannot be undone/);
  assert.match(cardSource, /RESET_ANALYTICS_CONFIRMATION/);
  assert.match(cardSource, /Permanently reset analytics/);
  assert.match(cardSource, /htmlFor="reset-analytics-confirmation"/);
  assert.match(cardSource, /role="alert"[\s\S]*aria-live="assertive"/);
  assert.match(cardSource, /role="status"[\s\S]*aria-live="polite"/);
  assert.match(cardSource, /disabled=\{pending\}/);
});

test('protected business data and existing audit history have no destructive path', () => {
  assert.doesNotMatch(resetSource, /(?:contact|property|aiUsage|settingsDocument)\.(?:delete|deleteMany|update|updateMany)/);
  assert.match(resetSource, /settingsAuditLog\.create/);
  assert.doesNotMatch(resetSource, /settingsAuditLog\.(?:delete|deleteMany|update|updateMany)/);
});
