import { lstat, readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { normalizeLegacyLibrary, type LegacyLibraryManifest } from "./legacy-library";

export interface InspectedLibraryManifest extends LegacyLibraryManifest {
  mode: "dry-run";
  mediaReady: boolean;
  media: Array<{ id: string; relativePath: string; status: "present" | "missing" | "unsafe" | "size_mismatch"; actualBytes?: number }>;
}

/** Inspect metadata only. Media bytes are never read, copied, uploaded or changed. */
export async function inspectLegacyLibrary(dataDirectory: string): Promise<InspectedLibraryManifest> {
  const dataDir = await realpath(dataDirectory);
  const storeFile = path.join(dataDir, "store.json");
  const info = await lstat(storeFile);
  if (!info.isFile() || info.isSymbolicLink() || info.size > 100 * 1024 * 1024) {
    throw new Error("store.json must be a regular file smaller than 100 MiB.");
  }
  const manifest = normalizeLegacyLibrary(JSON.parse(await readFile(storeFile, "utf8")));
  const filesDir = path.join(dataDir, "files");
  const folder = await lstat(filesDir).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
  const unsafeFolder = Boolean(folder && (!folder.isDirectory() || folder.isSymbolicLink()));
  const media: InspectedLibraryManifest["media"] = [];
  for (const file of manifest.files) {
    if (unsafeFolder) {
      media.push({ id: file.id, relativePath: file.relativePath, status: "unsafe" });
      continue;
    }
    const fileInfo = await lstat(path.join(dataDir, file.relativePath)).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return null;
      throw error;
    });
    const status = !fileInfo ? "missing" : !fileInfo.isFile() || fileInfo.isSymbolicLink() ? "unsafe" : fileInfo.size !== file.payload.size ? "size_mismatch" : "present";
    media.push({ id: file.id, relativePath: file.relativePath, status, ...(fileInfo ? { actualBytes: fileInfo.size } : {}) });
  }
  const issues = [...manifest.issues, ...media.filter((file) => file.status !== "present").map((file) => ({
    code: `media_${file.status}`, path: file.relativePath, severity: file.status === "unsafe" ? "error" as const : "warning" as const,
  }))].sort((a, b) => a.path.localeCompare(b.path) || a.code.localeCompare(b.code));
  return { ...manifest, valid: !issues.some((issue) => issue.severity === "error"), issues, mode: "dry-run", mediaReady: media.every((file) => file.status === "present"), media };
}
