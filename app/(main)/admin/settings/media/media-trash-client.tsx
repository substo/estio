"use client";

import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { CloudflareImage } from "@/components/media/CloudflareImage";
import { Trash2, RotateCcw, AlertTriangle, CheckCircle, Image as ImageIcon } from "lucide-react";
import { toast } from "sonner";
import {
  listTrashedMediaAction,
  purgeExpiredMediaAction,
  restoreMediaAssetAction,
} from "./actions";

interface TrashedAsset {
  id: string;
  cloudflareImageId: string;
  url: string;
  deletedAt: string | null;
  retentionDays: number;
  expiresAt: string | null;
}

export function MediaTrashClient({ locationId }: { locationId: string }) {
  const [assets, setAssets] = useState<TrashedAsset[]>([]);
  const [total, setTotal] = useState(0);
  const [retentionDays, setRetentionDays] = useState(30);
  const [loading, setLoading] = useState(true);
  const [purging, setPurging] = useState(false);
  const [restoringId, setRestoringId] = useState<string | null>(null);

  const loadAssets = useCallback(async () => {
    setLoading(true);
    try {
      const result = await listTrashedMediaAction(locationId);
      setAssets(result.assets);
      setTotal(result.total);
      setRetentionDays(result.retentionDays);
    } catch (err: any) {
      toast.error("Failed to load trashed media", {
        description: err.message,
      });
    } finally {
      setLoading(false);
    }
  }, [locationId]);

  useEffect(() => {
    loadAssets();
  }, [loadAssets]);

  const handlePurge = async () => {
    const expired = assets.filter(
      (a) => a.expiresAt && new Date(a.expiresAt) <= new Date()
    );
    if (expired.length === 0) {
      toast.info("No expired assets", {
        description: `All trashed images are still within the ${retentionDays}-day retention period.`,
      });
      return;
    }

    if (
      !confirm(
        `This will permanently delete ${expired.length} image(s) from Cloudflare that have passed the ${retentionDays}-day retention period. This action cannot be undone.\n\nContinue?`
      )
    ) {
      return;
    }

    setPurging(true);
    try {
      const result = await purgeExpiredMediaAction(locationId);
      toast.success(`Purged ${result.purgedCount} image(s)`, {
        description:
          result.failedCount > 0
            ? `${result.failedCount} failed. Check server logs.`
            : "All expired images were deleted from Cloudflare.",
      });
      await loadAssets();
    } catch (err: any) {
      toast.error("Purge failed", { description: err.message });
    } finally {
      setPurging(false);
    }
  };

  const handleRestore = async (cloudflareImageId: string) => {
    setRestoringId(cloudflareImageId);
    try {
      await restoreMediaAssetAction(locationId, cloudflareImageId);
      toast.success("Image restored", {
        description:
          "The image has been marked as active. You can now re-attach it to a property.",
      });
      await loadAssets();
    } catch (err: any) {
      toast.error("Restore failed", { description: err.message });
    } finally {
      setRestoringId(null);
    }
  };

  const expiredCount = assets.filter(
    (a) => a.expiresAt && new Date(a.expiresAt) <= new Date()
  ).length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold flex items-center gap-2">
            <Trash2 className="h-5 w-5 text-muted-foreground" />
            Media Trash
          </h2>
          <p className="text-sm text-muted-foreground mt-1">
            Images removed from properties are kept for{" "}
            <strong>{retentionDays} days</strong> before they can be permanently
            deleted from Cloudflare.
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={loadAssets}
            disabled={loading}
          >
            Refresh
          </Button>
          <Button
            variant="destructive"
            size="sm"
            onClick={handlePurge}
            disabled={purging || loading || expiredCount === 0}
          >
            {purging ? "Purging..." : `Empty Trash (${expiredCount} expired)`}
          </Button>
        </div>
      </div>

      {/* Stats */}
      {!loading && (
        <div className="flex gap-4 text-sm">
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-muted/50 border">
            <ImageIcon className="h-3.5 w-3.5 text-muted-foreground" />
            <span>{total} trashed</span>
          </div>
          {expiredCount > 0 && (
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-destructive/10 border border-destructive/20 text-destructive">
              <AlertTriangle className="h-3.5 w-3.5" />
              <span>{expiredCount} expired</span>
            </div>
          )}
          {total > 0 && expiredCount === 0 && (
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-green-50 border border-green-200 text-green-700">
              <CheckCircle className="h-3.5 w-3.5" />
              <span>All within retention period</span>
            </div>
          )}
        </div>
      )}

      {/* Grid */}
      {loading ? (
        <div className="text-center py-12 text-muted-foreground">
          Loading trashed images...
        </div>
      ) : assets.length === 0 ? (
        <div className="text-center py-12 border rounded-lg bg-muted/20">
          <Trash2 className="h-8 w-8 mx-auto text-muted-foreground mb-3" />
          <p className="text-muted-foreground font-medium">Trash is empty</p>
          <p className="text-sm text-muted-foreground mt-1">
            No orphaned images to clean up.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
          {assets.map((asset) => {
            const isExpired =
              asset.expiresAt && new Date(asset.expiresAt) <= new Date();
            const daysRemaining = asset.expiresAt
              ? Math.max(
                  0,
                  Math.ceil(
                    (new Date(asset.expiresAt).getTime() - Date.now()) /
                      (1000 * 60 * 60 * 24)
                  )
                )
              : null;

            return (
              <div
                key={asset.id}
                className={`relative group rounded-lg overflow-hidden border bg-gray-100 ${
                  isExpired
                    ? "ring-2 ring-destructive/50"
                    : ""
                }`}
              >
                {/* Image */}
                <div className="aspect-square">
                  {asset.cloudflareImageId ? (
                    <CloudflareImage
                      imageId={asset.cloudflareImageId}
                      variant="public"
                      className="w-full h-full object-cover opacity-60"
                      width={200}
                      height={200}
                      alt="Trashed image"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-muted-foreground">
                      <ImageIcon className="h-8 w-8" />
                    </div>
                  )}
                </div>

                {/* Status badge */}
                <div className="absolute top-1.5 left-1.5">
                  {isExpired ? (
                    <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-destructive text-destructive-foreground">
                      Expired
                    </span>
                  ) : (
                    <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-yellow-100 text-yellow-800">
                      {daysRemaining}d left
                    </span>
                  )}
                </div>

                {/* Actions overlay */}
                <div className="absolute inset-x-0 bottom-0 p-1.5 bg-gradient-to-t from-black/60 to-transparent opacity-0 group-hover:opacity-100 transition-opacity">
                  <div className="flex gap-1">
                    <Button
                      variant="secondary"
                      size="sm"
                      className="flex-1 h-7 text-xs"
                      onClick={() =>
                        handleRestore(asset.cloudflareImageId)
                      }
                      disabled={restoringId === asset.cloudflareImageId}
                    >
                      <RotateCcw className="h-3 w-3 mr-1" />
                      {restoringId === asset.cloudflareImageId
                        ? "..."
                        : "Restore"}
                    </Button>
                  </div>
                </div>

                {/* Deleted date */}
                {asset.deletedAt && (
                  <div className="px-1.5 py-1 text-[10px] text-muted-foreground truncate">
                    Deleted{" "}
                    {new Date(asset.deletedAt).toLocaleDateString()}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
