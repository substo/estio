import type { Prisma } from "@prisma/client";
import { settingsService } from "@/lib/settings/service";
import { SETTINGS_DOMAINS, SETTINGS_SECRET_KEYS } from "@/lib/settings/constants";
import { findUserSecretKeys } from "@/lib/settings/user-secrets";

/**
 * A person's Outlook credentials live only in encrypted USER-scope secrets (domain user.integrations.microsoft):
 * OAuth access/refresh tokens, and for the browser (Puppeteer) sign-in the password and session cookies (JSON).
 * The former token, password and cookie columns on User are dropped. Server-only.
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
    return (await settingsService.getSecret({ ...scope(userId), secretKey: SETTINGS_SECRET_KEYS.OUTLOOK_PASSWORD })) || null;
}

export async function getOutlookBrowserCookies<T = unknown>(userId: string): Promise<T[] | null> {
    const json = await settingsService.getSecret({ ...scope(userId), secretKey: SETTINGS_SECRET_KEYS.OUTLOOK_SESSION_COOKIES });
    if (!json) return null;
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? parsed as T[] : null;
}

export async function saveOutlookBrowserCredentials(userId: string, input: { password: string; cookies: unknown[] }) {
    await settingsService.setSecret({ ...scope(userId), secretKey: SETTINGS_SECRET_KEYS.OUTLOOK_PASSWORD, plaintext: input.password, actorUserId: userId });
    await settingsService.setSecret({ ...scope(userId), secretKey: SETTINGS_SECRET_KEYS.OUTLOOK_SESSION_COOKIES, plaintext: JSON.stringify(input.cookies), actorUserId: userId });
}

/** Removes every Outlook secret (OAuth and browser) for the user: disconnect and offboarding. */
export async function clearOutlookSecrets(input: { userId: string; actorUserId?: string | null; tx?: TxClient }) {
    for (const secretKey of OUTLOOK_SECRET_KEYS) {
        await settingsService.clearSecret({ ...scope(input.userId), secretKey, actorUserId: input.actorUserId ?? input.userId, tx: input.tx });
    }
}

// --- Presence (no decryption) ---

export async function getOutlookCredentialPresenceForUsers(userIds?: readonly string[]): Promise<Map<string, OutlookCredentialPresence>> {
    const secrets = await findUserSecretKeys({ domain: SETTINGS_DOMAINS.USER_MICROSOFT_INTEGRATIONS, secretKeys: OUTLOOK_SECRET_KEYS, userIds });
    const result = new Map<string, OutlookCredentialPresence>();
    for (const [id, keys] of secrets) {
        result.set(id, {
            accessToken: keys.has(SETTINGS_SECRET_KEYS.OUTLOOK_ACCESS_TOKEN),
            refreshToken: keys.has(SETTINGS_SECRET_KEYS.OUTLOOK_REFRESH_TOKEN),
            password: keys.has(SETTINGS_SECRET_KEYS.OUTLOOK_PASSWORD),
            sessionCookies: keys.has(SETTINGS_SECRET_KEYS.OUTLOOK_SESSION_COOKIES),
        });
    }
    return result;
}

const NO_OUTLOOK_CREDENTIALS: OutlookCredentialPresence = { accessToken: false, refreshToken: false, password: false, sessionCookies: false };

export async function getOutlookCredentialPresence(userId: string): Promise<OutlookCredentialPresence> {
    return (await getOutlookCredentialPresenceForUsers([userId])).get(userId) ?? NO_OUTLOOK_CREDENTIALS;
}
