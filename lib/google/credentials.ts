import type { Prisma } from "@prisma/client";
import { settingsService } from "@/lib/settings/service";
import { SETTINGS_DOMAINS, SETTINGS_SECRET_KEYS } from "@/lib/settings/constants";
import { findUserSecretKeys } from "@/lib/settings/user-secrets";

/**
 * A person's Google OAuth tokens and People sync cursor live only in encrypted USER-scope secrets
 * (domain user.integrations.google). The former plain token and sync-token columns on User are dropped.
 * Server-only.
 */

type TxClient = Prisma.TransactionClient;

const scope = (userId: string) => ({
    scopeType: "USER" as const,
    scopeId: userId,
    domain: SETTINGS_DOMAINS.USER_GOOGLE_INTEGRATIONS,
});

export const GOOGLE_TOKEN_SECRET_KEYS = [
    SETTINGS_SECRET_KEYS.GOOGLE_ACCESS_TOKEN,
    SETTINGS_SECRET_KEYS.GOOGLE_REFRESH_TOKEN,
] as const;

export const GOOGLE_SECRET_KEYS = [...GOOGLE_TOKEN_SECRET_KEYS, SETTINGS_SECRET_KEYS.GOOGLE_SYNC_TOKEN] as const;

export async function getGoogleTokens(userId: string): Promise<{ accessToken: string | null; refreshToken: string | null }> {
    const [accessToken, refreshToken] = await Promise.all([
        settingsService.getSecret({ ...scope(userId), secretKey: SETTINGS_SECRET_KEYS.GOOGLE_ACCESS_TOKEN }),
        settingsService.getSecret({ ...scope(userId), secretKey: SETTINGS_SECRET_KEYS.GOOGLE_REFRESH_TOKEN }),
    ]);
    return { accessToken: accessToken || null, refreshToken: refreshToken || null };
}

/** Stores new tokens. Google may omit the refresh token on reconnect/refresh; the stored one is then kept. */
export async function setGoogleTokens(userId: string, tokens: { accessToken: string; refreshToken?: string | null }, actorUserId: string | null = userId) {
    await settingsService.setSecret({ ...scope(userId), secretKey: SETTINGS_SECRET_KEYS.GOOGLE_ACCESS_TOKEN, plaintext: tokens.accessToken, actorUserId });
    if (tokens.refreshToken) {
        await settingsService.setSecret({ ...scope(userId), secretKey: SETTINGS_SECRET_KEYS.GOOGLE_REFRESH_TOKEN, plaintext: tokens.refreshToken, actorUserId });
    }
}

export async function getGoogleSyncToken(userId: string): Promise<string | null> {
    return (await settingsService.getSecret({ ...scope(userId), secretKey: SETTINGS_SECRET_KEYS.GOOGLE_SYNC_TOKEN })) || null;
}

export async function setGoogleSyncToken(userId: string, syncToken: string | null) {
    if (syncToken) {
        await settingsService.setSecret({ ...scope(userId), secretKey: SETTINGS_SECRET_KEYS.GOOGLE_SYNC_TOKEN, plaintext: syncToken, actorUserId: userId });
    } else {
        await settingsService.clearSecret({ ...scope(userId), secretKey: SETTINGS_SECRET_KEYS.GOOGLE_SYNC_TOKEN, actorUserId: userId });
    }
}

/** Removes the tokens and the sync cursor (disconnect, offboarding). */
export async function clearGoogleSecrets(
    input: { userId: string; actorUserId?: string | null; requestId?: string | null; tx?: TxClient },
    dependencies: Pick<typeof settingsService, "clearSecret"> = settingsService,
) {
    for (const secretKey of GOOGLE_SECRET_KEYS) {
        await dependencies.clearSecret({
            ...scope(input.userId),
            secretKey,
            actorUserId: input.actorUserId ?? input.userId,
            requestId: input.requestId ?? null,
            tx: input.tx,
        });
    }
}

/** The users (of `userIds`, or all) holding a Google access or refresh token. No decryption. */
export async function findUsersWithGoogleTokens(userIds?: readonly string[], options: { requireRefreshToken?: boolean } = {}): Promise<Set<string>> {
    const keys = options.requireRefreshToken ? [SETTINGS_SECRET_KEYS.GOOGLE_REFRESH_TOKEN] : GOOGLE_TOKEN_SECRET_KEYS;
    return new Set((await findUserSecretKeys({ domain: SETTINGS_DOMAINS.USER_GOOGLE_INTEGRATIONS, secretKeys: keys, userIds })).keys());
}

export async function hasGoogleTokens(userId: string, options: { requireRefreshToken?: boolean } = {}): Promise<boolean> {
    return (await findUsersWithGoogleTokens([userId], options)).has(userId);
}
