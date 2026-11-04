import assert from 'node:assert/strict';
import test from 'node:test';
import { getBusinessProfileCompleteness as completeness } from './completeness';
import { businessProfileSchema } from './schema';
const at = '2026-11-04T10:00:00Z';
const k = (value: unknown): any => ({ status: 'known', value, sources: [], confirmedAt: at });
const na = { status: 'not_applicable', reason: 'Not used', sources: [], confirmedAt: at };
const complete = () => businessProfileSchema.parse({ schemaVersion: 1, identity: { summary: k('Summary') }, contact: { email: na }, onlinePresence: { website: na }, offer: { description: k('Services') }, audienceMarket: { audience: k('Owners'), serviceAreas: k([{ label: k('Cyprus') }]) }, brandVoice: { tone: k('Clear') }, realEstate: k({ businessTypes: k([{ code: k('agency') }]), services: na, propertyCategories: na, transactionFocus: na }) });
test('partial profiles report essentials by section; Substo excludes real estate', () => {
    const result = completeness({ schemaVersion: 1 }, 'substo');
    assert.equal(result.complete, false);
    assert.equal('realEstate' in result.sections, false);
    assert.deepEqual(result.sections.contact, [{ path: 'contact.email', reason: 'missing' }]);
    assert.equal(completeness({ schemaVersion: 1 }, 'estio').sections.realEstate.length, 4);
});
test('complete and confirmed not-applicable profiles are accepted for each app', () => {
    assert.equal(completeness(complete(), 'estio').complete, true);
    const profile = complete(); delete profile.realEstate;
    assert.equal(completeness(profile, 'substo').complete, true);
    assert.equal(completeness(profile, 'estio').complete, false);
    profile.realEstate = businessProfileSchema.parse({ schemaVersion: 1, realEstate: na }).realEstate;
    assert.equal(completeness(profile, 'estio').complete, true);
});
test('retrieval is not confirmation; unknown, empty and repeated nested facts are inspected', () => {
    const profile = complete();
    profile.audienceMarket!.serviceAreas = k([{ label: { ...k('Cyprus'), sources: [{ kind: 'url', url: 'https://example.com', retrievedAt: at }], confirmedAt: null } }]);
    assert.deepEqual(completeness(profile, 'substo').sections.audienceMarket, [{ path: 'audienceMarket.serviceAreas.0.label', reason: 'unconfirmed' }]);
    profile.contact!.email = { status: 'unknown', sources: [], confirmedAt: null };
    assert.equal(completeness(profile, 'substo').sections.contact[0].reason, 'missing');
    profile.audienceMarket!.serviceAreas = k([]);
    assert.equal(completeness(profile, 'substo').sections.audienceMarket[0].reason, 'missing');
    profile.contact!.email = { ...na, confirmedAt: null } as any;
    assert.equal(completeness(profile, 'substo').sections.contact[0].reason, 'unconfirmed');
});
