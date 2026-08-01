import type { Prisma } from "@prisma/client";
import {
    resolveContactScope,
    type ActiveContactsAccess,
    type ContactScope,
} from "@/lib/contacts/active-location-access";

export type ConversationScope = ContactScope;

export function resolveConversationScope(
    access: ActiveContactsAccess,
    requestedScope?: string | null,
): ConversationScope {
    return resolveContactScope(access, requestedScope);
}

export function buildConversationVisibilityWhere(
    access: ActiveContactsAccess,
    requestedScope?: string | null,
): Prisma.ConversationWhereInput {
    const scope = resolveConversationScope(access, requestedScope);
    return {
        locationId: access.locationId,
        ...(scope === "my"
            ? {
                contact: {
                    is: {
                        locationId: access.locationId,
                        assignedUserId: access.internalUserId,
                    },
                },
            }
            : {}),
    };
}

export function buildMessageVisibilityWhere(
    access: ActiveContactsAccess,
    requestedScope?: string | null,
): Prisma.MessageWhereInput {
    return {
        conversation: {
            is: buildConversationVisibilityWhere(access, requestedScope),
        },
    };
}

export function getConversationAssignmentUserId(
    access: ActiveContactsAccess,
    requestedScope?: string | null,
): string | undefined {
    return resolveConversationScope(access, requestedScope) === "my"
        ? access.internalUserId
        : undefined;
}
