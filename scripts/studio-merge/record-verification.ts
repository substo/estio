#!/usr/bin/env tsx
import { verifyStudioCopy } from "../../lib/studio/merge-verification";
// Run only after an approved copy. Rechecks the target; never mutates database state.
import { createHash } from "node:crypto";
import { readFile, writeFile, rename, chmod } from "node:fs/promises";
import { PrismaClient } from "@prisma/client";
const sha = (v: string | Buffer) => createHash("sha256").update(v).digest("hex");
async function main() {
  const evidencePath = process.argv[2], file = process.env.STUDIO_MERGE_STATE_FILE;
  if (!evidencePath || !file || !process.env.DATABASE_URL) throw Error("Expected verification evidence, explicit STUDIO_MERGE_STATE_FILE and DATABASE_URL");
  const raw = await readFile(evidencePath), evidence = JSON.parse(raw.toString());
  if (evidence.tables?.length !== 53 || evidence.foreign_keys !== 89 || evidence.mapped_locations !== 2) throw Error("Unexpected copy inventory");
  const db = new PrismaClient();
  try {
    await verifyStudioCopy(db, evidence);
    const migrationDigest = sha(await readFile("prisma/migrations/20261028100000_studio_schema/migration.sql"));
    const temporary = `${file}.${process.pid}.tmp`;
    await writeFile(temporary, JSON.stringify({ version: 1, verified: true, database: sha(process.env.DATABASE_URL), copyDigest: sha(raw), migrationDigest }), { flag: "wx", mode: 0o600 });
    await rename(temporary, file); await chmod(file, 0o600);
    console.log("Copy reverified; activation receipt installed.");
  } finally { await db.$disconnect(); }
}
main().catch(() => { console.error("Copy verification failed; keep Studio frozen."); process.exitCode=1; });
