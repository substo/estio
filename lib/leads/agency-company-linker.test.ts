import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildCompanyLinkCandidates,
  COMPANY_LINK_MAX_CANDIDATES,
  COMPANY_LINK_PLAUSIBLE_CONFIDENCE_THRESHOLD,
  computeNameSimilarityScore,
  normalizePhoneForMatch,
  normalizeWebsiteHost,
  type ScrapedAgencyProfile,
} from './agency-company-linker';

test('normalizeWebsiteHost strips protocol, path, and www prefix', () => {
  assert.equal(normalizeWebsiteHost('https://www.Example.com/path?a=1'), 'example.com');
  assert.equal(normalizeWebsiteHost('example.com/office'), 'example.com');
  assert.equal(normalizeWebsiteHost(''), null);
});

test('normalizePhoneForMatch keeps digit/plus values with minimum length', () => {
  assert.equal(normalizePhoneForMatch('+357 99 123 456'), '+35799123456');
  assert.equal(normalizePhoneForMatch('(22) 11-22'), '221122');
  assert.equal(normalizePhoneForMatch('12345'), null);
});

test('computeNameSimilarityScore handles exact and similar names', () => {
  assert.equal(computeNameSimilarityScore('Cyprus Golden Properties Ltd', 'Cyprus Golden Properties'), 1);
  assert.ok(computeNameSimilarityScore('Cyprus Golden Properties', 'Golden Cyprus Property Group') >= 0.55);
  assert.ok(computeNameSimilarityScore('Alpha Estates', 'Zen Marine Developers') < 0.55);
});

test('buildCompanyLinkCandidates ranks deterministic website matches highest', () => {
  const profile: ScrapedAgencyProfile = {
    name: 'Sunrise Realty',
    website: 'sunrise.com',
    phone: '+35799123456',
    email: 'hello@sunrise.com',
  };

  const candidates = buildCompanyLinkCandidates(profile, [
    { id: 'sim', name: 'Sunrise Property Group', website: null, phone: null, email: null },
    { id: 'email', name: 'Sunrise CRM', website: null, phone: null, email: 'hello@sunrise.com' },
    { id: 'website', name: 'Sunrise Realty', website: 'https://www.sunrise.com', phone: '+35799123456', email: null },
  ]);

  assert.equal(candidates.length, 3);
  assert.equal(candidates[0]?.companyId, 'website');
  assert.equal(candidates[0]?.matchType, 'website');
  assert.ok((candidates[0]?.confidence || 0) > (candidates[1]?.confidence || 0));
});

test('buildCompanyLinkCandidates includes similar-name fallback at plausible threshold', () => {
  const profile: ScrapedAgencyProfile = {
    name: 'Blue Reef Estates',
    website: null,
    phone: null,
    email: null,
  };

  const candidates = buildCompanyLinkCandidates(profile, [
    { id: 'close', name: 'Blue Reef Estate Group', website: null, phone: null, email: null },
    { id: 'far', name: 'Mountain Homes Ltd', website: null, phone: null, email: null },
  ]);

  assert.equal(candidates.length, 1);
  assert.equal(candidates[0]?.companyId, 'close');
  assert.equal(candidates[0]?.matchType, 'similar_name');
  assert.ok((candidates[0]?.confidence || 0) >= COMPANY_LINK_PLAUSIBLE_CONFIDENCE_THRESHOLD);
});

test('buildCompanyLinkCandidates caps output list to max candidates', () => {
  const profile: ScrapedAgencyProfile = {
    name: 'Alpha Agency',
    website: null,
    phone: null,
    email: null,
  };

  const companies = Array.from({ length: COMPANY_LINK_MAX_CANDIDATES + 4 }, (_, index) => ({
    id: `cmp_${index}`,
    name: `Alpha Agency ${index}`,
    website: null,
    phone: null,
    email: null,
  }));

  const candidates = buildCompanyLinkCandidates(profile, companies);
  assert.equal(candidates.length, COMPANY_LINK_MAX_CANDIDATES);
});
