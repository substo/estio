import type { Prisma, PrismaClient } from "@prisma/client";

type ConversationMergeClient = Prisma.TransactionClient | PrismaClient;

export type ConversationMergeRelationEffects = {
    moved: number;
    deduped: number;
};

export type ConversationMergeMovableEffects = {
    moved: number;
    detached: number;
};

export type ConversationMergeEffects = {
    messagesMoved: number;
    messageSyncRecordsUpdated: number;
    messageTranslationCachesUpdated: number;
    providerOutboxJobsUpdated: number;
    whatsappOutboundOutboxJobsUpdated: number;
    smsRelayOutboxJobsUpdated: number;
    participants: ConversationMergeRelationEffects;
    syncRecords: ConversationMergeRelationEffects;
    tasksMoved: number;
    dealLinks: ConversationMergeRelationEffects;
    insightsMoved: number;
    agentExecutions: ConversationMergeMovableEffects;
    aiAutomationJobs: ConversationMergeMovableEffects;
    aiDecisions: ConversationMergeMovableEffects;
    aiSuggestedResponses: ConversationMergeMovableEffects;
    userNotifications: ConversationMergeMovableEffects;
    warnings: string[];
};

export type ConversationMergeEffectSummary = {
    messageAdjacentRecordsUpdated: number;
    aiChildRecordsMoved: number;
    aiChildRecordsDetached: number;
};

const READ_MESSAGE_STATUSES = new Set(["read", "played"]);

export function emptyConversationMergeEffects(): ConversationMergeEffects {
    return {
        messagesMoved: 0,
        messageSyncRecordsUpdated: 0,
        messageTranslationCachesUpdated: 0,
        providerOutboxJobsUpdated: 0,
        whatsappOutboundOutboxJobsUpdated: 0,
        smsRelayOutboxJobsUpdated: 0,
        participants: { moved: 0, deduped: 0 },
        syncRecords: { moved: 0, deduped: 0 },
        tasksMoved: 0,
        dealLinks: { moved: 0, deduped: 0 },
        insightsMoved: 0,
        agentExecutions: { moved: 0, detached: 0 },
        aiAutomationJobs: { moved: 0, detached: 0 },
        aiDecisions: { moved: 0, detached: 0 },
        aiSuggestedResponses: { moved: 0, detached: 0 },
        userNotifications: { moved: 0, detached: 0 },
        warnings: [],
    };
}

export function combineConversationMergeEffects(effects: ConversationMergeEffects[]): ConversationMergeEffects {
    return effects.reduce((combined, effect) => ({
        messagesMoved: combined.messagesMoved + effect.messagesMoved,
        messageSyncRecordsUpdated: combined.messageSyncRecordsUpdated + effect.messageSyncRecordsUpdated,
        messageTranslationCachesUpdated: combined.messageTranslationCachesUpdated + effect.messageTranslationCachesUpdated,
        providerOutboxJobsUpdated: combined.providerOutboxJobsUpdated + effect.providerOutboxJobsUpdated,
        whatsappOutboundOutboxJobsUpdated: combined.whatsappOutboundOutboxJobsUpdated + effect.whatsappOutboundOutboxJobsUpdated,
        smsRelayOutboxJobsUpdated: combined.smsRelayOutboxJobsUpdated + effect.smsRelayOutboxJobsUpdated,
        participants: {
            moved: combined.participants.moved + effect.participants.moved,
            deduped: combined.participants.deduped + effect.participants.deduped,
        },
        syncRecords: {
            moved: combined.syncRecords.moved + effect.syncRecords.moved,
            deduped: combined.syncRecords.deduped + effect.syncRecords.deduped,
        },
        tasksMoved: combined.tasksMoved + effect.tasksMoved,
        dealLinks: {
            moved: combined.dealLinks.moved + effect.dealLinks.moved,
            deduped: combined.dealLinks.deduped + effect.dealLinks.deduped,
        },
        insightsMoved: combined.insightsMoved + effect.insightsMoved,
        agentExecutions: {
            moved: combined.agentExecutions.moved + effect.agentExecutions.moved,
            detached: combined.agentExecutions.detached + effect.agentExecutions.detached,
        },
        aiAutomationJobs: {
            moved: combined.aiAutomationJobs.moved + effect.aiAutomationJobs.moved,
            detached: combined.aiAutomationJobs.detached + effect.aiAutomationJobs.detached,
        },
        aiDecisions: {
            moved: combined.aiDecisions.moved + effect.aiDecisions.moved,
            detached: combined.aiDecisions.detached + effect.aiDecisions.detached,
        },
        aiSuggestedResponses: {
            moved: combined.aiSuggestedResponses.moved + effect.aiSuggestedResponses.moved,
            detached: combined.aiSuggestedResponses.detached + effect.aiSuggestedResponses.detached,
        },
        userNotifications: {
            moved: combined.userNotifications.moved + effect.userNotifications.moved,
            detached: combined.userNotifications.detached + effect.userNotifications.detached,
        },
        warnings: [...combined.warnings, ...effect.warnings],
    }), emptyConversationMergeEffects());
}

export function summarizeConversationMergeEffects(effects: ConversationMergeEffects): ConversationMergeEffectSummary {
    return {
        messageAdjacentRecordsUpdated:
            effects.messageSyncRecordsUpdated +
            effects.messageTranslationCachesUpdated +
            effects.providerOutboxJobsUpdated +
            effects.whatsappOutboundOutboxJobsUpdated +
            effects.smsRelayOutboxJobsUpdated,
        aiChildRecordsMoved:
            effects.agentExecutions.moved +
            effects.aiAutomationJobs.moved +
            effects.aiDecisions.moved +
            effects.aiSuggestedResponses.moved +
            effects.userNotifications.moved,
        aiChildRecordsDetached:
            effects.agentExecutions.detached +
            effects.aiAutomationJobs.detached +
            effects.aiDecisions.detached +
            effects.aiSuggestedResponses.detached +
            effects.userNotifications.detached,
    };
}

async function countMovableChildRecords(client: ConversationMergeClient, sourceConversationId: string) {
    const db = client as any;
    const [
        agentExecutions,
        aiAutomationJobs,
        aiDecisions,
        aiSuggestedResponses,
        userNotifications,
    ] = await Promise.all([
        db.agentExecution.count({ where: { conversationId: sourceConversationId } }).catch(() => 0),
        db.aiAutomationJob.count({ where: { conversationId: sourceConversationId } }).catch(() => 0),
        db.aiDecision.count({ where: { conversationId: sourceConversationId } }).catch(() => 0),
        db.aiSuggestedResponse.count({ where: { conversationId: sourceConversationId } }).catch(() => 0),
        db.userNotification.count({ where: { conversationId: sourceConversationId } }).catch(() => 0),
    ]);

    return {
        agentExecutions,
        aiAutomationJobs,
        aiDecisions,
        aiSuggestedResponses,
        userNotifications,
    };
}

export async function previewConversationMergeEffects(args: {
    client: ConversationMergeClient;
    sourceConversationId: string;
    targetConversationId: string;
}): Promise<ConversationMergeEffects> {
    const db = args.client as any;
    const effects = emptyConversationMergeEffects();

    const [
        sourceParticipants,
        targetParticipants,
        sourceSyncRecords,
        targetSyncRecords,
        sourceDealLinks,
        targetDealLinks,
        movableChildCounts,
        messagesMoved,
        messageSyncRecordsUpdated,
        messageTranslationCachesUpdated,
        providerOutboxJobsUpdated,
        whatsappOutboundOutboxJobsUpdated,
        smsRelayOutboxJobsUpdated,
        tasksMoved,
        insightsMoved,
    ] = await Promise.all([
        db.conversationParticipant.findMany({
            where: { conversationId: args.sourceConversationId },
            select: { identityKey: true },
        }),
        db.conversationParticipant.findMany({
            where: { conversationId: args.targetConversationId },
            select: { identityKey: true },
        }),
        db.conversationSync.findMany({
            where: { conversationId: args.sourceConversationId },
            select: { provider: true, providerAccountId: true },
        }),
        db.conversationSync.findMany({
            where: { conversationId: args.targetConversationId },
            select: { provider: true, providerAccountId: true },
        }),
        db.dealConversationLink.findMany({
            where: { conversationId: args.sourceConversationId },
            select: { dealId: true },
        }),
        db.dealConversationLink.findMany({
            where: { conversationId: args.targetConversationId },
            select: { dealId: true },
        }),
        countMovableChildRecords(args.client, args.sourceConversationId),
        db.message.count({ where: { conversationId: args.sourceConversationId } }),
        db.messageSync.count({ where: { conversationId: args.sourceConversationId } }).catch(() => 0),
        db.messageTranslationCache.count({ where: { conversationId: args.sourceConversationId } }).catch(() => 0),
        db.providerOutbox.count({ where: { conversationId: args.sourceConversationId } }).catch(() => 0),
        db.whatsAppOutboundOutbox.count({ where: { conversationId: args.sourceConversationId } }).catch(() => 0),
        db.smsRelayOutbox.count({ where: { conversationId: args.sourceConversationId } }).catch(() => 0),
        db.contactTask.count({ where: { conversationId: args.sourceConversationId } }).catch(() => 0),
        db.insight.count({ where: { conversationId: args.sourceConversationId } }).catch(() => 0),
    ]);

    const targetParticipantKeys = new Set(targetParticipants.map((row: any) => row.identityKey));
    effects.participants.deduped = sourceParticipants.filter((row: any) => targetParticipantKeys.has(row.identityKey)).length;
    effects.participants.moved = sourceParticipants.length - effects.participants.deduped;

    const targetSyncKeys = new Set(targetSyncRecords.map((row: any) => `${row.provider}:${row.providerAccountId}`));
    effects.syncRecords.deduped = sourceSyncRecords.filter((row: any) => targetSyncKeys.has(`${row.provider}:${row.providerAccountId}`)).length;
    effects.syncRecords.moved = sourceSyncRecords.length - effects.syncRecords.deduped;

    const targetDealIds = new Set(targetDealLinks.map((row: any) => row.dealId));
    effects.dealLinks.deduped = sourceDealLinks.filter((row: any) => targetDealIds.has(row.dealId)).length;
    effects.dealLinks.moved = sourceDealLinks.length - effects.dealLinks.deduped;

    effects.messagesMoved = messagesMoved;
    effects.messageSyncRecordsUpdated = messageSyncRecordsUpdated;
    effects.messageTranslationCachesUpdated = messageTranslationCachesUpdated;
    effects.providerOutboxJobsUpdated = providerOutboxJobsUpdated;
    effects.whatsappOutboundOutboxJobsUpdated = whatsappOutboundOutboxJobsUpdated;
    effects.smsRelayOutboxJobsUpdated = smsRelayOutboxJobsUpdated;
    effects.tasksMoved = tasksMoved;
    effects.insightsMoved = insightsMoved;
    effects.agentExecutions.moved = movableChildCounts.agentExecutions;
    effects.aiAutomationJobs.moved = movableChildCounts.aiAutomationJobs;
    effects.aiDecisions.moved = movableChildCounts.aiDecisions;
    effects.aiSuggestedResponses.moved = movableChildCounts.aiSuggestedResponses;
    effects.userNotifications.moved = movableChildCounts.userNotifications;

    return effects;
}

async function moveRecordsWithOptionalSourceContact(args: {
    delegate: { updateMany: (params: any) => Promise<{ count: number }> };
    label: string;
    effects: ConversationMergeMovableEffects;
    sourceConversationId: string;
    targetConversationId: string;
    sourceContactId: string;
    targetContactId: string;
    warnings: string[];
}) {
    try {
        const contactMatched = await args.delegate.updateMany({
            where: {
                conversationId: args.sourceConversationId,
                contactId: args.sourceContactId,
            },
            data: {
                conversationId: args.targetConversationId,
                contactId: args.targetContactId,
            },
        });
        const remaining = await args.delegate.updateMany({
            where: { conversationId: args.sourceConversationId },
            data: { conversationId: args.targetConversationId },
        });
        args.effects.moved = contactMatched.count + remaining.count;
        args.effects.detached = 0;
    } catch (error) {
        args.effects.detached += args.effects.moved;
        args.effects.moved = 0;
        args.warnings.push(`${args.label} could not be moved to the target conversation and may be detached when the source conversation is deleted.`);
    }
}

async function moveAgentExecutions(args: {
    delegate: { updateMany: (params: any) => Promise<{ count: number }> };
    effects: ConversationMergeMovableEffects;
    sourceConversationId: string;
    targetConversationId: string;
    warnings: string[];
}) {
    try {
        const conversationSourceExecutions = await args.delegate.updateMany({
            where: {
                conversationId: args.sourceConversationId,
                sourceType: "conversation",
                sourceId: args.sourceConversationId,
            },
            data: {
                conversationId: args.targetConversationId,
                sourceId: args.targetConversationId,
            },
        });
        const remainingExecutions = await args.delegate.updateMany({
            where: { conversationId: args.sourceConversationId },
            data: { conversationId: args.targetConversationId },
        });
        args.effects.moved = conversationSourceExecutions.count + remainingExecutions.count;
        args.effects.detached = 0;
    } catch (error) {
        args.effects.detached += args.effects.moved;
        args.effects.moved = 0;
        args.warnings.push("AI execution records could not be moved to the target conversation and may be detached when the source conversation is deleted.");
    }
}

export async function mergeConversationIntoTarget(args: {
    tx: Prisma.TransactionClient;
    sourceConversationId: string;
    targetConversationId: string;
    sourceContactId: string;
    targetContactId: string;
}): Promise<ConversationMergeEffects> {
    const tx = args.tx as any;
    const effects = await previewConversationMergeEffects({
        client: args.tx,
        sourceConversationId: args.sourceConversationId,
        targetConversationId: args.targetConversationId,
    });

    const sourceParticipants = await tx.conversationParticipant.findMany({
        where: { conversationId: args.sourceConversationId },
        select: { id: true, identityKey: true, contactId: true },
    });
    for (const participant of sourceParticipants) {
        const targetParticipant = await tx.conversationParticipant.findUnique({
            where: {
                conversationId_identityKey: {
                    conversationId: args.targetConversationId,
                    identityKey: participant.identityKey,
                },
            },
            select: { id: true },
        });
        if (targetParticipant) {
            if (participant.contactId === args.sourceContactId) {
                await tx.conversationParticipant.update({
                    where: { id: targetParticipant.id },
                    data: { contactId: args.targetContactId },
                }).catch(() => null);
            }
            await tx.conversationParticipant.delete({ where: { id: participant.id } });
        } else {
            await tx.conversationParticipant.update({
                where: { id: participant.id },
                data: {
                    conversationId: args.targetConversationId,
                    contactId: participant.contactId === args.sourceContactId ? args.targetContactId : participant.contactId,
                },
            });
        }
    }

    const sourceSyncRecords = await tx.conversationSync.findMany({
        where: { conversationId: args.sourceConversationId },
        select: { id: true, provider: true, providerAccountId: true },
    });
    for (const sync of sourceSyncRecords) {
        const targetSync = await tx.conversationSync.findUnique({
            where: {
                conversationId_provider_providerAccountId: {
                    conversationId: args.targetConversationId,
                    provider: sync.provider,
                    providerAccountId: sync.providerAccountId,
                },
            },
            select: { id: true },
        });
        if (targetSync) {
            await tx.conversationSync.delete({ where: { id: sync.id } });
        } else {
            await tx.conversationSync.update({
                where: { id: sync.id },
                data: { conversationId: args.targetConversationId },
            });
        }
    }

    const sourceDealLinks = await tx.dealConversationLink.findMany({
        where: { conversationId: args.sourceConversationId },
        select: { id: true, dealId: true },
    });
    for (const link of sourceDealLinks) {
        const targetLink = await tx.dealConversationLink.findUnique({
            where: {
                dealId_conversationId: {
                    dealId: link.dealId,
                    conversationId: args.targetConversationId,
                },
            },
            select: { id: true },
        });
        if (targetLink) {
            await tx.dealConversationLink.delete({ where: { id: link.id } });
        } else {
            await tx.dealConversationLink.update({
                where: { id: link.id },
                data: { conversationId: args.targetConversationId },
            });
        }
    }

    await tx.message.updateMany({
        where: { conversationId: args.sourceConversationId },
        data: { conversationId: args.targetConversationId },
    });
    await tx.messageSync.updateMany({
        where: { conversationId: args.sourceConversationId },
        data: { conversationId: args.targetConversationId },
    }).catch(() => null);
    await tx.messageTranslationCache.updateMany({
        where: { conversationId: args.sourceConversationId },
        data: { conversationId: args.targetConversationId },
    }).catch(() => null);
    await tx.providerOutbox.updateMany({
        where: { conversationId: args.sourceConversationId },
        data: { conversationId: args.targetConversationId, contactId: args.targetContactId },
    }).catch(() => null);
    await tx.whatsAppOutboundOutbox.updateMany({
        where: { conversationId: args.sourceConversationId },
        data: { conversationId: args.targetConversationId, contactId: args.targetContactId },
    }).catch(() => null);
    await tx.smsRelayOutbox.updateMany({
        where: { conversationId: args.sourceConversationId },
        data: { conversationId: args.targetConversationId },
    }).catch(() => null);
    await tx.contactTask.updateMany({
        where: { conversationId: args.sourceConversationId },
        data: { conversationId: args.targetConversationId, contactId: args.targetContactId },
    }).catch(() => null);
    await tx.insight.updateMany({
        where: { conversationId: args.sourceConversationId },
        data: { conversationId: args.targetConversationId, contactId: args.targetContactId },
    }).catch(() => null);

    await moveAgentExecutions({
        delegate: tx.agentExecution,
        effects: effects.agentExecutions,
        sourceConversationId: args.sourceConversationId,
        targetConversationId: args.targetConversationId,
        warnings: effects.warnings,
    });
    await moveRecordsWithOptionalSourceContact({
        delegate: tx.aiAutomationJob,
        label: "AI automation jobs",
        effects: effects.aiAutomationJobs,
        sourceConversationId: args.sourceConversationId,
        targetConversationId: args.targetConversationId,
        sourceContactId: args.sourceContactId,
        targetContactId: args.targetContactId,
        warnings: effects.warnings,
    });
    await moveRecordsWithOptionalSourceContact({
        delegate: tx.aiDecision,
        label: "AI decision records",
        effects: effects.aiDecisions,
        sourceConversationId: args.sourceConversationId,
        targetConversationId: args.targetConversationId,
        sourceContactId: args.sourceContactId,
        targetContactId: args.targetContactId,
        warnings: effects.warnings,
    });
    await moveRecordsWithOptionalSourceContact({
        delegate: tx.aiSuggestedResponse,
        label: "AI suggested responses",
        effects: effects.aiSuggestedResponses,
        sourceConversationId: args.sourceConversationId,
        targetConversationId: args.targetConversationId,
        sourceContactId: args.sourceContactId,
        targetContactId: args.targetContactId,
        warnings: effects.warnings,
    });
    await moveRecordsWithOptionalSourceContact({
        delegate: tx.userNotification,
        label: "User notifications",
        effects: effects.userNotifications,
        sourceConversationId: args.sourceConversationId,
        targetConversationId: args.targetConversationId,
        sourceContactId: args.sourceContactId,
        targetContactId: args.targetContactId,
        warnings: effects.warnings,
    });

    await recomputeConversationSummary(args.tx, args.targetConversationId);
    return effects;
}

export async function recomputeConversationSummary(txClient: Prisma.TransactionClient, conversationId: string) {
    const tx = txClient as any;
    const latestMessage = await tx.message.findFirst({
        where: { conversationId },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        select: { body: true, type: true, createdAt: true },
    });
    const unreadCount = await tx.message.count({
        where: {
            conversationId,
            direction: "inbound",
            NOT: { status: { in: Array.from(READ_MESSAGE_STATUSES) } },
        },
    });

    await tx.conversation.update({
        where: { id: conversationId },
        data: latestMessage
            ? {
                lastMessageAt: latestMessage.createdAt,
                lastMessageBody: latestMessage.body,
                lastMessageType: latestMessage.type,
                unreadCount,
            }
            : {
                lastMessageAt: new Date(0),
                lastMessageBody: null,
                lastMessageType: null,
                unreadCount,
            },
    });
}
