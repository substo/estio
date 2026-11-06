import type { Prisma } from "@prisma/client";
import db from "@/lib/db";
import { decryptPassword } from "@/lib/crypto/password-encryption";
import { settingsService } from "@/lib/settings/service";
import { SETTINGS_DOMAINS, SETTINGS_SECRET_KEYS } from "@/lib/settings/constants";
import { findUserSecretKeys } from "@/lib/settings/user-secrets";

/**
 * A person's Outlook credentials live only in encrypted USER-scope secrets (domain user.integrations.microsoft):
 * OAuth access/refresh tokens, and for the browser (Puppeteer) sign-in the password and session cookies (JSON).
 * The OAuth token columns on User are dropped.
 *
 * Transition: the browser password and cookies used to be app-encrypted in User.outlookPasswordEncrypted /
 * User.outlookSessionCookies. Until scripts/settings/move-legacy-credentials.ts --apply has run and the drop
 * migration is deployed, readers here fall back to those columns; writers store secrets and clear the columns.
 * Server-only.
 */

type TxClient = Prisma.TransactionClient;

const scope = (userId: string) => ({
    scopeType: "USER" as const,
    scopeId: userId,
    domain: SETTINGS_DOMAINS.USER_MICROSOFT_INTEGRATIONS,
});

export const OUTLOOK_SECRET_KEYS = [
    SETTINGS_SECRET_KEYS.OUTLOOK_ACCESS_TOKEN,
    SETTINGS_SECRET_KEYS.OUTLOOK_REFRESH_TOKEN,
    SETTINGS_SECRET_KEYS.OUTLOOK_PASSWORD,
    SETTINGS_SECRET_KEYS.OUTLOOK_SESSION_COOKIES,
] as const;

export type OutlookCredentialPresence = {
    accessToken: boolean;
    refreshToken: boolean;
    password: boolean;
    sessionCookies: boolean;
};

// --- OAuth ---

export async function getOutlookOAuthTokens(userId: string): Promise<{ accessToken: string | null; refreshToken: string | null }> {
    const [accessToken, refreshToken] = await Promise.all([
        settingsService.getSecret({ ...scope(userId), secretKey: SETTINGS_SECRET_KEYS.OUTLOOK_ACCESS_TOKEN }),
        settingsService.getSecret({ ...scope(userId), secretKey: SETTINGS_SECRET_KEYS.OUTLOOK_REFRESH_TOKEN }),
    ]);
    return { accessToken: accessToken || null, refreshToken: refreshToken || null };
}

export async function setOutlookOAuthTokens(userId: string, tokens: { accessToken: string; refreshToken?: string | null }) {
    await settingsService.setSecret({ ...scope(userId), secretKey: SETTINGS_SECRET_KEYS.OUTLOOK_ACCESS_TOKEN, plaintext: tokens.accessToken, actorUserId: userId });
    if (tokens.refreshToken) {
        await settingsService.setSecret({ ...scope(userId), secretKey: SETTINGS_SECRET_KEYS.OUTLOOK_REFRESH_TOKEN, plaintext: tokens.refreshToken, actorUserId: userId });
    }
}

// --- Browser (Puppeteer) sign-in ---

export async function getOutlookBrowserPassword(userId: string): Promise<string | null> {
    const secret = await settingsService.getSecret({ ...scope(userId), secretKey: SETTINGS_SECRET_KEYS.OUTLOOK_PASSWORD });
    if (secret) return secret;
    const legacy = await readLegacyBrowserColumns(userId);
    return legacy?.outlookPasswordEncrypted ? decryptPassword(legacy.outlookPasswordEncrypted) : null;
}

export async function getOutlookBrowserCookies<T = unknown>(userId: string): Promise<T[] | null> {
    const secret = await settingsService.getSecret({ ...scope(userId), secretKey: SETTINGS_SECRET_KEYS.OUTLOOK_SESSION_COOKIES });
    const json = secret
        ?? await readLegacyBrowserColumns(userId).then(legacy => legacy?.outlookSessionCookies ? decryptPassword(legacy.outlookSessionCookies) : null);
    if (!json) return null;
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? parsed as T[] : null;
}

export async function saveOutlookBrowserCredentials(userId: string, input: { password: string; cookies: unknown[] }) {
    await settingsService.setSecret({ ...scope(userId), secretKey: SETTINGS_SECRET_KEYS.OUTLOOK_PASSWORD, plaintext: input.password, actorUserId: userId });
    await settingsService.setSecret({ ...scope(userId), secretKey: SETTINGS_SECRET_KEYS.OUTLOOK_SESSION_COOKIES, plaintext: JSON.stringify(input.cookies), actorUserId: userId });
    await clearLegacyBrowserColumns(userId);
}

/** Removes every Outlook secret (OAuth and browser) for the user: disconnect and offboarding. */
export async function clearOutlookSecrets(input: { userId: string; actorUserId?: string | null; tx?: TxClient }) {
    for (const secretKey of OUTLOOK_SECRET_KEYS) {
        await settingsService.clearSecret({ ...scope(input.userId), secretKey, actorUserId: input.actorUserId ?? input.userId, tx: input.tx });
    }
    await clearLegacyBrowserColumns(input.userId, input.tx);
}

// --- Presence (no decryption) ---

export async function getOutlookCredentialPresenceForUsers(userIds?: readonly string[]): Promise<Map<string, OutlookCredentialPresence>> {
    const [secrets, legacy] = await Promise.all([
        findUserSecretKeys({ domain: SETTINGS_DOMAINS.USER_MICROSOFT_INTEGRATIONS, secretKeys: OUTLOOK_SECRET_KEYS, userIds }),
        readLegacyBrowserPresence(userIds),
    ]);
    const result = new Map<string, OutlookCredentialPresence>();
    for (const id of new Set([...secrets.keys(), ...legacy.keys()])) {
        const keys = secrets.get(id) ?? new Set<string>();
        const old = legacy.get(id);
        result.set(id, {
            accessToken: keys.has(SETTINGS_SECRET_KEYS.OUTLOOK_ACCESS_TOKEN),
            refreshToken: keys.has(SETTINGS_SECRET_KEYS.OUTLOOK_REFRESH_TOKEN),
            password: keys.has(SETTINGS_SECRET_KEYS.OUTLOOK_PASSWORD) || Boolean(old?.password),
            sessionCookies: keys.has(SETTINGS_SECRET_KEYS.OUTLOOK_SESSION_COOKIES) || Boolean(old?.sessionCookies),
        });
    }
    return result;
}

const NO_OUTLOOK_CREDENTIALS: OutlookCredentialPresence = { accessToken: false, refreshToken: false, password: false, sessionCookies: false };

export async function getOutlookCredentialPresence(userId: string): Promise<OutlookCredentialPresence> {
    return (await getOutlookCredentialPresenceForUsers([userId])).get(userId) ?? NO_OUTLOOK_CREDENTIALS;
}

// --- Transition only: app-encrypted browser columns (removed with the drop migration) ---

async function readLegacyBrowserColumns(userId: string) {
    return db.user.findUnique({ where: { id: userId }, select: { outlookPasswordEncrypted: true, outlookSessionCookies: true } });
}

async function readLegacyBrowserPresence(userIds?: readonly string[]) {
    const rows = await db.user.findMany({
        where: {
            ...(userIds ? { id: { in: [...userIds] } } : {}),
            OR: [{ outlookPasswordEncrypted: { not: null } }, { outlookSessionCookies: { not: null } }],
        },
        select: { id: true, outlookPasswordEncrypted: true, outlookSessionCookies: true },
    });
    return new Map(rows.map(row => [row.id, { password: Boolean(row.outlookPasswordEncrypted), sessionCookies: Boolean(row.outlookSessionCookies) }]));
}

async function clearLegacyBrowserColumns(userId: string, tx?: TxClient) {
    await (tx ?? db).user.updateMany({
        where: { id: userId, OR: [{ outlookPasswordEncrypted: { not: null } }, { outlookSessionCookies: { not: null } }] },
        data: { outlookPasswordEncrypted: null, outlookSessionCookies: null },
    });
}
