/**
 * One-time move of the last legacy credential copies into encrypted settings secrets
 * (documentation/credentials.md; logic in lib/settings/legacy-credentials-move.ts, shared with the Platform admin
 * control "Move remaining legacy credentials"). Storing a secret needs the server's settings/KMS keys.
 * Prints ids, labels and counts only, never values.
 *
 *   npx tsx scripts/settings/move-legacy-credentials.ts            # dry run
 *   npx tsx scripts/settings/move-legacy-credentials.ts --apply
 */
import { randomUUID } from "node:crypto";
import db from "@/lib/db";
import { decryptPassword } from "@/lib/crypto/password-encryption";
import { settingsService } from "@/lib/settings/service";
import { createPrismaLegacyCredentialsStore, formatLegacyCredentialsReport, moveLegacyCredentials } from "@/lib/settings/legacy-credentials-move";

async function main() {
    const report = await moveLegacyCredentials(
        { apply: process.argv.includes("--apply"), actorUserId: null, requestId: `move-legacy-credentials:${randomUUID()}` },
        { store: createPrismaLegacyCredentialsStore(db), secrets: settingsService, decrypt: decryptPassword },
    );
    for (const line of formatLegacyCredentialsReport(report)) console.log(line);
    if (report.errors.length) process.exitCode = 1;
}

main().catch(error => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; }).finally(() => db.$disconnect());
