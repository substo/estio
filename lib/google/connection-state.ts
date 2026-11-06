export function resolveGoogleConnectionState(input: {
    syncEnabled: boolean;
    hasEncryptedAccessToken: boolean;
    hasEncryptedRefreshToken: boolean;
}): boolean {
    return input.syncEnabled && (input.hasEncryptedAccessToken || input.hasEncryptedRefreshToken);
}
