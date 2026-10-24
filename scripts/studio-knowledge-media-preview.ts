import { realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { KnowledgePreviewError } from "../lib/studio/import/inspect-knowledge";
import { inspectLegacyKnowledgeMedia } from "../lib/studio/import/inspect-knowledge-media";
import { SourceSnapshotError } from "../lib/studio/import/source-snapshot";

class KnowledgeMediaPreviewError extends Error {
  constructor(public readonly code: string) { super(code); this.name = "KnowledgeMediaPreviewError"; }
}

export async function main(args = process.argv.slice(2)) {
  if (args.length === 1 && args[0] === "--help") {
    console.log("Read-only frame checksums: npx tsx scripts/studio-knowledge-media-preview.ts --data-dir /absolute/Substo/data --output /absolute/private/knowledge-media-manifest.json"); return;
  }
  if (args.length !== 4 || args[0] !== "--data-dir" || args[2] !== "--output" || !path.isAbsolute(args[1]) || !path.isAbsolute(args[3])) throw new KnowledgeMediaPreviewError("invalid_arguments");
  const dataDir = await realpath(args[1]);
  const output = path.join(await realpath(path.dirname(args[3])), path.basename(args[3]));
  const relative = path.relative(dataDir, output);
  if (!relative || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative))) throw new KnowledgeMediaPreviewError("output_must_be_outside_source");
  const manifest = await inspectLegacyKnowledgeMedia(dataDir);
  const serialized = `${JSON.stringify(manifest, null, 2)}\n`;
  if (Buffer.byteLength(serialized, "utf8") > 250 * 1024 * 1024) throw new KnowledgeMediaPreviewError("manifest_byte_limit_exceeded");
  await writeFile(output, serialized, { mode: 0o600, flag: "wx", encoding: "utf8" });
  console.log(JSON.stringify({ mode: manifest.mode, valid: manifest.valid, counts: manifest.counts, issues: manifest.issues.length, hostedReconciled: false, output }));
  if (!manifest.valid) process.exitCode = 2;
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error: unknown) => {
    console.error(JSON.stringify({ error: error instanceof KnowledgeMediaPreviewError || error instanceof KnowledgePreviewError || error instanceof SourceSnapshotError ? error.code : "knowledge_media_preview_failed" }));
    process.exitCode = 1;
  });
}
