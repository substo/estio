export type EvolutionRetirementAudit = {
    generatedAt: string;
    legacyRuntimeEnabled: boolean;
    locations: {
        evolutionLinked: number;
        withEvolutionInstance: number;
        examples: Array<{
            id: string;
            name: string | null;
            whatsappProviderMode: string | null;
            evolutionInstanceId: string | null;
            evolutionConnectionStatus: string | null;
        }>;
    };
    recentUsage: {
        evolutionOutboxRows: number;
        whatsappEvolutionMessages: number;
        evolutionConversationSyncRows: number;
        evolutionMessageSyncRows: number;
    };
};

export function isEvolutionLegacyRuntimeEnabled() {
    return process.env.EVOLUTION_LEGACY_RUNTIME_ENABLED === "true";
}

export async function getEvolutionRetirementAudit(db: any, locationId?: string | null): Promise<EvolutionRetirementAudit> {
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const locationScope = locationId ? { locationId } : {};
    const locationWhere = locationId
        ? { id: locationId }
        : {};
    const legacyLocationWhere = locationId
        ? {
            id: locationId,
            OR: [
                { whatsappProviderMode: "evolution_linked" },
                { evolutionInstanceId: { not: null } },
            ],
        }
        : {
            OR: [
                { whatsappProviderMode: "evolution_linked" },
                { evolutionInstanceId: { not: null } },
            ],
        };

    const [
        evolutionLinked,
        withEvolutionInstance,
        examples,
        evolutionOutboxRows,
        whatsappEvolutionMessages,
        evolutionConversationSyncRows,
        evolutionMessageSyncRows,
    ] = await Promise.all([
        db.location.count({
            where: { ...locationWhere, whatsappProviderMode: "evolution_linked" },
        }),
        db.location.count({
            where: { ...locationWhere, evolutionInstanceId: { not: null } },
        }),
        db.location.findMany({
            where: legacyLocationWhere,
            select: {
                id: true,
                name: true,
                whatsappProviderMode: true,
                evolutionInstanceId: true,
                evolutionConnectionStatus: true,
            },
            orderBy: { updatedAt: "desc" },
            take: 10,
        }),
        db.whatsAppOutboundOutbox.count({
            where: {
                ...locationScope,
                transport: "evolution",
                createdAt: { gte: since },
            },
        }),
        db.message.count({
            where: {
                source: "whatsapp_evolution",
                createdAt: { gte: since },
                conversation: locationId ? { locationId } : undefined,
            },
        }),
        db.conversationSync.count({
            where: {
                ...locationScope,
                provider: "evolution",
                updatedAt: { gte: since },
            },
        }),
        db.messageSync.count({
            where: {
                ...locationScope,
                provider: "evolution",
                updatedAt: { gte: since },
            },
        }),
    ]);

    return {
        generatedAt: new Date().toISOString(),
        legacyRuntimeEnabled: isEvolutionLegacyRuntimeEnabled(),
        locations: {
            evolutionLinked,
            withEvolutionInstance,
            examples: examples.map((location: any) => ({
                id: String(location.id),
                name: location.name ?? null,
                whatsappProviderMode: location.whatsappProviderMode ?? null,
                evolutionInstanceId: location.evolutionInstanceId ?? null,
                evolutionConnectionStatus: location.evolutionConnectionStatus ?? null,
            })),
        },
        recentUsage: {
            evolutionOutboxRows,
            whatsappEvolutionMessages,
            evolutionConversationSyncRows,
            evolutionMessageSyncRows,
        },
    };
}
