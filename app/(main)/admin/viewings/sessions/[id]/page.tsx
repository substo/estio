import { auth } from "@clerk/nextjs/server";
import { notFound } from "next/navigation";
import db from "@/lib/db";
import { verifyUserHasAccessToLocation } from "@/lib/auth/permissions";
import { VIEWING_SESSION_KINDS } from "@/lib/viewings/sessions/types";
import { ViewingSessionCockpit } from "./_components/viewing-session-cockpit";
import { QuickFieldAssist } from "./_components/quick-field-assist";

export const dynamic = "force-dynamic";

export default async function ViewingSessionPage(
    { params }: { params: Promise<{ id: string }> }
) {
    const { id } = await params;
    const sessionId = String(id || "").trim();
    if (!sessionId) notFound();

    const { userId: clerkUserId } = await auth();
    if (!clerkUserId) notFound();

    const session = await db.viewingSession.findUnique({
        where: { id: sessionId },
        include: {
            viewing: {
                include: {
                    property: { select: { id: true, title: true, reference: true } },
                    contact: { select: { id: true, name: true } },
                    user: { select: { id: true, name: true } },
                },
            },
            messages: {
                orderBy: [{ timestamp: "asc" }, { createdAt: "asc" }],
                take: 600,
            },
            insights: {
                where: {
                    supersededAt: null,
                },
                orderBy: [{ createdAt: "desc" }],
                take: 400,
            },
            summary: true,
            usages: {
                orderBy: [{ recordedAt: "desc" }, { createdAt: "desc" }],
                take: 120,
            },
            contact: {
                select: {
                    id: true,
                    name: true,
                    firstName: true,
                },
            },
            primaryProperty: {
                select: {
                    id: true,
                    title: true,
                    reference: true,
                },
            },
        },
    });
    if (!session) notFound();

    const hasAccess = await verifyUserHasAccessToLocation(clerkUserId, session.locationId);
    if (!hasAccess) notFound();

    const [recentContacts, recentProperties, recentViewings] = await Promise.all([
        db.contact.findMany({
            where: { locationId: session.locationId },
            select: {
                id: true,
                name: true,
                firstName: true,
                updatedAt: true,
            },
            orderBy: [{ updatedAt: "desc" }],
            take: 50,
        }),
        db.property.findMany({
            where: { locationId: session.locationId },
            select: {
                id: true,
                title: true,
                reference: true,
                updatedAt: true,
            },
            orderBy: [{ updatedAt: "desc" }],
            take: 50,
        }),
        db.viewing.findMany({
            where: {
                contact: { locationId: session.locationId },
            },
            select: {
                id: true,
                date: true,
                contact: {
                    select: {
                        id: true,
                        name: true,
                    },
                },
                property: {
                    select: {
                        id: true,
                        title: true,
                        reference: true,
                    },
                },
            },
            orderBy: [{ date: "desc" }],
            take: 50,
        }),
    ]);

    const initialSession = {
        id: session.id,
        sessionThreadId: session.sessionThreadId,
        locationId: session.locationId,
        status: session.status,
        consentStatus: session.consentStatus,
        consentAcceptedAt: session.consentAcceptedAt ? session.consentAcceptedAt.toISOString() : null,
        consentVersion: session.consentVersion || null,
        consentLocale: session.consentLocale || null,
        consentSource: session.consentSource || null,
        transportStatus: session.transportStatus,
        liveProvider: session.liveProvider || null,
        mode: session.mode,
        sessionKind: session.sessionKind,
        participantMode: session.participantMode,
        speechMode: session.speechMode || null,
        savePolicy: session.savePolicy,
        entryPoint: session.entryPoint || null,
        quickStartSource: session.quickStartSource || null,
        assignmentStatus: session.assignmentStatus,
        liveModel: session.liveModel || null,
        translationModel: session.translationModel || null,
        insightsModel: session.insightsModel || null,
        summaryModel: session.summaryModel || null,
        chainIndex: session.chainIndex,
        startedAt: session.startedAt ? session.startedAt.toISOString() : null,
        endedAt: session.endedAt ? session.endedAt.toISOString() : null,
        clientName: session.clientName || null,
        clientLanguage: session.clientLanguage || null,
        agentLanguage: session.agentLanguage || null,
        audioPlaybackClientEnabled: session.audioPlaybackClientEnabled,
        audioPlaybackAgentEnabled: session.audioPlaybackAgentEnabled,
        viewing: session.viewing ? {
            id: session.viewing.id,
            date: session.viewing.date.toISOString(),
            property: {
                id: session.viewing.property.id,
                title: session.viewing.property.title,
                reference: session.viewing.property.reference || null,
            },
            contact: {
                id: session.viewing.contact.id,
                name: session.viewing.contact.name || null,
            },
            user: {
                id: session.viewing.user.id,
                name: session.viewing.user.name || null,
            },
        } : null,
        contact: session.contact ? {
            id: session.contact.id,
            name: session.contact.name || session.contact.firstName || "Contact",
        } : null,
        primaryProperty: session.primaryProperty ? {
            id: session.primaryProperty.id,
            title: session.primaryProperty.title,
            reference: session.primaryProperty.reference || null,
        } : null,
    };
    const initialMessages = session.messages.map((message) => ({
        id: message.id,
        sessionId: message.sessionId,
        sequence: message.sequence,
        utteranceId: message.utteranceId,
        sourceMessageId: message.sourceMessageId || null,
        messageKind: message.messageKind || null,
        origin: message.origin,
        provider: message.provider || null,
        model: message.model || null,
        modelVersion: message.modelVersion || null,
        transcriptStatus: message.transcriptStatus,
        persistedAt: message.persistedAt ? message.persistedAt.toISOString() : null,
        supersedesMessageId: message.supersedesMessageId || null,
        speaker: message.speaker,
        originalText: message.originalText,
        originalLanguage: message.originalLanguage || null,
        translatedText: message.translatedText || null,
        targetLanguage: message.targetLanguage || null,
        confidence: typeof message.confidence === "number" ? message.confidence : null,
        translationStatus: message.translationStatus,
        insightStatus: message.insightStatus,
        analysisStatus: message.analysisStatus,
        timestamp: message.timestamp.toISOString(),
        createdAt: message.createdAt.toISOString(),
    }));
    const initialInsights = session.insights.map((insight) => ({
        id: insight.id,
        type: insight.type,
        category: insight.category || null,
        shortText: insight.shortText,
        longText: insight.longText || null,
        state: insight.state,
        source: insight.source,
        provider: insight.provider || null,
        model: insight.model || null,
        modelVersion: insight.modelVersion || null,
        confidence: typeof insight.confidence === "number" ? insight.confidence : null,
        generationKey: insight.generationKey || null,
        supersededAt: insight.supersededAt ? insight.supersededAt.toISOString() : null,
        metadata: insight.metadata as Record<string, unknown> | null,
        createdAt: insight.createdAt.toISOString(),
        updatedAt: insight.updatedAt.toISOString(),
    }));
    const initialUsages = session.usages.map((usage) => ({
        id: usage.id,
        phase: usage.phase,
        provider: usage.provider || null,
        model: usage.model || null,
        usageAuthority: usage.usageAuthority,
        costAuthority: usage.costAuthority,
        inputAudioSeconds: typeof usage.inputAudioSeconds === "number" ? usage.inputAudioSeconds : 0,
        outputAudioSeconds: typeof usage.outputAudioSeconds === "number" ? usage.outputAudioSeconds : 0,
        inputTokens: typeof usage.inputTokens === "number" ? usage.inputTokens : 0,
        outputTokens: typeof usage.outputTokens === "number" ? usage.outputTokens : 0,
        totalTokens: typeof usage.totalTokens === "number" ? usage.totalTokens : 0,
        toolCalls: typeof usage.toolCalls === "number" ? usage.toolCalls : 0,
        estimatedCostUsd: typeof usage.estimatedCostUsd === "number" ? usage.estimatedCostUsd : 0,
        actualCostUsd: typeof usage.actualCostUsd === "number" ? usage.actualCostUsd : 0,
        recordedAt: usage.recordedAt.toISOString(),
    }));
    const initialSummary = session.summary ? {
        id: session.summary.id,
        status: session.summary.status,
        sessionSummary: session.summary.sessionSummary || null,
        crmNote: session.summary.crmNote || null,
        followUpWhatsApp: session.summary.followUpWhatsApp || null,
        followUpEmail: session.summary.followUpEmail || null,
        recommendedNextActions: Array.isArray(session.summary.recommendedNextActions) ? session.summary.recommendedNextActions as string[] : [],
        likes: Array.isArray(session.summary.likes) ? session.summary.likes as string[] : [],
        dislikes: Array.isArray(session.summary.dislikes) ? session.summary.dislikes as string[] : [],
        objections: Array.isArray(session.summary.objections) ? session.summary.objections as string[] : [],
        buyingSignals: Array.isArray(session.summary.buyingSignals) ? session.summary.buyingSignals as string[] : [],
        generatedAt: session.summary.generatedAt ? session.summary.generatedAt.toISOString() : null,
        source: session.summary.source,
        provider: session.summary.provider || null,
        model: session.summary.model || null,
        modelVersion: session.summary.modelVersion || null,
        usedFallback: session.summary.usedFallback,
        generatedByUserId: session.summary.generatedByUserId || null,
    } : null;

    if (session.sessionKind !== VIEWING_SESSION_KINDS.structuredViewing) {
        return (
            <QuickFieldAssist
                initialSession={initialSession}
                initialMessages={initialMessages}
                initialSummary={initialSummary}
                quickContextOptions={{
                    contacts: recentContacts.map((contact) => ({
                        id: contact.id,
                        label: contact.name || contact.firstName || "Contact",
                    })),
                    properties: recentProperties.map((property) => ({
                        id: property.id,
                        label: property.reference ? `${property.title} (${property.reference})` : property.title,
                    })),
                    viewings: recentViewings.map((viewing) => ({
                        id: viewing.id,
                        label: `${viewing.property.title} • ${viewing.contact.name || "Contact"} • ${viewing.date.toLocaleString()}`,
                    })),
                }}
            />
        );
    }

    return (
        <ViewingSessionCockpit
            initialSession={initialSession}
            initialMessages={initialMessages}
            initialInsights={initialInsights}
            initialUsages={initialUsages}
            initialSummary={initialSummary}
        />
    );
}
