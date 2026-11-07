import "server-only";

import { randomUUID } from "node:crypto";
import db from "@/lib/db";
import { decryptPassword } from "@/lib/crypto/password-encryption";
import { settingsService } from "./service";
import { createPrismaLegacyCredentialsStore, moveLegacyCredentials, type LegacyCredentialsReport } from "./legacy-credentials-move";

/** Runs the legacy credential move on this server (which holds the settings/KMS keys). Callers authorise first. */
export function runLegacyCredentialsMove(input: { apply: boolean; actorUserId: string | null }): Promise<LegacyCredentialsReport> {
    return moveLegacyCredentials(
        { ...input, requestId: `move-legacy-credentials:${randomUUID()}` },
        { store: createPrismaLegacyCredentialsStore(db), secrets: settingsService, decrypt: decryptPassword },
    );
}
