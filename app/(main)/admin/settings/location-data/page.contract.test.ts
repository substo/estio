import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('./page.tsx', import.meta.url), 'utf8');

test('location clear preview derives location and ADMIN role server-side', () => {
  assert.match(source, /getActiveContactsAccess\(\)/);
  assert.match(source, /access\.role !== 'ADMIN'/);
  assert.match(source, /selectLocationRows\(db, location\.id, LOCATION_CLEAR_MODELS\)/);
  assert.doesNotMatch(source, /searchParams|locationId\s*:/);
});

test('first slice is read-only and exposes no erase control', () => {
  assert.match(source, /Preview only\. No erase action or mutation endpoint exists/);
  assert.doesNotMatch(source, /deleteMany|\.delete\(|\.update\(|\.create\(|<form|type="submit"/);
});
