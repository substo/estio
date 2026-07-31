import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = process.cwd();
const read = (file: string) => fs.readFileSync(path.join(root, file), 'utf8');
const triage = read('app/(main)/admin/prospecting/_components/prospecting-triage-view.tsx');
const listingCard = read('app/(main)/admin/prospecting/_components/listing-feed-card.tsx');
const contactCard = read('app/(main)/admin/prospecting/_components/contact-feed-card.tsx');
const listingPanel = read('app/(main)/admin/prospecting/_components/prospect-detail-panel.tsx');
const contactPanel = read('app/(main)/admin/prospecting/_components/contact-detail-panel.tsx');
const actions = read('app/(main)/admin/prospecting/actions.ts');

test('client seller-scrape payloads match the location assertion action signature', () => {
  assert.match(listingPanel, /scrapeSellerProfile\(\s*listing\.locationId,/);
  assert.match(contactPanel, /scrapeSellerProfile\(\s*locationId,/);
});

test('changed triage controls expose heading, state announcements, names, and narrow layout', () => {
  assert.match(triage, /<h1 className="sr-only">Prospecting intake<\/h1>/);
  assert.match(triage, /role="status" aria-live="polite"/);
  assert.match(triage, /flex-col overflow-hidden md:flex-row/);
  assert.match(triage, /await bulkAcceptListings\(selectedBulkIds\)/);
  assert.match(triage, /await bulkReject\(selectedBulkIds\)/);
  assert.match(triage, /currentView === 'properties' && \([\s\S]*aria-label="Accept selected listings"/);
  assert.match(triage, /aria-label=\{`Reject selected /);
  assert.match(triage, /aria-label=\{`Select all rendered /);
});

test('contacts omit bulk accept while preserving bulk reject and listing bulk accept', () => {
  assert.doesNotMatch(actions, /export async function bulkAccept\(/);
  assert.doesNotMatch(triage, /\bbulkAccept\b/);
  assert.match(triage, /currentView === 'properties'[\s\S]*bulkAcceptListings\(selectedBulkIds\)/);
  assert.match(triage, /currentView === 'properties'[\s\S]*bulkRejectListings\(selectedBulkIds\)[\s\S]*bulkReject\(selectedBulkIds\)/);
});

test('select-all checkbox exposes truthful partial and complete selection labels', () => {
  assert.match(triage, /const allRenderedSelected = feedItems\.length > 0 && feedItems\.every/);
  assert.match(triage, /allRenderedSelected\s*\? `Deselect all \$\{bulkItemLabel\}`\s*: `Select all rendered \$\{bulkItemLabel\}`/);
  assert.match(triage, /checked=\{allRenderedSelected\}/);
  assert.match(triage, /aria-label=\{selectAllLabel\}/);
  assert.match(triage, /title=\{selectAllLabel\}/);
});

test('feed cards use named native buttons and labeled independent checkboxes', () => {
  for (const source of [listingCard, contactCard]) {
    assert.match(source, /<button\s+type="button"/);
    assert.match(source, /aria-label=\{`Review /);
    assert.match(source, /<Checkbox[\s\S]*aria-label=\{`Select /);
    assert.match(source, /focus-visible:ring-2/);
  }
});

test('listing detail navigation and image controls use native named buttons', () => {
  assert.match(listingPanel, /<button\s+type="button"\s+className="font-semibold text-left/);
  assert.match(listingPanel, /aria-label="Open full-size listing image"/);
  assert.match(listingPanel, /aria-label="Delete prospect"/);
});
