export function resolveGoogleConnectionState(input: {
    syncEnabled: boolean;
    hasEncryptedAccessToken: boolean;
    hasEncryptedRefreshToken: boolean;
    legacyAccessToken: string | null;
    legacyRefreshToken: string | null;
}): boolean {
    const hasUsableCredential = input.hasEncryptedAccessToken
        || input.hasEncryptedRefreshToken
        || Boolean(input.legacyAccessToken)
        || Boolean(input.legacyRefreshToken);

    return input.syncEnabled && hasUsableCredential;
}
