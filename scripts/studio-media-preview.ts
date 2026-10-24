import { realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { inspectLegacyMedia, MediaPreviewError } from "../lib/studio/import/inspect-media";
import { SourceSnapshotError } from "../lib/studio/import/source-snapshot";

export async function main(args = process.argv.slice(2)) {
  if (args.length === 1 && args[0] === "--help") {
    console.log("Read-only checksums: npx tsx scripts/studio-media-preview.ts --data-dir /absolute/Substo/data --output /absolute/private/media-manifest.json"); return;
  }
  if (args.length !== 4 || args[0] !== "--data-dir" || args[2] !== "--output" || !path.isAbsolute(args[1]) || !path.isAbsolute(args[3])) throw new MediaPreviewError("invalid_arguments");
  const dataDir = await realpath(args[1]);
  const parent = await realpath(path.dirname(args[3]));
  const output = path.join(parent, path.basename(args[3]));
  const relative = path.relative(dataDir, output);
  if (!relative || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative))) throw new MediaPreviewError("output_must_be_outside_source");
  const manifest = await inspectLegacyMedia(dataDir);
  const serialized = `${JSON.stringify(manifest, null, 2)}\n`;
  if (Buffer.byteLength(serialized, "utf8") > 250 * 1024 * 1024) throw new MediaPreviewError("media_manifest_byte_limit_exceeded");
  await writeFile(output, serialized, { mode: 0o600, flag: "wx", encoding: "utf8" });
  console.log(JSON.stringify({ mode: manifest.mode, valid: manifest.valid, counts: manifest.counts, issues: manifest.issues.length,
    sourceBytesVerified: manifest.sourceBytesVerified, hostedReconciled: false, uploadSupported: false, output }));
  if (!manifest.valid) process.exitCode = 2;
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error: unknown) => {
    console.error(JSON.stringify({ error: error instanceof MediaPreviewError || error instanceof SourceSnapshotError ? error.code : "media_preview_failed" }));
    process.exitCode = 1;
  });
}
