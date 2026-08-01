import type { Prisma } from "@prisma/client";
import type { ActiveContactsAccess, ContactScope } from "@/lib/contacts/active-location-access";

export type DealScope = ContactScope;

export function resolveDealScope(access: ActiveContactsAccess, requestedScope?: string | null): DealScope {
    return access.role === "ADMIN" && requestedScope === "location" ? "location" : "my";
}

export function buildDealVisibilityWhere(
    access: ActiveContactsAccess,
    requestedScope?: string | null,
): Prisma.DealContextWhereInput {
    return {
        locationId: access.locationId,
        ...(resolveDealScope(access, requestedScope) === "my"
            ? { assignedUserId: access.internalUserId }
            : {}),
    };
}

export function buildDealManageWhere(access: ActiveContactsAccess): Prisma.DealContextWhereInput {
    return {
        locationId: access.locationId,
        ...(access.role === "ADMIN" ? {} : { assignedUserId: access.internalUserId }),
    };
}
