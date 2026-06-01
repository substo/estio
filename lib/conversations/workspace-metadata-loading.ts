import db from "@/lib/db";
import { getLocationDefaultReplyLanguage } from "@/lib/ai/location-reply-language";
import type { Conversation } from "@/lib/ghl/conversations";
import type { ResolvedConversationForMessages } from "@/lib/conversations/message-loading";
import {
    buildConversationReferenceWhere,
} from "@/lib/conversations/identity";
import { mapConversationRowToUi } from "@/lib/conversations/conversation-row-mapper";
import { LATEST_MESSAGE_METADATA_SELECT } from "@/lib/conversations/latest-message-metadata";
import { unstable_cache } from "next/cache";

export type ConversationWorkspaceTaskSummary = {
    total: number;
    open: number;
    completed: number;
    highPriorityOpen: number;
    nextDueAt: string | null;
    latestUpdatedAt: string | null;
};

export type ConversationWorkspaceViewingSummary = {
    total: number;
    upcoming: number;
    completed: number;
    nextViewingAt: string | null;
    latestUpdatedAt: string | null;
};

export type ConversationWorkspaceAgentSummary = {
    hasPlan: boolean;
    totalPlanSteps: number;
    completedPlanSteps: number;
    latestExecutionAt: string | null;
    latestExecutionStatus: string | null;
};

export type ConversationWorkspaceMetadata = {
    conversationHeader: Conversation;
    contactContext: any;
    taskSummary: ConversationWorkspaceTaskSummary;
    viewingSummary: ConversationWorkspaceViewingSummary;
    agentSummary: ConversationWorkspaceAgentSummary;
    freshness: {
        generatedAt: string;
        conversationUpdatedAt: string | null;
        latestMessageAt: string | null;
        latestMessageUpdatedAt: string | null;
        latestActivityAt: string | null;
        threadStale: boolean;
    };
};

function serializeRequirementProposalSeed(row: any) {
    if (!row) return null;
    return {
        id: row.id,
        createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : String(row.createdAt || ""),
        updatedAt: row.updatedAt instanceof Date ? row.updatedAt.toISOString() : String(row.updatedAt || ""),
        locationId: row.locationId,
        contactId: row.contactId,
        conversationId: row.conversationId || null,
        sourceType: row.sourceType,
        sourceIds: row.sourceIds || [],
        status: row.status,
        currentSnapshot: row.currentSnapshot || null,
        proposedPatch: row.proposedPatch || null,
        proposedSummary: row.proposedSummary || null,
        evidence: row.evidence || null,
        confidence: row.confidence ?? null,
        reasoning: row.reasoning || null,
        model: row.model || null,
        promptTokens: row.promptTokens || 0,
        completionTokens: row.completionTokens || 0,
        totalTokens: row.totalTokens || 0,
        estimatedCostUsd: row.estimatedCostUsd || 0,
    };
}

async function getPendingRequirementProposalSeed(locationId: string, contactId: string) {
    const rows = await db.contactRequirementProposal.findMany({
        where: {
            locationId,
            contactId,
            status: "pending",
        },
        orderBy: { createdAt: "desc" },
        take: 5,
        select: {
            id: true,
            createdAt: true,
            updatedAt: true,
            locationId: true,
            contactId: true,
            conversationId: true,
            sourceType: true,
            sourceIds: true,
            status: true,
            currentSnapshot: true,
            proposedPatch: true,
            proposedSummary: true,
            evidence: true,
            confidence: true,
            reasoning: true,
            model: true,
            promptTokens: true,
            completionTokens: true,
            totalTokens: true,
            estimatedCostUsd: true,
        },
    });
    return rows.map(serializeRequirementProposalSeed).filter(Boolean);
}

export type ConversationWorkspaceCoreMetadata = {
    conversationHeader: Conversation;
    resolvedConversation: ResolvedConversationForMessages;
    freshness: {
        generatedAt: string;
        conversationUpdatedAt: string | null;
        latestMessageAt: string | null;
        latestMessageUpdatedAt: string | null;
        latestActivityAt: string | null;
        threadStale: boolean;
    };
};

export function normalizeContactContextRole(value: unknown): string {
    return String(value || "").trim().toLowerCase();
}

export function getContactContextInclude() {
    return {
        propertyRoles: {
            include: {
                property: {
                    select: {
                        id: true,
                        title: true,
                        reference: true,
                        price: true,
                    },
                },
            },
        },
        companyRoles: {
            include: {
                company: {
                    select: {
                        id: true,
                        name: true,
                        type: true,
                    },
                },
            },
        },
        viewings: {
            take: 5,
            orderBy: { date: "desc" as const },
            include: {
                property: {
                    select: {
                        id: true,
                        title: true,
                        reference: true,
                    },
                },
            },
        },
    };
}

export async function enrichContactContextContact(contact: any, locationId: string) {
    if (!contact) return null;

    const interestedPropertyIds: string[] = Array.from(new Set<string>(
        (Array.isArray(contact.propertiesInterested) ? contact.propertiesInterested : [])
            .map((id: any) => String(id || "").trim())
            .filter(Boolean)
    ));

    const [interestedPropertiesRaw, inspectedViewingRows] = await Promise.all([
        interestedPropertyIds.length > 0
            ? db.property.findMany({
                where: {
                    id: { in: interestedPropertyIds },
                    locationId,
                },
                select: {
                    id: true,
                    title: true,
                    reference: true,
                    price: true,
                },
            })
            : Promise.resolve([]),
        db.viewing.findMany({
            where: { contactId: contact.id },
            orderBy: [{ date: "desc" }, { updatedAt: "desc" }, { id: "desc" }],
            take: 50,
            select: {
                propertyId: true,
                date: true,
                property: {
                    select: {
                        id: true,
                        title: true,
                        reference: true,
                        price: true,
                    },
                },
            },
        }),
    ]);

    const interestedPropertyMap = new Map(
        interestedPropertiesRaw.map((property: any) => [property.id, property])
    );
    const interestedProperties = interestedPropertyIds
        .map((propertyId) => interestedPropertyMap.get(propertyId))
        .filter(Boolean);

    const inspectedByPropertyId = new Map<string, any>();
    for (const viewing of inspectedViewingRows) {
        const propertyId = String(viewing?.propertyId || "");
        if (!propertyId || inspectedByPropertyId.has(propertyId) || !viewing?.property) continue;
        inspectedByPropertyId.set(propertyId, {
            ...viewing.property,
            lastViewedAt: viewing.date ? new Date(viewing.date).toISOString() : null,
        });
    }

    const propertyRoles = (Array.isArray(contact.propertyRoles) ? contact.propertyRoles : []).map((role: any) => ({
        ...role,
        normalizedRole: normalizeContactContextRole(role?.role),
    }));
    const companyRoles = (Array.isArray(contact.companyRoles) ? contact.companyRoles : []).map((role: any) => ({
        ...role,
        normalizedRole: normalizeContactContextRole(role?.role),
    }));

    return {
        ...contact,
        propertyRoles,
        companyRoles,
        interestedProperties,
        inspectedProperties: Array.from(inspectedByPropertyId.values()),
        normalizedContactType: String(contact.contactType || "").trim().toLowerCase(),
        // TODO(whatsapp-groups): add relatedWhatsAppGroups once contact<->group relation support is implemented.
    };
}

export const getCachedActiveLeadSourceNames = unstable_cache(
    async (locationId: string) => {
        const leadSources = await db.leadSource.findMany({
            where: { locationId, isActive: true },
            select: { name: true },
            orderBy: { name: "asc" },
        });
        return leadSources.map((source) => source.name);
    },
    ["contacts:active-lead-source-names:v1"],
    {
        revalidate: 60,
        tags: ["contacts:lead-sources"],
    }
);

export async function getConversationContactContextSnapshot(locationId: string, contactId: string) {
    const [contact, leadSources, requirementProposals] = await Promise.all([
        db.contact.findFirst({
            where: {
                id: contactId,
                locationId,
            },
            include: getContactContextInclude(),
        }),
        getCachedActiveLeadSourceNames(locationId),
        getPendingRequirementProposalSeed(locationId, contactId),
    ]);

    const hydratedContact = await enrichContactContextContact(contact, locationId);

    return {
        contact: hydratedContact,
        leadSources,
        requirementProposals,
    };
}

export function parsePlanSteps(plan: unknown) {
    const steps = Array.isArray(plan) ? plan : [];
    let completed = 0;
    for (const step of steps) {
        const status = String((step as any)?.status || "").toLowerCase();
        if (status === "done" || status === "completed" || status === "success") completed += 1;
    }
    return {
        total: steps.length,
        completed,
    };
}

function isLikelyWhatsAppConversation(lastMessageType: string | null | undefined): boolean {
    return String(lastMessageType || "").toUpperCase().includes("WHATSAPP");
}

export async function queryConversationWorkspaceCoreMetadata(args: {
    locationId: string;
    locationGhlId?: string | null;
    conversationId: string;
}) {
    const conversation = await db.conversation.findFirst({
        where: buildConversationReferenceWhere(args.locationId, args.conversationId),
        include: {
            contact: {
                select: {
                    id: true,
                    name: true,
                    email: true,
                    phone: true,
                    ghlContactId: true,
                    preferredLang: true,
                },
            },
        },
    });

    if (!conversation) return null;
    const conversationRefs = [conversation.id, conversation.ghlConversationId].filter(Boolean) as string[];

    const [activeDealRows, latestMessage, latestActivity] = await Promise.all([
        db.dealContext.findMany({
            where: {
                locationId: args.locationId,
                stage: "ACTIVE",
                OR: [
                    { conversationLinks: { some: { conversationId: conversation.id } } },
                    { conversationIds: { hasSome: conversationRefs } },
                ],
            },
            select: { id: true, title: true },
            take: 1,
        }),
        db.message.findFirst({
            where: { conversationId: conversation.id },
            select: LATEST_MESSAGE_METADATA_SELECT,
            orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        }),
        db.contactHistory.findFirst({
            where: { contactId: conversation.contactId },
            select: { createdAt: true },
            orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        }),
    ]);

    const dealMap = new Map<string, { id: string; title: string }>();
    for (const row of activeDealRows) {
        dealMap.set(conversation.id, { id: row.id, title: row.title });
        if (conversation.ghlConversationId) {
            dealMap.set(conversation.ghlConversationId, { id: row.id, title: row.title });
        }
    }
    const locationDefaultReplyLanguage = await getLocationDefaultReplyLanguage(args.locationId);

    const latestMessageAtIso = conversation.lastMessageAt ? new Date(conversation.lastMessageAt).toISOString() : null;
    const nowMs = Date.now();
    const threadStale = isLikelyWhatsAppConversation(conversation.lastMessageType)
        && (!!latestMessageAtIso && (nowMs - new Date(latestMessageAtIso).getTime()) > 5 * 60 * 1000);

    return {
        conversationHeader: mapConversationRowToUi(
            { ...conversation, latestMessage },
            { ghlLocationId: args.locationGhlId || null },
            dealMap,
            locationDefaultReplyLanguage,
        ),
        resolvedConversation: {
            id: conversation.id,
            ghlConversationId: conversation.ghlConversationId || null,
            contactId: conversation.contactId || null,
            replyLanguageOverride: conversation.replyLanguageOverride || null,
            contact: {
                ghlContactId: conversation.contact?.ghlContactId || null,
            },
        },
        freshness: {
            generatedAt: new Date().toISOString(),
            conversationUpdatedAt: conversation.updatedAt ? new Date(conversation.updatedAt).toISOString() : null,
            latestMessageAt: latestMessageAtIso,
            latestMessageUpdatedAt: latestMessage?.updatedAt ? new Date(latestMessage.updatedAt).toISOString() : null,
            latestActivityAt: latestActivity?.createdAt ? new Date(latestActivity.createdAt).toISOString() : null,
            threadStale,
        },
    } satisfies ConversationWorkspaceCoreMetadata;
}

export async function queryConversationWorkspaceMetadata(args: {
    locationId: string;
    locationGhlId?: string | null;
    conversationId: string;
}) {
    const conversation = await db.conversation.findFirst({
        where: buildConversationReferenceWhere(args.locationId, args.conversationId),
        include: {
            contact: {
                select: {
                    id: true,
                    name: true,
                    email: true,
                    phone: true,
                    ghlContactId: true,
                    preferredLang: true,
                },
            },
        },
    });

    if (!conversation) return null;
    const conversationRefs = [conversation.id, conversation.ghlConversationId].filter(Boolean) as string[];

    const [activeDealRows, contactContext, taskMetrics, viewingMetrics, latestExecution, latestMessage, latestActivity] = await Promise.all([
        db.dealContext.findMany({
            where: {
                locationId: args.locationId,
                stage: "ACTIVE",
                OR: [
                    { conversationLinks: { some: { conversationId: conversation.id } } },
                    { conversationIds: { hasSome: conversationRefs } },
                ],
            },
            select: { id: true, title: true },
            take: 1,
        }),
        getConversationContactContextSnapshot(args.locationId, conversation.contactId),
        (async () => {
            const [total, open, completed, highPriorityOpen, nextDueTask, latestTask] = await Promise.all([
                db.contactTask.count({
                    where: {
                        locationId: args.locationId,
                        conversationId: conversation.id,
                        deletedAt: null,
                    },
                }),
                db.contactTask.count({
                    where: {
                        locationId: args.locationId,
                        conversationId: conversation.id,
                        deletedAt: null,
                        status: { in: ["open", "pending", "in_progress"] },
                    },
                }),
                db.contactTask.count({
                    where: {
                        locationId: args.locationId,
                        conversationId: conversation.id,
                        deletedAt: null,
                        status: { in: ["completed", "done"] },
                    },
                }),
                db.contactTask.count({
                    where: {
                        locationId: args.locationId,
                        conversationId: conversation.id,
                        deletedAt: null,
                        status: { in: ["open", "pending", "in_progress"] },
                        priority: "high",
                    },
                }),
                db.contactTask.findFirst({
                    where: {
                        locationId: args.locationId,
                        conversationId: conversation.id,
                        deletedAt: null,
                        status: { in: ["open", "pending", "in_progress"] },
                        dueAt: { not: null },
                    },
                    select: { dueAt: true },
                    orderBy: [{ dueAt: "asc" }],
                }),
                db.contactTask.findFirst({
                    where: {
                        locationId: args.locationId,
                        conversationId: conversation.id,
                        deletedAt: null,
                    },
                    select: { updatedAt: true },
                    orderBy: [{ updatedAt: "desc" }],
                }),
            ]);

            return {
                total,
                open,
                completed,
                highPriorityOpen,
                nextDueAt: nextDueTask?.dueAt ? new Date(nextDueTask.dueAt).toISOString() : null,
                latestUpdatedAt: latestTask?.updatedAt ? new Date(latestTask.updatedAt).toISOString() : null,
            } satisfies ConversationWorkspaceTaskSummary;
        })(),
        (async () => {
            const [total, upcoming, completed, nextViewing, latestViewing] = await Promise.all([
                db.viewing.count({
                    where: { contactId: conversation.contactId },
                }),
                db.viewing.count({
                    where: {
                        contactId: conversation.contactId,
                        date: { gte: new Date() },
                    },
                }),
                db.viewing.count({
                    where: {
                        contactId: conversation.contactId,
                        status: { in: ["completed", "done"] },
                    },
                }),
                db.viewing.findFirst({
                    where: {
                        contactId: conversation.contactId,
                        date: { gte: new Date() },
                    },
                    select: { date: true },
                    orderBy: [{ date: "asc" }],
                }),
                db.viewing.findFirst({
                    where: {
                        contactId: conversation.contactId,
                    },
                    select: { updatedAt: true },
                    orderBy: [{ updatedAt: "desc" }],
                }),
            ]);

            return {
                total,
                upcoming,
                completed,
                nextViewingAt: nextViewing?.date ? new Date(nextViewing.date).toISOString() : null,
                latestUpdatedAt: latestViewing?.updatedAt ? new Date(latestViewing.updatedAt).toISOString() : null,
            } satisfies ConversationWorkspaceViewingSummary;
        })(),
        db.agentExecution.findFirst({
            where: { conversationId: conversation.id },
            select: {
                createdAt: true,
                status: true,
            },
            orderBy: { createdAt: "desc" },
        }),
        db.message.findFirst({
            where: { conversationId: conversation.id },
            select: LATEST_MESSAGE_METADATA_SELECT,
            orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        }),
        db.contactHistory.findFirst({
            where: { contactId: conversation.contactId },
            select: { createdAt: true },
            orderBy: { createdAt: "desc" },
        }),
    ]);

    const dealMap = new Map<string, { id: string; title: string }>();
    for (const row of activeDealRows) {
        dealMap.set(conversation.id, { id: row.id, title: row.title });
        if (conversation.ghlConversationId) {
            dealMap.set(conversation.ghlConversationId, { id: row.id, title: row.title });
        }
    }
    const locationDefaultReplyLanguage = await getLocationDefaultReplyLanguage(args.locationId);

    const parsedPlan = parsePlanSteps(conversation.agentPlan);
    const latestMessageAtIso = conversation.lastMessageAt ? new Date(conversation.lastMessageAt).toISOString() : null;
    const nowMs = Date.now();
    const threadStale = isLikelyWhatsAppConversation(conversation.lastMessageType)
        && (!!latestMessageAtIso && (nowMs - new Date(latestMessageAtIso).getTime()) > 5 * 60 * 1000);

    return {
        conversationHeader: mapConversationRowToUi(
            { ...conversation, latestMessage },
            { ghlLocationId: args.locationGhlId || null },
            dealMap,
            locationDefaultReplyLanguage,
        ),
        contactContext,
        taskSummary: taskMetrics,
        viewingSummary: viewingMetrics,
        agentSummary: {
            hasPlan: parsedPlan.total > 0,
            totalPlanSteps: parsedPlan.total,
            completedPlanSteps: parsedPlan.completed,
            latestExecutionAt: latestExecution?.createdAt ? new Date(latestExecution.createdAt).toISOString() : null,
            latestExecutionStatus: latestExecution?.status || null,
        },
        freshness: {
            generatedAt: new Date().toISOString(),
            conversationUpdatedAt: conversation.updatedAt ? new Date(conversation.updatedAt).toISOString() : null,
            latestMessageAt: latestMessageAtIso,
            latestMessageUpdatedAt: latestMessage?.updatedAt ? new Date(latestMessage.updatedAt).toISOString() : null,
            latestActivityAt: latestActivity?.createdAt ? new Date(latestActivity.createdAt).toISOString() : null,
            threadStale,
        },
    } satisfies ConversationWorkspaceMetadata;
}

export const getCachedConversationWorkspaceCoreMetadata = unstable_cache(
    async (locationId: string, locationGhlId: string | null, conversationId: string) =>
        queryConversationWorkspaceCoreMetadata({ locationId, locationGhlId, conversationId }),
    ["conversations:workspace:core:metadata:v2"],
    {
        revalidate: 8,
        tags: ["conversations:workspace", "conversations:workspace:core"],
    }
);

export const getCachedConversationWorkspaceSidebarMetadata = unstable_cache(
    async (locationId: string, locationGhlId: string | null, conversationId: string) =>
        queryConversationWorkspaceMetadata({ locationId, locationGhlId, conversationId }),
    ["conversations:workspace:sidebar:metadata:v1"],
    {
        revalidate: 15,
        tags: ["conversations:workspace", "conversations:workspace:sidebar"],
    }
);
