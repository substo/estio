/**
 * Backfill Cloudflare Images
 *
 * One-time script to migrate PropertyMedia records that have
 * cloudflareImageId = null (i.e. hotlinked external URLs) to Cloudflare Images.
 *
 * Usage: node scripts/backfill-cloudflare-images.js
 */

const { PrismaClient } = require('@prisma/client');
require('dotenv').config({ path: '.env.local' });

const db = new PrismaClient();
const BATCH_SIZE = 10;
const DELAY_BETWEEN_UPLOADS_MS = 300;
const DELAY_BETWEEN_BATCHES_MS = 2000;

const CF_ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID;
const CF_TOKEN = process.env.CLOUDFLARE_IMAGES_API_TOKEN;
const CF_ACCOUNT_HASH = process.env.NEXT_PUBLIC_CLOUDFLARE_IMAGES_ACCOUNT_HASH;

function getDeliveryUrl(imageId, variant = 'public') {
  return `https://imagedelivery.net/${CF_ACCOUNT_HASH}/${imageId}/${variant}`;
}

async function uploadUrlToCF(url) {
  const formData = new FormData();
  formData.append('url', url);

  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/images/v1`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${CF_TOKEN}` },
      body: formData,
    }
  );

  const data = await response.json();
  if (!data.success) {
    throw new Error(data.errors?.[0]?.message || 'Cloudflare upload failed');
  }
  return data.result.id;
}

async function backfill() {
  if (!CF_ACCOUNT_ID || !CF_TOKEN || !CF_ACCOUNT_HASH) {
    console.error('❌ Missing Cloudflare env vars (CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_IMAGES_API_TOKEN, NEXT_PUBLIC_CLOUDFLARE_IMAGES_ACCOUNT_HASH)');
    process.exit(1);
  }

  const orphanedMedia = await db.propertyMedia.findMany({
    where: { cloudflareImageId: null, kind: 'IMAGE' },
    orderBy: { sortOrder: 'asc' },
  });

  console.log(`\n🔍 Found ${orphanedMedia.length} PropertyMedia records with null cloudflareImageId.\n`);

  if (orphanedMedia.length === 0) {
    console.log('✅ Nothing to backfill.');
    return;
  }

  let succeeded = 0;
  let failed = 0;
  const failures = [];

  for (let batchStart = 0; batchStart < orphanedMedia.length; batchStart += BATCH_SIZE) {
    const batch = orphanedMedia.slice(batchStart, batchStart + BATCH_SIZE);
    const batchNum = Math.floor(batchStart / BATCH_SIZE) + 1;
    const totalBatches = Math.ceil(orphanedMedia.length / BATCH_SIZE);

    console.log(`\n📦 Batch ${batchNum}/${totalBatches} (${batch.length} images)...`);

    for (const media of batch) {
      try {
        const imageId = await uploadUrlToCF(media.url);
        const deliveryUrl = getDeliveryUrl(imageId);

        await db.propertyMedia.update({
          where: { id: media.id },
          data: { cloudflareImageId: imageId, url: deliveryUrl },
        });

        succeeded++;
        console.log(`  ✅ ${media.id} -> ${imageId}`);
      } catch (error) {
        failed++;
        const errorMsg = error?.message || 'Unknown error';
        failures.push({ id: media.id, url: media.url, error: errorMsg });
        console.warn(`  ❌ ${media.id}: ${errorMsg}`);
      }

      await new Promise((r) => setTimeout(r, DELAY_BETWEEN_UPLOADS_MS));
    }

    if (batchStart + BATCH_SIZE < orphanedMedia.length) {
      console.log(`  ⏳ Batch delay...`);
      await new Promise((r) => setTimeout(r, DELAY_BETWEEN_BATCHES_MS));
    }
  }

  console.log(`\n${'='.repeat(50)}`);
  console.log(`📊 Summary: ${succeeded} succeeded, ${failed} failed out of ${orphanedMedia.length}`);
  console.log(`${'='.repeat(50)}`);

  if (failures.length > 0) {
    console.log(`\n⚠️  Failed (need manual review):`);
    for (const f of failures) {
      console.log(`   - ${f.id}: ${f.url} — ${f.error}`);
    }
  }

  console.log('\n✅ Backfill complete.');
}

backfill()
  .catch((e) => { console.error('❌ Backfill failed:', e); process.exit(1); })
  .finally(() => db.$disconnect());
