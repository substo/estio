export type LocationDeletionTarget = {
  name: string | null;
  isPlatformMaster: boolean;
  retainedAuditCount: number;
  mediaAssetCount: number;
  externalResourceCount: number;
};

export class LocationDeletionError extends Error {
  constructor(
    message: string,
    public readonly code: "NOT_FOUND" | "NOT_AUTHORIZED" | "INVALID_CONFIRMATION" | "PROTECTED" | "BLOCKED",
  ) {
    super(message);
    this.name = "LocationDeletionError";
  }
}

export function locationDisplayName(name: string | null): string {
  return String(name || "").trim() || "Unnamed location";
}

export function assertLocationCanBeDeleted(
  target: LocationDeletionTarget,
  confirmationName: string,
): void {
  const displayName = locationDisplayName(target.name);
  if (target.isPlatformMaster) {
    throw new LocationDeletionError("The platform master location cannot be deleted.", "PROTECTED");
  }
  if (String(confirmationName || "").trim() !== displayName) {
    throw new LocationDeletionError("Type the exact location name to confirm deletion.", "INVALID_CONFIRMATION");
  }
  if (target.retainedAuditCount > 0) {
    throw new LocationDeletionError(
      "This location has retained platform or WhatsApp audit history and cannot be deleted.",
      "BLOCKED",
    );
  }
  if (target.mediaAssetCount > 0) {
    throw new LocationDeletionError(
      "This location still owns media files. Remove its media assets before deleting the location.",
      "BLOCKED",
    );
  }
  if (target.externalResourceCount > 0) {
    throw new LocationDeletionError(
      "This location still has connected integrations or active domains. Disconnect or release them before deleting the location.",
      "BLOCKED",
    );
  }
}

export function locationDeletionHttpStatus(error: unknown): number {
  if (!(error instanceof LocationDeletionError)) return 500;
  if (error.code === "NOT_FOUND" || error.code === "NOT_AUTHORIZED") return 404;
  if (error.code === "BLOCKED" || error.code === "PROTECTED") return 409;
  return 400;
}
