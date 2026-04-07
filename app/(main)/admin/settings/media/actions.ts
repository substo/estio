"use server";

import { currentUser } from "@clerk/nextjs/server";
import { verifyUserHasAccessToLocation } from "@/lib/auth/permissions";
import {
  listSoftDeletedAssets,
  purgeExpiredMediaAssets,
  restoreMediaAsset,
  MEDIA_ASSET_RETENTION_DAYS,
} from "@/lib/media/media-assets";

/**
 * Lists all soft-deleted (trashed) media assets for the admin UI.
 */
export async function listTrashedMediaAction(locationId: string) {
  const user = await currentUser();
  if (!user) throw new Error("Unauthorized");

  const hasAccess = await verifyUserHasAccessToLocation(user.id, locationId);
  if (!hasAccess) throw new Error("Unauthorized: Access Denied");

  const { assets, total } = await listSoftDeletedAssets({ take: 100 });

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
    retentionDays: MEDIA_ASSET_RETENTION_DAYS,
  };
}

/**
 * Purges all soft-deleted assets that have passed the retention period.
 * Calls Cloudflare API to delete the physical file, then removes DB record.
 */
export async function purgeExpiredMediaAction(locationId: string) {
  const user = await currentUser();
  if (!user) throw new Error("Unauthorized");

  const hasAccess = await verifyUserHasAccessToLocation(user.id, locationId);
  if (!hasAccess) throw new Error("Unauthorized: Access Denied");

  const result = await purgeExpiredMediaAssets();

  return {
    success: true,
    ...result,
  };
}

/**
 * Restores a soft-deleted media asset back to ACTIVE status.
 */
export async function restoreMediaAssetAction(
  locationId: string,
  cloudflareImageId: string
) {
  const user = await currentUser();
  if (!user) throw new Error("Unauthorized");

  const hasAccess = await verifyUserHasAccessToLocation(user.id, locationId);
  if (!hasAccess) throw new Error("Unauthorized: Access Denied");

  await restoreMediaAsset(cloudflareImageId);

  return { success: true };
}
