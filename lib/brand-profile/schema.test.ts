import assert from 'node:assert/strict';
import test from 'node:test';
import { brandProfileInputSchema, brandProfileSchema, renderBrandVoice } from './schema';
const input = { answers: { name: 'Example' }, sources: [], profile: { summary: 'Example business', audience: 'Creators', offer: 'Editing', tone: 'Friendly', useWords: ['clear'], avoidWords: ['hype'], pillars: ['How-to'] }, scriptVersion: 'v1' };
test('profile validates bounded answers and renders the shared CRM voice', () => {
    const parsed = brandProfileInputSchema.parse(input);
    assert.match(renderBrandVoice(parsed.profile), /Audience: Creators/);
    assert.match(renderBrandVoice(parsed.profile), /Avoid: hype/);
    assert.equal(brandProfileSchema.safeParse(input).success, false);
});
test('rejects unbounded answers, unsupported scripts and malformed provenance', () => {
    assert.equal(brandProfileInputSchema.safeParse({ ...input, answers: { name: 'x'.repeat(4001) } }).success, false);
    assert.equal(brandProfileInputSchema.safeParse({ ...input, scriptVersion: 'v2' }).success, false);
    assert.equal(brandProfileInputSchema.safeParse({ ...input, sources: [{ url: 'invalid', fetchedAt: 'today' }] }).success, false);
});
