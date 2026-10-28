import assert from 'node:assert/strict';
import test from 'node:test';
import { usagePeriodStarts } from './usage-periods';

test('UTC boundaries survive year rollover and offset timestamps', () => {
    const result = usagePeriodStarts(new Date('2027-01-01T01:00:00+02:00'));
    assert.equal(result.startOfMonth.toISOString(), '2026-12-01T00:00:00.000Z');
    assert.equal(result.startOfToday.toISOString(), '2026-12-31T00:00:00.000Z');
    assert.equal(result.endOfToday.toISOString(), '2027-01-01T00:00:00.000Z');
    assert.equal(result.endOfMonth.toISOString(), '2027-01-01T00:00:00.000Z');
});
test('month starts at UTC midnight including leap day', () => {
    const result = usagePeriodStarts(new Date('2028-02-29T23:59:59Z'));
    assert.equal(result.startOfMonth.toISOString(), '2028-02-01T00:00:00.000Z');
    assert.equal(result.startOfToday.toISOString(), '2028-02-29T00:00:00.000Z');
});
