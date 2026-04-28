/**
 * Centralized Media Asset Management
 *
 * Provides reference-counted image tracking with soft-delete and retention.
 * Every Cloudflare image is registered in the `MediaAsset` table.  When the
 * last PropertyMedia reference to it is removed, the asset is soft-deleted
 * (status → SOFT_DELETED, deletedAt set).  A separate "purge" action can
 * later hard-delete assets whose retention period has expired.
 */

import db from "@/lib/db";
import { deleteImage } from "@/lib/cloudflareImages";
import { MediaAssetStatus } from "@prisma/client";

// ─────────────────────────  Constants  ──────────────────────────

/** Default retention period before a soft-deleted asset can be purged (days). */
export const MEDIA_ASSET_RETENTION_DAYS = 30;

// ─────────────────────────  Ensure / Register  ──────────────────

/**
 * Ensures a `MediaAsset` row exists for each Cloudflare image in the incoming
 * media list.  If an asset was previously soft-deleted and is now being
 * re-attached, it is reactivated.
 */
export async function ensureMediaAssets(
  mediaItems: { url: string; cloudflareImageId?: string | null }[]
): Promise<void> {
  const cfIds = mediaItems
    .map((m) => m.cloudflareImageId)
    .filter((id): id is string => !!id);

  if (cfIds.length === 0) return;

  for (const cfId of cfIds) {
    const matchingItem = mediaItems.find(
      (m) => m.cloudflareImageId === cfId
    );
    await db.mediaAsset.upsert({
      where: { cloudflareImageId: cfId },
      create: {
        cloudflareImageId: cfId,
        url: matchingItem?.url ?? "",
        status: MediaAssetStatus.ACTIVE,
      },
      update: {
        // Re-activate if it was previously soft-deleted
        status: MediaAssetStatus.ACTIVE,
        deletedAt: null,
      },
    });
  }
}

/**
 * Registers Cloudflare images that were uploaded for a draft/import preview but
 * are not yet attached to a saved property. A later property save will call
 * ensureMediaAssets and reactivate them; abandoned previews stay eligible for
 * the normal media trash purge.
 */
export async function registerTemporaryMediaAssets(
  mediaItems: { url: string; cloudflareImageId?: string | null }[]
): Promise<void> {
  const cfIds = mediaItems
    .map((m) => m.cloudflareImageId)
    .filter((id): id is string => !!id);

  if (cfIds.length === 0) return;

  for (const cfId of cfIds) {
    const matchingItem = mediaItems.find(
      (m) => m.cloudflareImageId === cfId
    );
    await db.mediaAsset.upsert({
      where: { cloudflareImageId: cfId },
      create: {
        cloudflareImageId: cfId,
        url: matchingItem?.url ?? "",
        status: MediaAssetStatus.SOFT_DELETED,
        deletedAt: new Date(),
      },
      update: {
        url: matchingItem?.url ?? "",
        status: MediaAssetStatus.SOFT_DELETED,
        deletedAt: new Date(),
      },
    });
  }
}

// ────────────────────  Soft-Delete Orphaned Assets  ─────────────

/**
 * Given a set of Cloudflare image IDs that were *previously* attached to a
 * property but are no longer present in the new payload, checks each one
 * against all other `PropertyMedia` rows.  If no other property references
 * the image, the corresponding `MediaAsset` is soft-deleted.
 *
 * @param removedCloudflareIds  Cloudflare image IDs that were removed from
 *                              the current property during this save.
 */
export async function softDeleteOrphanedAssets(
  removedCloudflareIds: string[]
): Promise<{ softDeleted: string[] }> {
  const softDeleted: string[] = [];

  for (const cfId of removedCloudflareIds) {
    // Count how many PropertyMedia rows still reference this image
    const refCount = await db.propertyMedia.count({
      where: { cloudflareImageId: cfId },
    });

    if (refCount === 0) {
      // No property uses this image any more → soft-delete
      await db.mediaAsset.upsert({
        where: { cloudflareImageId: cfId },
        create: {
          cloudflareImageId: cfId,
          url: "",
          status: MediaAssetStatus.SOFT_DELETED,
          deletedAt: new Date(),
        },
        update: {
          status: MediaAssetStatus.SOFT_DELETED,
          deletedAt: new Date(),
        },
      });
      softDeleted.push(cfId);
    }
  }

  if (softDeleted.length > 0) {
    console.log(
      `[MediaAssets] Soft-deleted ${softDeleted.length} orphaned asset(s):`,
      softDeleted
    );
  }

  return { softDeleted };
}

// ─────────────────────  Diff Helper  ────────────────────────────

/**
 * Computes which Cloudflare image IDs were removed between the old and new
 * media sets for a property.
 */
export function computeRemovedCloudflareIds(
  oldMedia: { cloudflareImageId?: string | null }[],
  newMedia: { cloudflareImageId?: string | null }[]
): string[] {
  const oldIds = new Set(
    oldMedia
      .map((m) => m.cloudflareImageId)
      .filter((id): id is string => !!id)
  );
  const newIds = new Set(
    newMedia
      .map((m) => m.cloudflareImageId)
      .filter((id): id is string => !!id)
  );

  return Array.from(oldIds).filter((id) => !newIds.has(id));
}

// ─────────────────────  Purge / Hard-Delete  ────────────────────

/**
 * Permanently deletes MediaAssets whose soft-delete retention period has
 * expired.  Calls the Cloudflare Images API to remove the physical file,
 * then removes the DB record.
 *
 * @param retentionDays  Number of days after soft-delete before purging.
 *                       Defaults to `MEDIA_ASSET_RETENTION_DAYS` (30).
 * @returns Stats about the operation.
 */
export async function purgeExpiredMediaAssets(
  retentionDays: number = MEDIA_ASSET_RETENTION_DAYS
): Promise<{
  purgedCount: number;
  failedCount: number;
  errors: { cloudflareImageId: string; error: string }[];
}> {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - retentionDays);

  const expired = await db.mediaAsset.findMany({
    where: {
      status: MediaAssetStatus.SOFT_DELETED,
      deletedAt: { lte: cutoff },
    },
    take: 100, // Process in batches to avoid timeout
  });

  let purgedCount = 0;
  let failedCount = 0;
  const errors: { cloudflareImageId: string; error: string }[] = [];

  for (const asset of expired) {
    try {
      // 1. Delete from Cloudflare
      await deleteImage(asset.cloudflareImageId);

      // 2. Hard-delete the DB record
      await db.mediaAsset.delete({
        where: { id: asset.id },
      });

      purgedCount++;
      console.log(
        `[MediaAssets] Purged asset ${asset.cloudflareImageId}`
      );
    } catch (err: any) {
      failedCount++;
      const message = err?.message || "Unknown error";
      errors.push({ cloudflareImageId: asset.cloudflareImageId, error: message });
      console.error(
        `[MediaAssets] Failed to purge asset ${asset.cloudflareImageId}:`,
        message
      );
    }
  }

  return { purgedCount, failedCount, errors };
}

// ─────────────────────  Listing  ────────────────────────────────

/**
 * Returns soft-deleted MediaAssets for the admin "Trash" view.
 */
export async function listSoftDeletedAssets(options?: {
  take?: number;
  skip?: number;
}): Promise<{
  assets: Awaited<ReturnType<typeof db.mediaAsset.findMany>>;
  total: number;
}> {
  const [assets, total] = await Promise.all([
    db.mediaAsset.findMany({
      where: { status: MediaAssetStatus.SOFT_DELETED },
      orderBy: { deletedAt: "asc" },
      take: options?.take ?? 50,
      skip: options?.skip ?? 0,
    }),
    db.mediaAsset.count({
      where: { status: MediaAssetStatus.SOFT_DELETED },
    }),
  ]);

  return { assets, total };
}

/**
 * Restores a soft-deleted asset back to ACTIVE status.
 */
export async function restoreMediaAsset(cloudflareImageId: string): Promise<void> {
  await db.mediaAsset.update({
    where: { cloudflareImageId },
    data: {
      status: MediaAssetStatus.ACTIVE,
      deletedAt: null,
    },
  });
  console.log(`[MediaAssets] Restored asset ${cloudflareImageId}`);
}
