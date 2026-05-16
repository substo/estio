export function buildGhlDisconnectData(mode?: string | null) {
    const fullUnlink = mode === "full_unlink";
    return {
        ghlAccessToken: null,
        ghlRefreshToken: null,
        ghlTokenType: null,
        ghlExpiresAt: null,
        ghlScopes: null,
        ...(fullUnlink
            ? {
                ghlLocationId: null,
                ghlAgencyId: null,
                ghlInstallId: null,
            }
            : {}),
    };
}
