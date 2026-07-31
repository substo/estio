export function requireActivePropertyLocation(
    activeLocationId: string | null | undefined,
    requestedLocationId?: string | null,
): string {
    if (!activeLocationId) {
        throw new Error("Unauthorized");
    }

    if (requestedLocationId && requestedLocationId !== activeLocationId) {
        throw new Error("Unauthorized: Location context mismatch");
    }

    return activeLocationId;
}

export function findIdsOutsideLocation(
    requestedIds: Array<string | null | undefined>,
    locationEntityIds: Iterable<string>,
): string[] {
    const allowedIds = new Set(locationEntityIds);

    return Array.from(new Set(requestedIds.filter((id): id is string => Boolean(id))))
        .filter((id) => !allowedIds.has(id));
}
