import type { Prisma } from "@prisma/client";
import db from "@/lib/db";
import { settingsService as defaultSettingsService } from "@/lib/settings/service";
import { SETTINGS_DOMAINS, SETTINGS_SECRET_KEYS } from "@/lib/settings/constants";

/**
 * The one home of a person's Old CRM login (Estio only).
 * - username: the user.crm settings document (USER scope, scopeId = User.id), key crmUsername;
 * - password: the encrypted SettingsSecret crm_password in the same scope and domain.
 * The former User.crmUsername / User.crmPassword columns are dropped (documentation/credentials.md).
 * Server-only: callers must already have authorised the user.
 */

type TxClient = Prisma.TransactionClient;

export type UserCrmCredentials = {
    username: string | null;
    password: string | null;
};

type SettingsPort = Pick<typeof defaultSettingsService, "getDocument" | "upsertDocument" | "getSecret" | "hasSecret" | "setSecret" | "clearSecret">;

type SecretRowsPort = {
    findMany(args: {
        where: { scopeType: "USER"; domain: string; secretKey: string; scopeId: { in: string[] } };
        select: { scopeId: true };
    }): Promise<Array<{ scopeId: string }>>;
};

type DocumentRowsPort = {
    findMany(args: {
        where: { scopeType: "USER"; domain: string; scopeId: { in: string[] } };
        select: { scopeId: true; payload: true };
    }): Promise<Array<{ scopeId: string; payload: unknown }>>;
};

const scope = (userId: string) => ({
    scopeType: "USER" as const,
    scopeId: userId,
    domain: SETTINGS_DOMAINS.USER_CRM,
});

function clean(value: unknown): string | null {
    const text = typeof value === "string" ? value.trim() : "";
    return text || null;
}

export function createUserCrmCredentials(deps: { settings: SettingsPort; secretRows: SecretRowsPort; documentRows: DocumentRowsPort }) {
    const { settings, secretRows, documentRows } = deps;

    async function getUserCrmUsername(userId: string): Promise<string | null> {
        const doc = await settings.getDocument<{ crmUsername?: unknown }>(scope(userId));
        return clean(doc?.payload?.crmUsername);
    }

    async function getUserCrmCredentials(userId: string): Promise<UserCrmCredentials> {
        const [username, password] = await Promise.all([
            getUserCrmUsername(userId),
            settings.getSecret({ ...scope(userId), secretKey: SETTINGS_SECRET_KEYS.CRM_PASSWORD }),
        ]);
        return { username, password: clean(password) };
    }

    async function hasUserCrmPassword(userId: string): Promise<boolean> {
        return settings.hasSecret({ ...scope(userId), secretKey: SETTINGS_SECRET_KEYS.CRM_PASSWORD });
    }

    /**
     * Saves the username and, when `password` is a string, replaces the password; `null` removes it;
     * `undefined` keeps the stored one (the settings form sends a mask when unchanged).
     */
    async function setUserCrmCredentials(input: {
        userId: string;
        username: string | null;
        password?: string | null;
        actorUserId?: string | null;
        expectedVersion?: number | null;
        tx?: TxClient;
    }) {
        const existing = await settings.getDocument<Record<string, unknown>>({ ...scope(input.userId), tx: input.tx });
        await settings.upsertDocument({
            ...scope(input.userId),
            payload: { ...(existing?.payload ?? {}), crmUsername: clean(input.username) },
            actorUserId: input.actorUserId ?? null,
            expectedVersion: input.expectedVersion,
            schemaVersion: 1,
            tx: input.tx,
        });
        if (input.password === null) {
            await settings.clearSecret({ ...scope(input.userId), secretKey: SETTINGS_SECRET_KEYS.CRM_PASSWORD, actorUserId: input.actorUserId ?? null, tx: input.tx });
        } else if (typeof input.password === "string") {
            const password = clean(input.password);
            if (!password) throw new Error("CRM password cannot be empty");
            await settings.setSecret({ ...scope(input.userId), secretKey: SETTINGS_SECRET_KEYS.CRM_PASSWORD, plaintext: password, actorUserId: input.actorUserId ?? null, tx: input.tx });
        }
    }

    /** Removes both the username and the password (used by Old CRM "clear connection" and team offboarding). */
    async function clearUserCrmCredentials(input: { userId: string; actorUserId?: string | null; expectedVersion?: number | null; tx?: TxClient }) {
        const existing = await settings.getDocument<Record<string, unknown>>({ ...scope(input.userId), tx: input.tx });
        if (existing) {
            await settings.upsertDocument({
                ...scope(input.userId),
                payload: { ...existing.payload, crmUsername: null },
                actorUserId: input.actorUserId ?? null,
                expectedVersion: input.expectedVersion ?? existing.version,
                schemaVersion: 1,
                tx: input.tx,
            });
        }
        await settings.clearSecret({ ...scope(input.userId), secretKey: SETTINGS_SECRET_KEYS.CRM_PASSWORD, actorUserId: input.actorUserId ?? null, tx: input.tx });
    }

    /**
     * The subset of `userIds` (order kept) with both a username and a stored password.
     * Two queries; nothing is decrypted.
     */
    async function filterUserIdsWithCrmCredentials(userIds: string[]): Promise<string[]> {
        if (!userIds.length) return [];
        const [secrets, documents] = await Promise.all([
            secretRows.findMany({
                where: { scopeType: "USER", domain: SETTINGS_DOMAINS.USER_CRM, secretKey: SETTINGS_SECRET_KEYS.CRM_PASSWORD, scopeId: { in: userIds } },
                select: { scopeId: true },
            }),
            documentRows.findMany({
                where: { scopeType: "USER", domain: SETTINGS_DOMAINS.USER_CRM, scopeId: { in: userIds } },
                select: { scopeId: true, payload: true },
            }),
        ]);
        const withPassword = new Set(secrets.map(row => row.scopeId));
        const withUsername = new Set(documents
            .filter(row => clean((row.payload as { crmUsername?: unknown } | null)?.crmUsername))
            .map(row => row.scopeId));
        return userIds.filter(id => withPassword.has(id) && withUsername.has(id));
    }

    return { getUserCrmUsername, getUserCrmCredentials, hasUserCrmPassword, setUserCrmCredentials, clearUserCrmCredentials, filterUserIdsWithCrmCredentials };
}

const crmCredentials = createUserCrmCredentials({
    settings: defaultSettingsService,
    secretRows: { findMany: (args) => db.settingsSecret.findMany(args) },
    documentRows: { findMany: (args) => db.settingsDocument.findMany(args) },
});

export const {
    getUserCrmUsername,
    getUserCrmCredentials,
    hasUserCrmPassword,
    setUserCrmCredentials,
    clearUserCrmCredentials,
    filterUserIdsWithCrmCredentials,
} = crmCredentials;
