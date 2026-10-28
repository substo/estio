export function canSaveBrandProfile(input: { locationId: string; activeLocationId: string | null; role: string | null; sessionUserId: string | null; accessUserId: string | null; impersonating: boolean }) {
    return Boolean(input.locationId && input.locationId === input.activeLocationId && input.role === 'ADMIN'
        && input.sessionUserId && input.sessionUserId === input.accessUserId && !input.impersonating);
}
