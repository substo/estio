/**
 * One-time move of the last legacy credential copies into encrypted settings secrets
 * (documentation/credentials.md). Run after the code that reads the secrets is deployed and before the
 * migration that drops the columns:
 *   User.outlookPasswordEncrypted (app-encrypted)  -> USER secret outlook_password        (user.integrations.microsoft)
 *   User.outlookSessionCookies    (app-encrypted)  -> USER secret outlook_session_cookies (user.integrations.microsoft)
 *   Location.whatsappWebhookSecret and the location.integrations document key whatsappWebhookSecret (plain text)
 *                                                  -> LOCATION secret whatsapp_webhook_secret (location.integrations)
 * Never overwrites an existing secret. After a stored value is read back and matches, the legacy copy is cleared.
 * Prints counts and ids only, never values. Also reports the columns the earlier drop migration guards.
 *
 *   npx tsx scripts/settings/move-legacy-credentials.ts            # dry run
 *   npx tsx scripts/settings/move-legacy-credentials.ts --apply
 */
import db from "@/lib/db";
import { decryptPassword } from "@/lib/crypto/password-encryption";
import { settingsService } from "@/lib/settings/service";
import { SETTINGS_DOMAINS, SETTINGS_SECRET_KEYS } from "@/lib/settings/constants";
import { planOutlookColumnMove, planWebhookSecretMove, type MoveDecision } from "@/lib/settings/legacy-credentials-plan";

const apply = process.argv.includes("--apply");

async function columnExists(table: string, column: string) {
    const rows = await db.$queryRawUnsafe<{ n: bigint }[]>(
        `SELECT count(*)::bigint AS n FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1 AND column_name = $2`,
        table, column,
    );
    return Number(rows[0]?.n ?? 0) > 0;
}

async function countNonEmpty(table: string, column: string) {
    if (!(await columnExists(table, column))) return "dropped";
    const rows = await db.$queryRawUnsafe<{ n: bigint }[]>(`SELECT count(*)::bigint AS n FROM "${table}" WHERE "${column}" IS NOT NULL AND btrim("${column}") <> ''`);
    return String(rows[0]?.n ?? 0);
}

async function storeVerified(input: { scopeType: "USER" | "LOCATION"; scopeId: string; domain: (typeof SETTINGS_DOMAINS)[keyof typeof SETTINGS_DOMAINS]; secretKey: string; value: string }) {
    await settingsService.setSecret({ ...input, plaintext: input.value, actorUserId: null, requestId: "move-legacy-credentials" });
    const readBack = await settingsService.getSecret(input);
    if (readBack !== input.value) throw new Error(`read-back mismatch for ${input.scopeType}:${input.scopeId}:${input.secretKey}`);
}

function line(id: string, label: string, decision: MoveDecision) {
    console.log(`  - ${id} ${label}: ${decision.note}`);
}

async function moveOutlookBrowserCredentials() {
    const hasPassword = await columnExists("User", "outlookPasswordEncrypted");
    const hasCookies = await columnExists("User", "outlookSessionCookies");
    if (!hasPassword && !hasCookies) {
        console.log("Outlook browser credentials: columns already dropped; nothing to move");
        return { pending: 0 };
    }
    const rows = await db.$queryRawUnsafe<{ id: string; password: string | null; cookies: string | null }[]>(
        `SELECT id, ${hasPassword ? `"outlookPasswordEncrypted"` : "NULL"} AS password, ${hasCookies ? `"outlookSessionCookies"` : "NULL"} AS cookies
           FROM "User" WHERE ${[hasPassword && `"outlookPasswordEncrypted" IS NOT NULL`, hasCookies && `"outlookSessionCookies" IS NOT NULL`].filter(Boolean).join(" OR ")}`,
    );
    console.log(`Outlook browser credentials: ${rows.length} user(s) with an in-column copy`);
    let pending = 0;
    for (const row of rows) {
        const scope = { scopeType: "USER" as const, scopeId: row.id, domain: SETTINGS_DOMAINS.USER_MICROSOFT_INTEGRATIONS };
        const parts = [
            { label: "password", column: "outlookPasswordEncrypted", encrypted: row.password, secretKey: SETTINGS_SECRET_KEYS.OUTLOOK_PASSWORD },
            { label: "session cookies", column: "outlookSessionCookies", encrypted: row.cookies, secretKey: SETTINGS_SECRET_KEYS.OUTLOOK_SESSION_COOKIES },
        ];
        for (const part of parts) {
            const hasSecret = await settingsService.hasSecret({ ...scope, secretKey: part.secretKey });
            const decision = planOutlookColumnMove({ encrypted: part.encrypted, hasSecret, decrypt: decryptPassword });
            if (decision.action === "nothing") continue;
            line(row.id, part.label, decision);
            if (decision.action === "skip_unreadable") { pending += 1; continue; }
            if (!apply) continue;
            if (decision.action === "store_secret_and_clear") await storeVerified({ ...scope, secretKey: part.secretKey, value: decision.value! });
            await db.$executeRawUnsafe(`UPDATE "User" SET "${part.column}" = NULL WHERE id = $1`, row.id);
            console.log("      written");
        }
    }
    return { pending };
}

async function moveWhatsAppWebhookSecrets() {
    const hasColumn = await columnExists("Location", "whatsappWebhookSecret");
    const columnRows = hasColumn
        ? await db.$queryRawUnsafe<{ id: string; value: string | null }[]>(`SELECT id, "whatsappWebhookSecret" AS value FROM "Location" WHERE "whatsappWebhookSecret" IS NOT NULL`)
        : [];
    const documents = await db.settingsDocument.findMany({
        where: { scopeType: "LOCATION", domain: SETTINGS_DOMAINS.LOCATION_INTEGRATIONS },
        select: { scopeId: true, payload: true, version: true, schemaVersion: true },
    });
    const docsWithKey = documents.filter(doc => doc.payload && typeof doc.payload === "object" && "whatsappWebhookSecret" in (doc.payload as object));
    const ids = [...new Set([...columnRows.map(row => row.id), ...docsWithKey.map(doc => doc.scopeId)])];
    console.log(`WhatsApp webhook verify token: ${ids.length} Location(s) with a plain-text copy${hasColumn ? "" : " (column already dropped)"}`);
    for (const id of ids) {
        const column = columnRows.find(row => row.id === id)?.value ?? null;
        const doc = docsWithKey.find(d => d.scopeId === id);
        const payload = (doc?.payload ?? {}) as Record<string, unknown>;
        const scope = { scopeType: "LOCATION" as const, scopeId: id, domain: SETTINGS_DOMAINS.LOCATION_INTEGRATIONS, secretKey: SETTINGS_SECRET_KEYS.WHATSAPP_WEBHOOK_SECRET };
        const decision = planWebhookSecretMove({ documentValue: doc ? payload.whatsappWebhookSecret : undefined, columnValue: column, hasSecret: await settingsService.hasSecret(scope) });
        if (decision.action === "nothing") continue;
        line(id, "verify token", decision);
        if (!apply) continue;
        if (decision.action === "store_secret_and_clear") await storeVerified({ ...scope, value: decision.value! });
        if (doc) {
            const { whatsappWebhookSecret: _removed, ...rest } = payload;
            await settingsService.upsertDocument({ scopeType: "LOCATION", scopeId: id, domain: SETTINGS_DOMAINS.LOCATION_INTEGRATIONS, payload: rest, expectedVersion: doc.version, schemaVersion: doc.schemaVersion, actorUserId: null, requestId: "move-legacy-credentials" });
        }
        if (hasColumn) await db.$executeRawUnsafe(`UPDATE "Location" SET "whatsappWebhookSecret" = NULL WHERE id = $1`, id);
        console.log("      written");
    }
}

async function main() {
    console.log(apply ? "APPLY" : "DRY RUN");
    const outlook = await moveOutlookBrowserCredentials();
    await moveWhatsAppWebhookSecrets();
    console.log("Columns guarded by the immediate drop migration (non-empty rows; must be 0 or 'dropped'):");
    for (const column of ["crmPassword", "googleAccessToken", "googleRefreshToken", "googleSyncToken", "outlookAccessToken", "outlookRefreshToken"]) {
        console.log(`  - User.${column}: ${await countNonEmpty("User", column)}`);
    }
    if (await columnExists("User", "crmUsername")) {
        const rows = await db.$queryRawUnsafe<{ n: bigint }[]>(`SELECT count(*)::bigint AS n FROM "User" u WHERE btrim(coalesce(u."crmUsername", '')) <> ''
            AND NOT EXISTS (SELECT 1 FROM settings_documents d WHERE d.scope_type = 'USER' AND d.scope_id = u.id AND d.domain = 'user.crm')`);
        console.log(`  - User.crmUsername without a user.crm document: ${String(rows[0]?.n ?? 0)}`);
    } else {
        console.log("  - User.crmUsername: dropped");
    }
    if (outlook.pending) console.log(`${outlook.pending} unreadable Outlook value(s) remain; the drop migration will refuse until they are cleared (the person reconnects).`);
}

main().catch(error => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; }).finally(() => db.$disconnect());
