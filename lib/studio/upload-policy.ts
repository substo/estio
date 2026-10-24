// Pure rules shared by the upload form and server. The database repeats them.
export const STUDIO_UPLOAD_MAX_BYTES = 5 * 1024 ** 3;
export const STUDIO_UPLOAD_TYPES = ["video/mp4", "video/quicktime", "video/webm", "audio/mpeg", "audio/mp4", "audio/x-m4a",
  "audio/wav", "audio/x-wav", "audio/webm", "audio/ogg", "audio/aac"] as const;
const byExtension: Record<string, (typeof STUDIO_UPLOAD_TYPES)[number]> = {
  mp4: "video/mp4", m4v: "video/mp4", mov: "video/quicktime", webm: "video/webm", mp3: "audio/mpeg", m4a: "audio/mp4",
  wav: "audio/wav", ogg: "audio/ogg", oga: "audio/ogg", opus: "audio/ogg", aac: "audio/aac",
};

export interface StudioUploadRequest { recordId: string; filename: string; contentType: (typeof STUDIO_UPLOAD_TYPES)[number]; byteSize: number }

/** Browsers often report "" or a vendor type; fall back to the extension. */
export function readStudioUploadRequest(input: { recordId: unknown; filename: unknown; contentType: unknown; byteSize: unknown }): StudioUploadRequest {
  const recordId = String(input.recordId ?? "").toLowerCase();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(recordId)) throw new Error("Invalid record.");
  const filename = String(input.filename ?? "").split(/[\\/]/).pop()!.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 255);
  if (!filename) throw new Error("The file needs a name.");
  const reported = String(input.contentType ?? "").toLowerCase();
  const contentType = (STUDIO_UPLOAD_TYPES as readonly string[]).includes(reported) ? reported as StudioUploadRequest["contentType"]
    : byExtension[filename.split(".").pop()?.toLowerCase() ?? ""];
  if (!contentType) throw new Error("Upload a video or audio file (MP4, MOV, WebM, MP3, M4A, WAV, OGG or AAC).");
  const byteSize = Number(input.byteSize);
  if (!Number.isSafeInteger(byteSize) || byteSize < 1) throw new Error("The file is empty.");
  if (byteSize > STUDIO_UPLOAD_MAX_BYTES) throw new Error("Files can be at most 5 GB.");
  return { recordId, filename, contentType, byteSize };
}
