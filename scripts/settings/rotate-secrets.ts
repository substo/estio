import db from "@/lib/db";
import { settingsService } from "@/lib/settings/service";
import { getSettingsPrimaryKeyId, listSettingsKeyIds } from "@/lib/settings/keyring";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");

function getArgValue(flag: string): string | null {
    const match = args.find((arg) => arg.startsWith(`${flag}=`));
    return match ? match.slice(flag.length + 1) : null;
}

const scopeTypeArg = getArgValue("--scope-type");
const scopeId = getArgValue("--scope-id") || undefined;
const domain = getArgValue("--domain") || undefined;
const batchSizeArg = getArgValue("--batch-size");

const batchSize = batchSizeArg ? Number(batchSizeArg) : 200;
if (!Number.isFinite(batchSize) || batchSize < 1) {
    throw new Error("Invalid --batch-size value.");
}

if (scopeTypeArg && scopeTypeArg !== "LOCATION" && scopeTypeArg !== "USER") {
    throw new Error("Invalid --scope-type value. Use LOCATION or USER.");
}

async function main() {
    const primaryKeyId = getSettingsPrimaryKeyId();
    const keyIds = listSettingsKeyIds();

    const where = {
        ...(scopeTypeArg ? { scopeType: scopeTypeArg as "LOCATION" | "USER" } : {}),
        ...(scopeId ? { scopeId } : {}),
        ...(domain ? { domain } : {}),
        keyId: { not: primaryKeyId },
    };

    const pendingCount = await db.settingsSecret.count({ where });

    console.log("[settings/rotate-secrets] Keyring:", { primaryKeyId, keyIds });
    console.log("[settings/rotate-secrets] Pending secrets:", pendingCount);
    console.log("[settings/rotate-secrets] Filters:", {
        scopeType: scopeTypeArg || "*",
        scopeId: scopeId || "*",
        domain: domain || "*",
        batchSize,
        dryRun,
    });

    if (dryRun || pendingCount === 0) {
        return;
    }

    const result = await settingsService.rotateSecrets({
        scopeType: scopeTypeArg as "LOCATION" | "USER" | undefined,
        scopeId,
        domain: domain as any,
        batchSize,
        actorUserId: null,
    });

    console.log("[settings/rotate-secrets] Rotation completed:", result);
}

main()
    .catch((error) => {
        console.error("[settings/rotate-secrets] Failed:", error);
        process.exitCode = 1;
    })
    .finally(async () => {
        await db.$disconnect();
    });
