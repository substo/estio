#!/usr/bin/env tsx
import { runViewingSessionRetentionCleanup } from "@/lib/viewings/sessions/retention";

function parseArg(name: string): string | null {
    const prefix = `--${name}=`;
    const direct = process.argv.find((arg) => arg.startsWith(prefix));
    if (direct) return direct.slice(prefix.length).trim();

    const index = process.argv.findIndex((arg) => arg === `--${name}`);
    if (index >= 0 && process.argv[index + 1]) {
        return String(process.argv[index + 1]).trim();
    }
    return null;
}

function hasFlag(name: string): boolean {
    return process.argv.includes(`--${name}`);
}

async function main() {
    const dryRun = hasFlag("dry-run") || hasFlag("dryRun");
    const locationId = parseArg("locationId");
    const batchSizeRaw = parseArg("batchSize");
    const batchSize = Number(batchSizeRaw || 200);

    const result = await runViewingSessionRetentionCleanup({
        dryRun,
        locationId: locationId || null,
        batchSize: Number.isFinite(batchSize) ? batchSize : 200,
    });

    console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
    console.error("[viewing-session-retention] Cleanup failed:", error);
    process.exit(1);
});
