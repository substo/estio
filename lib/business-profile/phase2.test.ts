import assert from 'node:assert/strict';
import test from 'node:test';
import { applyDetailsPatch } from './patch';
import { businessView } from './view';
import { profileFromLegacy } from './copy';

const now = new Date('2026-11-04T12:00:00Z');

test('owner edits become confirmed facts; unchanged values keep their provenance; empty removes', () => {
    const copied = profileFromLegacy({ publicSite: { contactInfo: { email: 'hi@example.com', address: '1 Main St' } } }).profile;
    assert.equal(copied.contact?.email?.confirmedAt, null);
    const next = applyDetailsPatch(copied, { email: 'hi@example.com', address: '2 High St', tagline: 'We sell homes', phones: [{ label: 'Office', number: '+357 22 123456' }] }, 'user-1', now);
    assert.equal(next.contact?.email?.confirmedAt, null, 'unchanged email keeps its unconfirmed copied fact');
    assert.equal(next.identity?.tagline?.confirmedAt, now.toISOString());
    assert.deepEqual(next.identity?.tagline?.sources, [{ kind: 'owner', ownerId: 'user-1', suppliedAt: now.toISOString() }]);
    const view = businessView(next, { name: 'Acme', timeZone: 'Europe/Nicosia', domain: 'acme.com' });
    assert.equal(view.address, '2 High St'); assert.deepEqual(view.phones, [{ label: 'Office', number: '+357 22 123456' }]); assert.equal(view.name, 'Acme');
    const cleared = applyDetailsPatch(next, { tagline: '', phones: [] }, 'user-1', now);
    assert.equal(cleared.identity?.tagline, undefined); assert.equal(cleared.contact?.phones, undefined);
});

test('logos, colours, voice and market patch partially and render brand voice', () => {
    const p = applyDetailsPatch(null, { logos: { primary: 'https://cdn.example.com/logo.png' }, colours: { primary: '#123456' }, summary: 'Agency in Limassol',
        voice: { tone: 'Warm', preferredWords: ['home'] }, market: { countryCode: 'cy', supportedLanguages: ['en', 'el'] } }, 'u', now);
    const again = applyDetailsPatch(p, { colours: { accent: '#ff0000' } }, 'u', now);
    const view = businessView(again, {});
    assert.deepEqual(view.colours, { primary: '#123456', secondary: null, accent: '#ff0000' });
    assert.equal(view.logos.primary, 'https://cdn.example.com/logo.png');
    assert.equal(view.market.countryCode, 'CY'); assert.deepEqual(view.market.supportedLanguages, ['en', 'el']);
    assert.equal(view.brandVoice, 'Summary: Agency in Limassol\nTone: Warm\nUse: home');
    assert.equal(businessView(applyDetailsPatch(again, { voice: { instructions: 'Be brief.' } }, 'u', now), {}).brandVoice, 'Be brief.');
});

test('the view shows only known facts and never takes name or time zone from the profile', () => {
    const view = businessView({ schemaVersion: 1, contact: { email: { status: 'unknown', sources: [], confirmedAt: null } } }, { name: ' Acme ', timeZone: null });
    assert.equal(view.email, null); assert.equal(view.name, 'Acme'); assert.equal(view.timeZone, null); assert.equal(view.brandVoice, null);
});

test('the copy prefers settings documents, skips demo placeholders and junk, and never confirms', () => {
    const r = profileFromLegacy({
        publicSite: { contactInfo: { address: '123 Makariou Avenue, Limassol 3030, Cyprus', mobile: '+357 99 765432', landline: 'n/a', email: 'office@agency.cy', mapsLink: '#' },
            theme: { primaryColor: '#abc', logo: { url: '/uploads/logo.png', faviconUrl: 'https://cdn.agency.cy/f.ico' } }, marketProfile: { countryCode: 'cy', serviceAreas: [{ id: 'lim', label: 'Limassol', kind: 'city' }] } },
        navigation: { socialLinks: [{ platform: 'instagram', url: 'https://instagram.com/agency' }, { platform: 'x', url: 'agency' }], footerBio: 'Trusted since 1990.' },
        siteConfig: { contactInfo: { email: 'old@agency.cy' }, primaryColor: '#000000' },
    });
    const view = businessView(r.profile, {});
    assert.equal(view.address, null); assert.equal(view.email, 'office@agency.cy'); assert.deepEqual(view.phones, [{ label: 'Mobile', number: '+357 99 765432' }]);
    assert.equal(view.colours.primary, '#aabbcc'); assert.equal(view.logos.primary, null); assert.equal(view.logos.favicon, 'https://cdn.agency.cy/f.ico');
    assert.deepEqual(view.socialLinks, [{ platform: 'instagram', url: 'https://instagram.com/agency' }]); assert.equal(view.summary, 'Trusted since 1990.');
    assert.equal(view.market.serviceAreas[0].label, 'Limassol'); assert.equal(r.profile.contact?.email?.confirmedAt, null);
    assert.deepEqual(r.skipped.map(s => s.reason).sort(), ['not a full web address', 'not a full web address', 'not a phone number', 'website demo placeholder'].sort());
});

test('a Studio brand profile maps to summary, offer, audience and voice, and wins over the footer text', () => {
    const r = profileFromLegacy({ navigation: { footerBio: 'Footer text' }, ai: { brandVoice: 'rendered', brandProfile: { answers: { offer: 'Homes' }, sources: [], scriptVersion: 'v1',
        updatedAt: '2026-11-01T00:00:00.000Z', updatedBy: 'u', profile: { summary: 'Boutique agency', audience: 'Buyers', offer: 'Sales', tone: 'Calm', useWords: ['home'], avoidWords: [], pillars: ['Local'] } } } });
    const view = businessView(r.profile, {});
    assert.equal(view.summary, 'Boutique agency'); assert.equal(view.offer, 'Sales'); assert.equal(view.audience, 'Buyers'); assert.deepEqual(view.voice.contentPillars, ['Local']);
    assert.equal(view.voice.instructions, null); assert.equal(r.profile.brandProfileCapture?.answers.offer.status, 'known');
    assert.ok(r.skipped.some(s => s.field === 'footer bio'));
});
