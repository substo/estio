// Inline display only for passive media types. Everything else, including SVG,
// HTML and PDF, downloads as an opaque attachment so it cannot run in our origin.
const INLINE_TYPES = new Set([
  "image/png", "image/jpeg", "image/gif", "image/webp", "image/avif",
  "video/mp4", "video/webm", "video/quicktime",
  "audio/mpeg", "audio/mp4", "audio/ogg", "audio/wav", "audio/x-wav", "audio/webm", "audio/aac",
]);

export function studioMediaKind(contentType: string | null | undefined): "image" | "video" | "audio" | null {
  const type = String(contentType ?? "").toLowerCase();
  if (!INLINE_TYPES.has(type)) return null;
  return type.split("/")[0] as "image" | "video" | "audio";
}

export function studioMediaResponseHeaders(contentType: string | null | undefined, filename: string, wantInline: boolean) {
  const inline = wantInline && studioMediaKind(contentType) !== null;
  const fallback = filename.replace(/[^\x20-\x7e]|["\\]/g, "_").trim() || "download";
  const encoded = encodeURIComponent(filename).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return {
    inline,
    contentType: inline ? String(contentType).toLowerCase() : "application/octet-stream",
    contentDisposition: `${inline ? "inline" : "attachment"}; filename="${fallback}"; filename*=UTF-8''${encoded}`,
  };
}
