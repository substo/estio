import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = process.cwd();
const actions = fs.readFileSync(path.join(root, 'app/(main)/admin/prospecting/actions.ts'), 'utf8');
const sellerScrape = fs.readFileSync(path.join(root, 'app/(main)/admin/prospecting/listings/_actions/seller-scrape.ts'), 'utf8');
const propertyImport = fs.readFileSync(path.join(root, 'lib/leads/property-import.ts'), 'utf8');

function functionSource(name: string): string {
  const start = actions.indexOf(`export async function ${name}`);
  assert.ok(start >= 0, `${name} must exist`);
  const next = actions.indexOf('\nexport async function ', start + 1);
  return actions.slice(start, next < 0 ? actions.length : next);
}

test('every directly exposed ID mutation resolves active access and scopes its target lookup', () => {
  for (const name of [
    'deleteProspect', 'acceptScrapedListing', 'rejectScrapedListing',
    'rejectProspectWithListings', 'acceptProspectWithListings',
    'getProspectCompanyLinkOptions', 'applyProspectCompanyLink', 'setProspectSellerTypeManual',
  ]) {
    const source = functionSource(name);
    assert.match(source, /getActiveProspectingAccess\(/, `${name} must resolve active location`);
    assert.match(source, /locationId: access\.locationId/, `${name} must scope its target to active location`);
  }
});

test('bulk actions reject mixed-location ID sets before invoking item mutations', () => {
  for (const name of ['bulkAccept', 'bulkReject', 'bulkAcceptListings', 'bulkRejectListings']) {
    const source = functionSource(name);
    const authorization = source.indexOf('requireAllRequestedIds');
    const mutation = Math.min(
      ...['acceptProspect(', 'rejectProspect(', 'acceptScrapedListing(', 'rejectScrapedListing(']
        .map((needle) => source.indexOf(needle)).filter((index) => index >= 0),
    );
    assert.ok(authorization >= 0 && mutation > authorization, `${name} must validate the complete set before mutations`);
  }
});

test('acceptance scopes related contact, listing, property import, and company targets', () => {
  assert.match(actions, /where: \{ id: prospect\.createdContactId, locationId: prospect\.locationId \}/);
  assert.match(actions, /where: \{ locationId: access\.locationId, status:/);
  assert.match(propertyImport, /prospectLeadId,\s+locationId,\s+prospectLead: \{ locationId \}/);
  assert.match(actions, /applyProspectCompanyLinkSelection\(\s*prospect\.id,\s*prospect\.locationId,/);
});

test('prospect deletion preserves and unlinks only same-location listings', () => {
  const source = functionSource('deleteProspect');
  assert.match(source, /scrapedListing\.updateMany\(\{\s+where: \{ prospectLeadId: id, locationId: access\.locationId \},\s+data: \{ prospectLeadId: null \}/);
  assert.ok(source.indexOf('scrapedListing.updateMany') < source.indexOf('prospectLead.deleteMany'));
});

test('seller scrape treats client location as an assertion and scopes prospect, connection, and task', () => {
  assert.match(sellerScrape, /getActiveProspectingAccess\(locationId\)/);
  assert.match(sellerScrape, /where: \{ id: prospectId, locationId: access\.locationId \}/);
  assert.match(sellerScrape, /locationId: access\.locationId,\s+platform: 'bazaraki',\s+enabled: true/);
  assert.match(sellerScrape, /data: \{\s+locationId: access\.locationId,/);
});
