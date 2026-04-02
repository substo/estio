import db from "@/lib/db";

export type ViewingSessionContextPayload = {
    session: {
        id: string;
        mode: string;
        status: string;
        clientLanguage: string | null;
        agentLanguage: string | null;
    };
    primaryProperty: Record<string, unknown> | null;
    relatedProperties: Array<Record<string, unknown>>;
    leadProfile: Record<string, unknown> | null;
    companyKnowledge: Record<string, unknown> | null;
};

export async function assembleViewingSessionContext(sessionId: string): Promise<ViewingSessionContextPayload | null> {
    const session = await db.viewingSession.findUnique({
        where: { id: sessionId },
        include: {
            location: {
                select: {
                    id: true,
                    name: true,
                    timeZone: true,
                    crmSchema: true,
                },
            },
            primaryProperty: {
                select: {
                    id: true,
                    title: true,
                    reference: true,
                    price: true,
                    city: true,
                    bedrooms: true,
                    bathrooms: true,
                    areaSqm: true,
                    features: true,
                    condition: true,
                    internalNotes: true,
                    viewingNotes: true,
                    description: true,
                },
            },
            contact: {
                select: {
                    id: true,
                    name: true,
                    firstName: true,
                    preferredLang: true,
                    leadSource: true,
                    leadStage: true,
                    requirementDistrict: true,
                    requirementBedrooms: true,
                    requirementMinPrice: true,
                    requirementMaxPrice: true,
                    requirementPropertyTypes: true,
                    requirementPropertyLocations: true,
                    requirementOtherDetails: true,
                    propertiesInterested: true,
                    propertiesInspected: true,
                    notes: true,
                },
            },
        },
    });
    if (!session) return null;

    const relatedPropertyIds = Array.isArray(session.relatedPropertyIds)
        ? session.relatedPropertyIds.map((id) => String(id || "").trim()).filter(Boolean)
        : [];

    const relatedProperties = relatedPropertyIds.length > 0
        ? await db.property.findMany({
            where: {
                id: { in: relatedPropertyIds },
                locationId: session.locationId,
            },
            select: {
                id: true,
                title: true,
                reference: true,
                price: true,
                city: true,
                bedrooms: true,
                bathrooms: true,
                areaSqm: true,
                features: true,
                condition: true,
                description: true,
            },
        })
        : [];

    const companyKnowledge = {
        locationName: session.location?.name || null,
        locationTimeZone: session.location?.timeZone || null,
        crmSchemaHints: session.location?.crmSchema || null,
        legalReminder: "Do not invent legal/property facts. If uncertain, state not confirmed.",
        suggestionStyle: "Keep replies concise and conversation-ready.",
    };

    return {
        session: {
            id: session.id,
            mode: session.mode,
            status: session.status,
            clientLanguage: session.clientLanguage || null,
            agentLanguage: session.agentLanguage || null,
        },
        primaryProperty: session.primaryProperty || null,
        relatedProperties: relatedProperties as Array<Record<string, unknown>>,
        leadProfile: session.contact || null,
        companyKnowledge,
    };
}
