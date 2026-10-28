import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
/** Shared persistent gate, checked on every operation by web, worker, cron and Mac endpoints. */
export function assertStudioMergeReady(env: NodeJS.ProcessEnv = process.env) {
  if (env.NODE_ENV !== "production") return;
  const file = env.STUDIO_MERGE_STATE_FILE || "/home/martin/.deploy-state/studio-merge-ready.json";
  try {
    const receipt = JSON.parse(readFileSync(file, "utf8"));
    const database = createHash("sha256").update(env.DATABASE_URL ?? "").digest("hex");
    if (!env.DATABASE_URL || receipt.database !== database || receipt.version !== 1 || receipt.verified !== true ||
      !/^[a-f0-9]{64}$/.test(receipt.copyDigest) || !/^[a-f0-9]{64}$/.test(receipt.migrationDigest)) throw Error();
    const migration = readFileSync("prisma/migrations/20261028100000_studio_schema/migration.sql");
    if (createHash("sha256").update(migration).digest("hex") !== receipt.migrationDigest) throw Error();
  } catch { throw new Error("studio_merge_not_verified_or_frozen"); }
}
