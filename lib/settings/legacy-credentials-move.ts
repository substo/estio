import { Prisma } from "@prisma/client";
import { SETTINGS_DOMAINS, SETTINGS_SECRET_KEYS, type SettingsDomain } from "./constants";
import { planOutlookColumnMove, planWebhookSecretMove, type MoveAction } from "./legacy-credentials-plan";

/**
 * One-time move of the last legacy credential copies into encrypted settings secrets (documentation/credentials.md):
 *   User.outlookPasswordEncrypted / User.outlookSessionCookies (app-encrypted)
 *       -> USER secrets outlook_password / outlook_session_cookies (user.integrations.microsoft)
 *   Location.whatsappWebhookSecret and the location.integrations document key whatsappWebhookSecret (plain text)
 *       -> LOCATION secret whatsapp_webhook_secret (location.integrations)
 * Never overwrites an existing secret. A stored value is read back and compared before the old copy is cleared.
 * Every write is in the settings audit log (secret writes by the settings service; column and document clears
 * here, with the value redacted). The report holds ids, labels and counts only, never a value.
 * Used by scripts/settings/move-legacy-credentials.ts and the Platform admin control.
 */

export type MoveItem = {
    kind: "outlook_password" | "outlook_session_cookies" | "webhook_verify_token";
    scopeId: string;
    action: MoveAction;
    note: string;
    written: boolean;
};

export type LegacyCredentialsReport = {
    apply: boolean;
    outlookColumnsPresent: boolean;
    webhookColumnPresent: boolean;
    items: MoveItem[];
    /** Items that would change something (store or clear). */
    toMove: number;
    written: number;
    /** Unreadable Outlook values left in place; the drop migration refuses while they remain. */
    unreadable: number;
    errors: Array<{ kind: MoveItem["kind"]; scopeId: string; message: string }>;
};

type Scope = { scopeType: "USER" | "LOCATION"; scopeId: string; domain: SettingsDomain; secretKey: string };

export type LegacyCredentialsStore = {
    columnExists(table: "User" | "Location", column: string): Promise<boolean>;
    listOutlookRows(columns: { password: boolean; cookies: boolean }): Promise<Array<{ id: string; password: string | null; cookies: string | null }>>;
    listWebhookColumnRows(): Promise<Array<{ id: string; value: string | null }>>;
    listIntegrationDocuments(): Promise<Array<{ scopeId: string; payload: unknown; version: number }>>;
    /** Sets the column to NULL and records a redacted DELETE row in the settings audit log. */
    clearColumn(input: { table: "User" | "Location"; column: string; id: string; domain: SettingsDomain; actorUserId: string | null; requestId: string }): Promise<void>;
    /** Removes the key from the document (optimistic on version) and records a redacted UPSERT audit row. */
    stripWebhookKeyFromDocument(input: { scopeId: string; expectedVersion: number; actorUserId: string | null; requestId: string }): Promise<void>;
};

export type LegacyCredentialsSecrets = {
    hasSecret(input: Scope): Promise<boolean>;
    getSecret(input: Scope): Promise<string | null>;
    setSecret(input: Scope & { plaintext: string; actorUserId: string | null; requestId: string }): Promise<unknown>;
};

export type LegacyCredentialsDeps = {
    store: LegacyCredentialsStore;
    secrets: LegacyCredentialsSecrets;
    decrypt: (value: string) => string;
};

function errorMessage(error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return message.slice(0, 300);
}

export async function moveLegacyCredentials(
    input: { apply: boolean; actorUserId: string | null; requestId: string },
    deps: LegacyCredentialsDeps,
): Promise<LegacyCredentialsReport> {
    const { store, secrets } = deps;
    const items: MoveItem[] = [];
    const errors: LegacyCredentialsReport["errors"] = [];

    async function storeVerified(scope: Scope, value: string) {
        await secrets.setSecret({ ...scope, plaintext: value, actorUserId: input.actorUserId, requestId: input.requestId });
        const readBack = await secrets.getSecret(scope);
        if (readBack !== value) throw new Error("Stored secret did not read back the same; the old copy was kept");
    }

    // Outlook browser password and cookies.
    const outlookColumns = {
        password: await store.columnExists("User", "outlookPasswordEncrypted"),
        cookies: await store.columnExists("User", "outlookSessionCookies"),
    };
    if (outlookColumns.password || outlookColumns.cookies) {
        for (const row of await store.listOutlookRows(outlookColumns)) {
            const parts = [
                { kind: "outlook_password" as const, column: "outlookPasswordEncrypted", encrypted: row.password, secretKey: SETTINGS_SECRET_KEYS.OUTLOOK_PASSWORD },
                { kind: "outlook_session_cookies" as const, column: "outlookSessionCookies", encrypted: row.cookies, secretKey: SETTINGS_SECRET_KEYS.OUTLOOK_SESSION_COOKIES },
            ];
            for (const part of parts) {
                const scope: Scope = { scopeType: "USER", scopeId: row.id, domain: SETTINGS_DOMAINS.USER_MICROSOFT_INTEGRATIONS, secretKey: part.secretKey };
                const decision = planOutlookColumnMove({ encrypted: part.encrypted, hasSecret: await secrets.hasSecret(scope), decrypt: deps.decrypt });
                if (decision.action === "nothing") continue;
                const item: MoveItem = { kind: part.kind, scopeId: row.id, action: decision.action, note: decision.note, written: false };
                items.push(item);
                if (!input.apply || decision.action === "skip_unreadable") continue;
                try {
                    if (decision.action === "store_secret_and_clear") await storeVerified(scope, decision.value!);
                    await store.clearColumn({ table: "User", column: part.column, id: row.id, domain: SETTINGS_DOMAINS.USER_MICROSOFT_INTEGRATIONS, actorUserId: input.actorUserId, requestId: input.requestId });
                    item.written = true;
                } catch (error) {
                    errors.push({ kind: part.kind, scopeId: row.id, message: errorMessage(error) });
                }
            }
        }
    }

    // WhatsApp webhook verify token.
    const webhookColumnPresent = await store.columnExists("Location", "whatsappWebhookSecret");
    const columnRows = webhookColumnPresent ? await store.listWebhookColumnRows() : [];
    const documents = (await store.listIntegrationDocuments())
        .filter(doc => doc.payload && typeof doc.payload === "object" && "whatsappWebhookSecret" in (doc.payload as object));
    for (const id of [...new Set([...columnRows.map(row => row.id), ...documents.map(doc => doc.scopeId)])]) {
        const column = columnRows.find(row => row.id === id)?.value ?? null;
        const doc = documents.find(d => d.scopeId === id);
        const scope: Scope = { scopeType: "LOCATION", scopeId: id, domain: SETTINGS_DOMAINS.LOCATION_INTEGRATIONS, secretKey: SETTINGS_SECRET_KEYS.WHATSAPP_WEBHOOK_SECRET };
        const decision = planWebhookSecretMove({
            documentValue: doc ? (doc.payload as Record<string, unknown>).whatsappWebhookSecret : undefined,
            columnValue: column,
            hasSecret: await secrets.hasSecret(scope),
        });
        if (decision.action === "nothing") continue;
        const item: MoveItem = { kind: "webhook_verify_token", scopeId: id, action: decision.action, note: decision.note, written: false };
        items.push(item);
        if (!input.apply) continue;
        try {
            if (decision.action === "store_secret_and_clear") await storeVerified(scope, decision.value!);
            if (doc) await store.stripWebhookKeyFromDocument({ scopeId: id, expectedVersion: doc.version, actorUserId: input.actorUserId, requestId: input.requestId });
            if (webhookColumnPresent && column !== null) {
                await store.clearColumn({ table: "Location", column: "whatsappWebhookSecret", id, domain: SETTINGS_DOMAINS.LOCATION_INTEGRATIONS, actorUserId: input.actorUserId, requestId: input.requestId });
            }
            item.written = true;
        } catch (error) {
            errors.push({ kind: "webhook_verify_token", scopeId: id, message: errorMessage(error) });
        }
    }

    return {
        apply: input.apply,
        outlookColumnsPresent: outlookColumns.password || outlookColumns.cookies,
        webhookColumnPresent,
        items,
        toMove: items.filter(item => item.action === "store_secret_and_clear" || item.action === "clear_only").length,
        written: items.filter(item => item.written).length,
        unreadable: items.filter(item => item.action === "skip_unreadable").length,
        errors,
    };
}

/** Lines for the script and logs: ids and notes only. */
export function formatLegacyCredentialsReport(report: LegacyCredentialsReport): string[] {
    const labels: Record<MoveItem["kind"], string> = {
        outlook_password: "Outlook password",
        outlook_session_cookies: "Outlook session cookies",
        webhook_verify_token: "WhatsApp verify token",
    };
    return [
        report.apply ? "APPLY" : "DRY RUN",
        ...report.items.map(item => `  - ${item.scopeId} ${labels[item.kind]}: ${item.note}${item.written ? " (written)" : ""}`),
        `${report.toMove} to move, ${report.written} written, ${report.unreadable} unreadable, ${report.errors.length} error(s)`,
        ...report.errors.map(error => `  ! ${error.scopeId} ${labels[error.kind]}: ${error.message}`),
    ];
}

// --- Prisma-backed store (server) ---

type Db = {
    $queryRawUnsafe<T = unknown>(query: string, ...values: unknown[]): Promise<T>;
    $transaction<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T>;
    settingsDocument: { findMany(args: object): Promise<Array<{ scopeId: string; payload: unknown; version: number }>> };
};

export function createPrismaLegacyCredentialsStore(db: Db): LegacyCredentialsStore {
    const exists = async (table: string, column: string) => {
        const rows = await db.$queryRawUnsafe<Array<{ n: bigint }>>(
            `SELECT count(*)::bigint AS n FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1 AND column_name = $2`,
            table, column,
        );
        return Number(rows[0]?.n ?? 0) > 0;
    };
    const ALLOWED = new Set(["User.outlookPasswordEncrypted", "User.outlookSessionCookies", "Location.whatsappWebhookSecret"]);
    return {
        columnExists: exists,
        listOutlookRows: ({ password, cookies }) => db.$queryRawUnsafe(
            `SELECT id, ${password ? `"outlookPasswordEncrypted"` : "NULL"} AS password, ${cookies ? `"outlookSessionCookies"` : "NULL"} AS cookies
               FROM "User" WHERE ${[password && `"outlookPasswordEncrypted" IS NOT NULL`, cookies && `"outlookSessionCookies" IS NOT NULL`].filter(Boolean).join(" OR ")}`,
        ),
        listWebhookColumnRows: () => db.$queryRawUnsafe(`SELECT id, "whatsappWebhookSecret" AS value FROM "Location" WHERE "whatsappWebhookSecret" IS NOT NULL`),
        listIntegrationDocuments: () => db.settingsDocument.findMany({
            where: { scopeType: "LOCATION", domain: SETTINGS_DOMAINS.LOCATION_INTEGRATIONS },
            select: { scopeId: true, payload: true, version: true },
        }),
        clearColumn: async ({ table, column, id, domain, actorUserId, requestId }) => {
            if (!ALLOWED.has(`${table}.${column}`)) throw new Error("Column not allowed");
            await db.$transaction(async (tx) => {
                await tx.$executeRawUnsafe(`UPDATE "${table}" SET "${column}" = NULL WHERE id = $1`, id);
                await tx.settingsAuditLog.create({
                    data: {
                        actorUserId, requestId, domain,
                        scopeType: table === "User" ? "USER" : "LOCATION",
                        scopeId: id,
                        operation: "DELETE",
                        beforeJson: { legacyColumn: `${table}.${column}`, hasValue: true },
                        afterJson: { legacyColumn: `${table}.${column}`, hasValue: false },
                    },
                });
            });
        },
        stripWebhookKeyFromDocument: async ({ scopeId, expectedVersion, actorUserId, requestId }) => {
            await db.$transaction(async (tx) => {
                const doc = await tx.settingsDocument.findUnique({
                    where: { scopeType_scopeId_domain: { scopeType: "LOCATION", scopeId, domain: SETTINGS_DOMAINS.LOCATION_INTEGRATIONS } },
                });
                if (!doc || doc.version !== expectedVersion) throw new Error("Integration settings changed meanwhile; run again");
                const { whatsappWebhookSecret: removed, ...payload } = (doc.payload ?? {}) as Record<string, unknown>;
                const hadValue = typeof removed === "string" && removed.trim() !== "";
                const updated = await tx.settingsDocument.updateMany({
                    where: { id: doc.id, version: expectedVersion },
                    data: { payload: payload as Prisma.InputJsonValue, version: expectedVersion + 1 },
                });
                if (updated.count !== 1) throw new Error("Integration settings changed meanwhile; run again");
                await tx.settingsAuditLog.create({
                    data: {
                        actorUserId, requestId,
                        scopeType: "LOCATION", scopeId, domain: SETTINGS_DOMAINS.LOCATION_INTEGRATIONS,
                        operation: "UPSERT",
                        // The removed value is never written to the audit log.
                        beforeJson: { ...payload, whatsappWebhookSecret: hadValue ? "[redacted]" : null } as Prisma.InputJsonValue,
                        afterJson: payload as Prisma.InputJsonValue,
                    },
                });
            });
        },
    };
}
