import { createHash } from "node:crypto";

/** The storyboard stand-in picture: rules that need no database. One private photo per user and Location, never shown to anyone else. */
export const MAX_AVATAR_BYTES = 5 * 1024 * 1024;
export const AVATAR_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export type AvatarType = (typeof AVATAR_TYPES)[number];
const extensions: Record<AvatarType, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };

/** The type comes from the bytes, not from the browser's claim, so a renamed file cannot slip through. */
export function sniffAvatarType(bytes: Uint8Array): AvatarType | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 8 && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((b, i) => bytes[i] === b)) return "image/png";
  if (bytes.length >= 12 && String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" && String.fromCharCode(...bytes.slice(8, 12)) === "WEBP") return "image/webp";
  return null;
}
export function readAvatarBytes(bytes: Uint8Array): { ok: true; contentType: AvatarType } | { ok: false; error: string } {
  if (!bytes.length) return { ok: false, error: "Choose a photo." };
  if (bytes.length > MAX_AVATAR_BYTES) return { ok: false, error: "The photo must be up to 5 MB." };
  const contentType = sniffAvatarType(bytes);
  return contentType ? { ok: true, contentType } : { ok: false, error: "Use a JPEG, PNG or WebP photo." };
}
/** Derived from the Location and a hash of the user id: never from user input, and it does not spell out the user id in storage. */
export const avatarObjectKey = (locationId: string, userId: string) => `${locationId}/avatars/${createHash("sha256").update(userId).digest("hex").slice(0, 40)}`;
export const avatarFileName = (contentType: string) => `storyboard-avatar.${extensions[contentType as AvatarType] ?? "jpg"}`;
export const AVATAR_NOTE = "Your photo stays private to this workspace. It is only used as the stand-in picture on storyboard placeholders while a video is made, and you can remove it any time.";
