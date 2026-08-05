"use server";

import { getActiveContactsAccess } from "@/lib/contacts/active-location-access";
import {
  listSoftDeletedAssets,
  purgeExpiredMediaAssets,
  restoreMediaAsset,
  MEDIA_ASSET_RETENTION_DAYS,
} from "@/lib/media/media-assets";

async function requireMediaAdminLocation() {
  const access = await getActiveContactsAccess();
  if (!access || access.role !== "ADMIN") throw new Error("Unauthorized: ADMIN access required");
  return access.locationId;
}

/**
 * Lists all soft-deleted (trashed) media assets for the admin UI.
 */
export async function listTrashedMediaAction() {
  const locationId = await requireMediaAdminLocation();

  const { assets, total, expiredTotal } = await listSoftDeletedAssets({
    locationId,
    take: 100,
    retentionDays: MEDIA_ASSET_RETENTION_DAYS,
  });

  return {
    assets: assets.map((a) => ({
      id: a.id,
      cloudflareImageId: a.cloudflareImageId,
      url: a.url,
      deletedAt: a.deletedAt?.toISOString() ?? null,
      retentionDays: MEDIA_ASSET_RETENTION_DAYS,
      expiresAt: a.deletedAt
        ? new Date(
            a.deletedAt.getTime() +
              MEDIA_ASSET_RETENTION_DAYS * 24 * 60 * 60 * 1000
          ).toISOString()
        : null,
    })),
    total,
    expiredTotal,
    retentionDays: MEDIA_ASSET_RETENTION_DAYS,
  };
}

/**
 * Purges all soft-deleted assets that have passed the retention period.
 * Calls Cloudflare API to delete the physical file, then removes DB record.
 */
export async function purgeExpiredMediaAction() {
  const locationId = await requireMediaAdminLocation();

  const result = await purgeExpiredMediaAssets(locationId);

  return {
    success: true,
    ...result,
  };
}

/**
 * Restores a soft-deleted media asset back to ACTIVE status.
 */
export async function restoreMediaAssetAction(
  cloudflareImageId: string
) {
  const locationId = await requireMediaAdminLocation();

  await restoreMediaAsset(locationId, cloudflareImageId);

  return { success: true };
}
