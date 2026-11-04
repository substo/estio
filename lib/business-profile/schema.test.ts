import assert from 'node:assert/strict';
import test from 'node:test';
import { businessProfileSchema as schema } from './schema';
const at = '2026-11-04T10:00:00Z';
const source = { kind: 'url', url: 'https://example.com', retrievedAt: at };
export const known = <T>(value: T) => ({ status: 'known' as const, value, sources: [source], confirmedAt: at });
export const unknown = { status: 'unknown' as const, sources: [], confirmedAt: null };
export const na = { status: 'not_applicable' as const, reason: 'No public office', sources: [{ kind: 'owner' as const, ownerId: 'owner-1', suppliedAt: at }], confirmedAt: at };

test('versioned partial, unknown and not applicable profiles never invent values', () => {
    assert.deepEqual(schema.parse({ schemaVersion: 1 }), { schemaVersion: 1 });
    assert.ok(schema.safeParse({ schemaVersion: 1, contact: { email: unknown, address: na } }).success);
    assert.equal(schema.safeParse({ schemaVersion: 2 }).success, false);
    assert.equal(schema.safeParse({ schemaVersion: 1, identity: { summary: known(' ') } }).success, false);
    assert.equal(schema.safeParse({ schemaVersion: 1, contact: { email: { ...na, reason: '' } } }).success, false);
});
test('nested and repeated facts retain independent provenance and nullable confirmation', () => {
    const input = { schemaVersion: 1, contact: { address: known({ city: { ...known('Nicosia'), confirmedAt: null } }), phones: known([{ number: known('+35799123456'), label: unknown }]) }, visualIdentity: { logos: known([{ variant: known('primary'), url: known('https://example.com/logo.png') }]) } };
    assert.deepEqual(schema.parse(input), input);
    assert.equal(schema.safeParse({ ...input, contact: { address: known({ city: 'Nicosia' }) } }).success, false);
});
test('invalid provenance, timestamps and ambiguous states are rejected', () => {
    for (const bad of [
        { ...known('Name'), sources: [{ ...source, url: 'not a URL' }] },
        { ...known('Name'), sources: [{ ...source, url: 'javascript:alert(1)' }] },
        { ...known('Name'), sources: [{ ...source, url: 'https://user:pass@example.com' }] },
        { ...known('Name'), sources: [{ ...source, retrievedAt: 'yesterday' }] },
        { ...known('Name'), sources: [{ kind: 'owner', ownerId: '', suppliedAt: at }] },
        { ...known('Name'), confirmedAt: '2026-02-30T10:00:00Z' },
        { ...unknown, value: 'invented' },
    ]) assert.equal(schema.safeParse({ schemaVersion: 1, identity: { summary: bad } }).success, false);
});
test('structured contacts and opening hours validate formats and intervals', () => {
    const valid = { schemaVersion: 1, contact: { email: known('office@example.com'), openingHours: known([{ day: known('mon'), closed: known(false), intervals: known([{ opens: known('09:00'), closes: known('17:00') }]) }]) } };
    assert.ok(schema.safeParse(valid).success);
    for (const contact of [
        { email: known('bad') }, { phones: known([{ number: known('123') }]) },
        { address: known({ countryCode: known('Cyprus') }) },
        { openingHours: known([{ day: known('mon'), closed: known(true), intervals: known([{ opens: known('09:00'), closes: known('17:00') }]) }]) },
        { openingHours: known([{ day: known('mon'), closed: known(false), intervals: known([{ opens: known('25:00'), closes: known('08:00') }]) }]) },
        { openingHours: known([{ day: known('mon'), closed: known(false), intervals: known([{ opens: known('17:00'), closes: known('09:00') }]) }]) },
    ]) assert.equal(schema.safeParse({ schemaVersion: 1, contact }).success, false);
});
test('real estate supports multiple selections, other descriptions and priced segments', () => {
    assert.ok(schema.safeParse({ schemaVersion: 1, realEstate: known({ businessTypes: known([{ code: known('agency') }, { code: known('developer') }, { code: known('other'), otherDescription: known('Consultancy') }]), priceSegments: known([{ label: known('Premium'), currency: known('EUR'), min: known(500000) }]) }) }).success);
    for (const realEstate of [known({ businessTypes: known([{ code: known('other') }]) }), known({ priceSegments: known([{ min: known(100) }]) }), known({ priceSegments: known([{ min: known(100), max: known(10), currency: known('EUR') }]) })]) assert.equal(schema.safeParse({ schemaVersion: 1, realEstate }).success, false);
});

test('capture preserves every existing brand-profile field without confirming source retrieval', () => {
    const profile = schema.parse({ schemaVersion: 1,
        identity: { summary: known('Summary') }, offer: { description: known('Offer') },
        audienceMarket: { audience: known('Audience') },
        brandVoice: { instructions: known('Rendered voice'), tone: known('Tone'), preferredWords: known([known('clear')]), avoidedWords: known([known('hype')]), contentPillars: known([known('Advice')]) },
        brandProfileCapture: { answers: { competitors: { ...known('Other agencies'), confirmedAt: null } }, sources: [{ ...source, platform: 'website' }], scriptVersion: 'v1', updatedAt: at, updatedBy: 'owner-1' },
    });
    assert.equal(profile.brandProfileCapture?.answers.competitors.confirmedAt, null);
    assert.equal(profile.brandProfileCapture?.sources[0].kind, 'url');
});
test('overnight and closed hours and nested invalid provenance are handled', () => {
    assert.ok(schema.safeParse({ schemaVersion: 1, contact: { openingHours: known([
        { day: known('fri'), closed: known(false), intervals: known([{ opens: known('22:00'), closes: known('02:00'), closesNextDay: known(true) }]) },
        { day: known('sat'), closed: known(true), intervals: known([]) },
    ]) } }).success);
    assert.equal(schema.safeParse({ schemaVersion: 1, contact: { phones: known([{ number: { ...known('+35799123456'), sources: [{ ...source, retrievedAt: 'bad' }] } }]) } }).success, false);
});

test('business name and timezone remain exclusively on Location', () => {
    assert.equal(schema.safeParse({ schemaVersion: 1, identity: { displayName: known('Business') } }).success, false);
    assert.equal(schema.safeParse({ schemaVersion: 1, contact: { timeZone: known('Europe/Nicosia') } }).success, false);
});
