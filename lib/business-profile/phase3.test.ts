import assert from 'node:assert/strict';
import test from 'node:test';
import { overlayBusinessDetails } from './overlay';
import { businessView } from './view';
import { applyDetailsPatch } from './patch';
import { brandProfileFromBusiness } from './brand';

const row = { locationId: 'l1', brandVoice: 'old voice', footerBio: 'old bio', primaryColor: '#000000', contactInfo: { address: 'old', mobile: '1', phone: 'legacy' },
    socialLinks: [{ platform: 'facebook', url: '' }], theme: { backgroundColor: '#ffffff', logo: { textTop: 'DOWN TOWN', textBottom: 'CYPRUS', url: '/old.png' }, primaryColor: '#000000' },
    navLinks: [{ label: 'Home', href: '/' }], substoSiteConfig: { title: 'Site', description: 'old', email: 'old@x.com', accent: '#000000', logoUrl: 'https://x/old.png' } };

test('without a profile the website row is unchanged', () => {
    assert.equal(overlayBusinessDetails(row, null), row);
});

test('with a profile, business fields come only from it and layout stays as stored', () => {
    const profile = applyDetailsPatch(null, { summary: 'We sell homes', email: 'a@b.com', address: 'Paphos', phones: [{ label: 'Mobile', number: '+357 99 123456' }, { label: 'Landline', number: '+357 26 000000' }],
        socialLinks: [{ platform: 'facebook', url: 'https://facebook.com/x' }], colours: { primary: '#9d0917' }, logos: { icon: 'https://cdn/icon.png' }, voice: { instructions: 'Be warm' } }, 'owner');
    const out = overlayBusinessDetails(row, businessView(profile, { name: 'Down Town Cyprus' }));
    assert.deepEqual(out.contactInfo, { address: 'Paphos', mobile: '+357 99 123456', landline: '+357 26 000000', email: 'a@b.com', mapsLink: '', mapsLinkTitle: '' });
    assert.deepEqual(out.socialLinks, [{ platform: 'facebook', url: 'https://facebook.com/x' }]);
    assert.equal(out.footerBio, 'We sell homes');
    assert.equal(out.brandVoice, 'Be warm');
    assert.equal(out.theme.primaryColor, '#9d0917'); assert.equal(out.primaryColor, '#9d0917'); assert.equal(out.theme.secondaryColor, null);
    // Logo text lines and other layout are untouched; an unknown primary logo does not resurface the stale one.
    assert.equal(out.theme.logo.textTop, 'DOWN TOWN'); assert.equal(out.theme.logo.textBottom, 'CYPRUS'); assert.equal(out.theme.backgroundColor, '#ffffff');
    assert.equal(out.theme.logo.url, ''); assert.equal(out.theme.logo.iconUrl, 'https://cdn/icon.png');
    assert.deepEqual(out.navLinks, row.navLinks);
    assert.equal(out.substoSiteConfig.title, 'Site'); assert.equal(out.substoSiteConfig.description, 'We sell homes'); assert.equal(out.substoSiteConfig.logoUrl, '');
});

test('the Studio brand profile is a view of the Business profile and needs a summary', () => {
    assert.equal(brandProfileFromBusiness(applyDetailsPatch(null, { email: 'a@b.com' }, 'owner')), null);
    const profile = applyDetailsPatch(null, { summary: 'Homes in Paphos', audience: 'Buyers', offer: 'Sales', voice: { tone: 'Warm', preferredWords: ['home'], avoidedWords: [], contentPillars: ['Local'] } }, 'owner');
    const brand = brandProfileFromBusiness(profile)!;
    assert.deepEqual(brand.profile, { summary: 'Homes in Paphos', audience: 'Buyers', offer: 'Sales', tone: 'Warm', useWords: ['home'], avoidWords: [], pillars: ['Local'] });
});
