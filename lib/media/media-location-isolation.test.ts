import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = process.cwd();
const read = (file: string) => fs.readFileSync(path.join(root, file), 'utf8');

test('MediaAsset has a stable indexed location tenancy boundary', () => {
  const schema = read('prisma/schema.prisma');
  const model = schema.slice(schema.indexOf('model MediaAsset {'), schema.indexOf('enum MediaAssetStatus'));
  assert.match(model, /locationId\s+String\s/);
  assert.match(model, /location\s+Location\s+@relation\(fields: \[locationId\]/);
  assert.match(model, /@@index\(\[locationId, status, deletedAt\]\)/);
});

test('migration backfills traceable media and only assigns orphans when one owner is unambiguous', () => {
  const migration = read('prisma/migrations/20260805140000_media_asset_location/migration.sql');
  assert.match(migration, /JOIN "PropertyMedia"/);
  assert.match(migration, /COUNT\(DISTINCT property\."locationId"\) = 1/);
  assert.match(migration, /IF media_location_count = 1 THEN/);
  assert.match(migration, /MediaAsset location backfill is ambiguous/);
  assert.match(migration, /ALTER COLUMN "locationId" SET NOT NULL/);
  assert.doesNotMatch(migration, /Down Town Cyprus|cmingx|cmsbhn/);
});

test('media list, expiry count, purge, and restore are location scoped', () => {
  const media = read('lib/media/media-assets.ts');
  assert.match(media, /listSoftDeletedAssets[\s\S]{0,1800}locationId: ownerLocationId[\s\S]{0,800}expiredTotal/);
  assert.match(media, /purgeExpiredMediaAssets[\s\S]{0,900}locationId: ownerLocationId/);
  assert.match(media, /restoreMediaAsset[\s\S]{0,500}where: \{ locationId: ownerLocationId, cloudflareImageId \}/);
  assert.match(media, /Media asset belongs to another location/);
});

test('media actions derive the active ADMIN location and accept no client location authority', () => {
  const actions = read('app/(main)/admin/settings/media/actions.ts');
  const client = read('app/(main)/admin/settings/media/media-trash-client.tsx');
  assert.match(actions, /getActiveContactsAccess\(\)/);
  assert.match(actions, /access\.role !== "ADMIN"/);
  assert.match(actions, /export async function listTrashedMediaAction\(\)/);
  assert.match(actions, /export async function purgeExpiredMediaAction\(\)/);
  assert.doesNotMatch(client, /locationId/);
  assert.match(client, /Purge expired \(\$\{expiredTotal\}\)/);
});

test('property save, deletion, and imports register media under their authoritative location', () => {
  const save = read('lib/properties/save-property-record.ts');
  const actions = read('app/(main)/admin/properties/actions.ts');
  const crm = read('lib/crm/crm-puller.ts');
  assert.match(save, /ensureMediaAssets\(input\.location\.id, validatedMediaItems\)/);
  assert.match(save, /softDeleteOrphanedAssets\(input\.location\.id,/);
  assert.match(actions, /softDeleteOrphanedAssets\(locationId, cfIdsToCheck\)/);
  assert.match(crm, /registerTemporaryMediaAssets\(locationId, processedImages\)/);
});
