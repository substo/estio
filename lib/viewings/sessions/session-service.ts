import db from "@/lib/db";
import { publishViewingSessionRealtimeEvent } from "@/lib/realtime/viewing-session-events";
import { appendViewingSessionEvent } from "@/lib/viewings/sessions/events";
import { resolveViewingSessionStageModelsFromSiteConfig } from "@/lib/viewings/sessions/live-models";
import { resolveViewingSessionPipelinePolicy } from "@/lib/viewings/sessions/pipeline-policy";
import {
    getDefaultViewingSessionConsentStatus,
    getDefaultViewingSessionSavePolicy,
    isQuickViewingSessionKind,
    normalizeViewingSessionAssignmentStatus,
    normalizeViewingSessionKind,
    normalizeViewingSessionParticipantMode,
    normalizeViewingSessionQuickStartSource,
    normalizeViewingSessionSavePolicy,
    normalizeViewingSessionSpeechMode,
    shouldRequireViewingSessionJoinCredentials,
} from "@/lib/viewings/sessions/session-config";
import { generateViewingSessionJoinSecrets } from "@/lib/viewings/sessions/security";
import { runViewingSessionSynthesis } from "@/lib/queue/viewing-session-synthesis";
import {
    VIEWING_SESSION_ASSIGNMENT_STATUSES,
    VIEWING_SESSION_EVENT_TYPES,
    VIEWING_SESSION_KINDS,
    VIEWING_SESSION_PARTICIPANT_MODES,
    VIEWING_SESSION_QUICK_START_SOURCES,
    VIEWING_SESSION_SAVE_POLICIES,
    VIEWING_SESSION_SPEECH_MODES,
    VIEWING_SESSION_STATUSES,
    type ViewingSessionKind,
    type ViewingSessionParticipantMode,
    type ViewingSessionQuickStartSource,
    type ViewingSessionSavePolicy,
} from "@/lib/viewings/sessions/types";
import { assembleViewingSessionContext } from "@/lib/viewings/sessions/context-assembler";
import { selectEffectiveViewingTranscriptMessages } from "@/lib/viewings/sessions/transcript";

function asString(value: unknown): string {
    return String(value || "").trim();
}

function uniqIds(values: unknown[]): string[] {
    return Array.from(new Set(values.map((value) => asString(value)).filter(Boolean)));
}

async function resolveSiteSessionDefaults(locationId: string, mode: string) {
    const siteConfig = await db.siteConfig.findUnique({
        where: { locationId },
        select: {
            domain: true,
            viewingSessionRetentionDays: true,
            viewingSessionTranscriptVisibility: true,
            viewingSessionAiDisclosureRequired: true,
            viewingSessionAiDisclosureVersion: true,
            viewingSessionTranslationModel: true,
            viewingSessionInsightsModel: true,
            viewingSessionSummaryModel: true,
        },
    });

    const stageModels = resolveViewingSessionStageModelsFromSiteConfig({
        mode: (asString(mode) || "assistant_live_tool_heavy") as any,
        translationModel: siteConfig?.viewingSessionTranslationModel,
        insightsModel: siteConfig?.viewingSessionInsightsModel,
        summaryModel: siteConfig?.viewingSessionSummaryModel,
    });

    return {
        siteConfig,
        stageModels,
        appliedRetentionDays: Math.min(365, Math.max(30, Number(siteConfig?.viewingSessionRetentionDays || 90))),
        transcriptVisibility: asString(siteConfig?.viewingSessionTranscriptVisibility) || "team",
    };
}

async function validateViewingSessionContextRefs(args: {
    locationId: string;
    contactId?: string | null;
    primaryPropertyId?: string | null;
    viewingId?: string | null;
    relatedPropertyIds?: string[];
}) {
    const locationId = asString(args.locationId);
    const contactId = asString(args.contactId) || null;
    const primaryPropertyId = asString(args.primaryPropertyId) || null;
    const viewingId = asString(args.viewingId) || null;
    const relatedPropertyIds = uniqIds(args.relatedPropertyIds || []);

    const [contact, property, viewing, relatedProperties] = await Promise.all([
        contactId
            ? db.contact.findFirst({
                where: { id: contactId, locationId },
                select: { id: true, name: true, firstName: true, preferredLang: true },
            })
            : Promise.resolve(null),
        primaryPropertyId
            ? db.property.findFirst({
                where: { id: primaryPropertyId, locationId },
                select: { id: true, title: true, reference: true },
            })
            : Promise.resolve(null),
        viewingId
            ? db.viewing.findFirst({
                where: {
                    id: viewingId,
                    contact: { locationId },
                },
                include: {
                    contact: {
                        select: { id: true, name: true, firstName: true, preferredLang: true, locationId: true },
                    },
                    property: { select: { id: true, title: true, reference: true } },
                    user: { select: { id: true, name: true } },
                },
            })
            : Promise.resolve(null),
        relatedPropertyIds.length > 0
            ? db.property.findMany({
                where: {
                    locationId,
                    id: { in: relatedPropertyIds },
                },
                select: { id: true },
            })
            : Promise.resolve([]),
    ]);

    if (contactId && !contact) throw new Error("Contact not found for this location.");
    if (primaryPropertyId && !property) throw new Error("Primary property not found for this location.");
    if (viewingId && !viewing) throw new Error("Viewing not found for this location.");
    if (relatedPropertyIds.length > 0 && relatedProperties.length !== relatedPropertyIds.length) {
        throw new Error("One or more related properties are invalid for this location.");
    }

    return {
        contact,
        property,
        viewing,
        relatedPropertyIds: relatedProperties.map((item) => item.id),
    };
}

export async function refreshViewingSessionContextSnapshot(sessionId: string) {
    const context = await assembleViewingSessionContext(sessionId);
    await db.viewingSession.update({
        where: { id: sessionId },
        data: {
            contextSnapshot: context as any,
        },
    });
    return context;
}

export async function ensureViewingSessionJoinSecrets(args: {
    sessionId: string;
    participantMode?: unknown;
    expiresInHours?: number;
}) {
    const session = await db.viewingSession.findUnique({
        where: { id: args.sessionId },
        select: {
            id: true,
            participantMode: true,
            sessionLinkTokenHash: true,
            pinCodeHash: true,
            pinCodeSalt: true,
            tokenExpiresAt: true,
        },
    });
    if (!session) throw new Error("Viewing session not found.");

    const participantMode = normalizeViewingSessionParticipantMode(args.participantMode || session.participantMode);
    if (!shouldRequireViewingSessionJoinCredentials(participantMode)) {
        return null;
    }
    if (session.sessionLinkTokenHash && session.pinCodeHash && session.pinCodeSalt && session.tokenExpiresAt) {
        return null;
    }

    const secrets = generateViewingSessionJoinSecrets({ expiresInHours: args.expiresInHours });
    await db.viewingSession.update({
        where: { id: session.id },
        data: {
            sessionLinkTokenHash: secrets.tokenHash,
            pinCodeHash: secrets.pinCodeHash,
            pinCodeSalt: secrets.pinCodeSalt,
            tokenExpiresAt: secrets.expiresAt,
        },
    });

    return secrets;
}

export async function createQuickStartViewingSession(args: {
    locationId: string;
    agentId: string;
    actorUserId?: string | null;
    mode?: string | null;
    sessionKind?: unknown;
    participantMode?: unknown;
    speechMode?: unknown;
    quickStartSource?: unknown;
    entryPoint?: string | null;
    contactId?: string | null;
    primaryPropertyId?: string | null;
    viewingId?: string | null;
    relatedPropertyIds?: string[];
    clientLanguage?: string | null;
    agentLanguage?: string | null;
    clientName?: string | null;
    notes?: string | null;
}) {
    const locationId = asString(args.locationId);
    const agentId = asString(args.agentId);
    if (!locationId || !agentId) {
        throw new Error("Missing locationId or agentId.");
    }

    const mode = asString(args.mode) || "assistant_live_tool_heavy";
    const requestedSessionKind = asString(args.sessionKind);
    const sessionKind = normalizeViewingSessionKind(
        requestedSessionKind || VIEWING_SESSION_KINDS.quickTranslate
    );
    const requestedParticipantMode = asString(args.participantMode);
    const participantMode = normalizeViewingSessionParticipantMode(
        requestedParticipantMode || VIEWING_SESSION_PARTICIPANT_MODES.agentOnly
    );
    const requestedSpeechMode = asString(args.speechMode);
    const speechMode = normalizeViewingSessionSpeechMode(
        requestedSpeechMode || (
            sessionKind === VIEWING_SESSION_KINDS.listenOnly
                ? VIEWING_SESSION_SPEECH_MODES.listenOnly
                : VIEWING_SESSION_SPEECH_MODES.pushToTalk
        )
    );
    const quickStartSource = normalizeViewingSessionQuickStartSource(args.quickStartSource);
    const entryPoint = asString(args.entryPoint) || quickStartSource;
    const defaults = await resolveSiteSessionDefaults(locationId, mode);
    const validated = await validateViewingSessionContextRefs({
        locationId,
        contactId: args.contactId || null,
        primaryPropertyId: args.primaryPropertyId || null,
        viewingId: args.viewingId || null,
        relatedPropertyIds: args.relatedPropertyIds || [],
    });

    const contextContact = validated.contact || validated.viewing?.contact || null;
    const contextProperty = validated.property || validated.viewing?.property || null;
    const consentStatus = participantMode === VIEWING_SESSION_PARTICIPANT_MODES.agentOnly
        ? "not_required"
        : (
            defaults.siteConfig?.viewingSessionAiDisclosureRequired === false
                ? "not_required"
                : getDefaultViewingSessionConsentStatus(participantMode)
        );

    const secrets = shouldRequireViewingSessionJoinCredentials(participantMode)
        ? generateViewingSessionJoinSecrets()
        : null;
    const now = new Date();
    const session = await db.viewingSession.create({
        data: {
            locationId,
            viewingId: validated.viewing?.id || null,
            contactId: contextContact?.id || null,
            primaryPropertyId: contextProperty?.id || null,
            currentActivePropertyId: contextProperty?.id || null,
            relatedPropertyIds: validated.relatedPropertyIds.filter((id) => id !== contextProperty?.id),
            agentId,
            clientName: asString(args.clientName) || asString(contextContact?.name) || asString(contextContact?.firstName) || null,
            clientLanguage: asString(args.clientLanguage) || asString(contextContact?.preferredLang) || "en",
            agentLanguage: asString(args.agentLanguage) || "en",
            sessionKind,
            participantMode,
            speechMode,
            savePolicy: getDefaultViewingSessionSavePolicy({ sessionKind, participantMode }),
            entryPoint,
            quickStartSource,
            assignmentStatus: contextContact?.id
                ? VIEWING_SESSION_ASSIGNMENT_STATUSES.assigned
                : VIEWING_SESSION_ASSIGNMENT_STATUSES.unassigned,
            assignedAt: contextContact?.id ? now : null,
            assignedByUserId: contextContact?.id ? (asString(args.actorUserId) || null) : null,
            contextAttachedAt: contextContact?.id || contextProperty?.id || validated.viewing?.id ? now : null,
            mode,
            status: VIEWING_SESSION_STATUSES.active,
            startedAt: now,
            transportStatus: "disconnected",
            liveProvider: "google_gemini_live",
            consentStatus,
            consentVersion: defaults.siteConfig?.viewingSessionAiDisclosureRequired === false
                ? null
                : (asString(defaults.siteConfig?.viewingSessionAiDisclosureVersion) || "v1"),
            appliedRetentionDays: defaults.appliedRetentionDays,
            transcriptVisibility: defaults.transcriptVisibility,
            sessionLinkTokenHash: secrets?.tokenHash || null,
            pinCodeHash: secrets?.pinCodeHash || null,
            pinCodeSalt: secrets?.pinCodeSalt || null,
            tokenExpiresAt: secrets?.expiresAt || null,
            notes: asString(args.notes) || null,
            liveModel: defaults.stageModels.live,
            translationModel: defaults.stageModels.translation,
            insightsModel: defaults.stageModels.insights,
            summaryModel: defaults.stageModels.summary,
        },
        select: {
            id: true,
            sessionThreadId: true,
            locationId: true,
            status: true,
            mode: true,
            sessionKind: true,
            participantMode: true,
            speechMode: true,
            savePolicy: true,
            transportStatus: true,
            liveProvider: true,
            translationModel: true,
            insightsModel: true,
            summaryModel: true,
            startedAt: true,
            contactId: true,
            primaryPropertyId: true,
            viewingId: true,
        },
    });

    const contextSnapshot = await refreshViewingSessionContextSnapshot(session.id);
    await publishViewingSessionRealtimeEvent({
        sessionId: session.id,
        locationId: session.locationId,
        type: VIEWING_SESSION_EVENT_TYPES.statusChanged,
        payload: {
            sessionId: session.id,
            status: session.status,
            startedAt: session.startedAt?.toISOString() || null,
            sessionKind: session.sessionKind,
            participantMode: session.participantMode,
        },
    });
    await appendViewingSessionEvent({
        sessionId: session.id,
        locationId: session.locationId,
        type: "viewing_session.quick_started",
        actorRole: "admin",
        actorUserId: asString(args.actorUserId) || null,
        source: "api",
        payload: {
            sessionKind,
            participantMode,
            speechMode,
            quickStartSource,
            savePolicy: getDefaultViewingSessionSavePolicy({ sessionKind, participantMode }),
            contextAttachedAt: contextSnapshot ? now.toISOString() : null,
        },
    });

    return {
        session,
        join: secrets ? {
            token: secrets.token,
            pinCode: secrets.pinCode,
            expiresAt: secrets.expiresAt.toISOString(),
        } : null,
        modelRouting: defaults.stageModels,
        contextSnapshot,
        pipelinePolicy: resolveViewingSessionPipelinePolicy({ sessionKind }),
    };
}

async function createViewingSessionContactHistory(args: {
    contactId: string;
    actorUserId?: string | null;
    action: string;
    session: {
        id: string;
        sessionThreadId: string;
        sessionKind: string | null;
        participantMode: string | null;
        savePolicy?: string | null;
        viewingId?: string | null;
        primaryPropertyId?: string | null;
        endedAt?: Date | null;
    };
}) {
    await db.contactHistory.create({
        data: {
            contactId: args.contactId,
            userId: asString(args.actorUserId) || null,
            action: args.action,
            changes: {
                sessionId: args.session.id,
                sessionThreadId: args.session.sessionThreadId,
                sessionKind: args.session.sessionKind,
                participantMode: args.session.participantMode,
                savePolicy: args.session.savePolicy || null,
                viewingId: args.session.viewingId || null,
                primaryPropertyId: args.session.primaryPropertyId || null,
                endedAt: args.session.endedAt ? args.session.endedAt.toISOString() : null,
            } as any,
        },
    });
}

export async function attachViewingSessionContext(args: {
    sessionId: string;
    actorUserId?: string | null;
    contactId?: string | null;
    primaryPropertyId?: string | null;
    relatedPropertyIds?: string[];
    viewingId?: string | null;
    notes?: string | null;
}) {
    const sessionId = asString(args.sessionId);
    if (!sessionId) throw new Error("Missing sessionId.");

    const session = await db.viewingSession.findUnique({
        where: { id: sessionId },
        select: {
            id: true,
            sessionThreadId: true,
            locationId: true,
            contactId: true,
            primaryPropertyId: true,
            viewingId: true,
            notes: true,
            contextVersion: true,
            sessionKind: true,
            participantMode: true,
            savePolicy: true,
            endedAt: true,
            assignmentStatus: true,
        },
    });
    if (!session) throw new Error("Viewing session not found.");

    const validated = await validateViewingSessionContextRefs({
        locationId: session.locationId,
        contactId: args.contactId ?? session.contactId,
        primaryPropertyId: args.primaryPropertyId ?? session.primaryPropertyId,
        viewingId: args.viewingId ?? session.viewingId,
        relatedPropertyIds: args.relatedPropertyIds || [],
    });

    const nextViewing = validated.viewing || null;
    const nextContactId = asString(args.contactId) || nextViewing?.contact.id || session.contactId || null;
    const nextPrimaryPropertyId = asString(args.primaryPropertyId) || nextViewing?.property.id || session.primaryPropertyId || null;
    const nextRelatedPropertyIds = uniqIds(
        (args.relatedPropertyIds && args.relatedPropertyIds.length > 0)
            ? args.relatedPropertyIds
            : []
    ).filter((id) => id !== nextPrimaryPropertyId);
    const nextAssignmentStatus = nextContactId
        ? VIEWING_SESSION_ASSIGNMENT_STATUSES.assigned
        : normalizeViewingSessionAssignmentStatus(session.assignmentStatus);
    const now = new Date();

    const updated = await db.viewingSession.update({
        where: { id: session.id },
        data: {
            contactId: nextContactId,
            primaryPropertyId: nextPrimaryPropertyId,
            currentActivePropertyId: nextPrimaryPropertyId,
            viewingId: asString(args.viewingId) || nextViewing?.id || session.viewingId || null,
            relatedPropertyIds: nextRelatedPropertyIds,
            notes: args.notes !== undefined ? (asString(args.notes) || null) : session.notes,
            contextVersion: session.contextVersion + 1,
            assignmentStatus: nextAssignmentStatus,
            assignedAt: nextContactId ? now : null,
            assignedByUserId: nextContactId ? (asString(args.actorUserId) || null) : null,
            contextAttachedAt: nextContactId || nextPrimaryPropertyId || nextViewing?.id ? now : null,
        },
        select: {
            id: true,
            sessionThreadId: true,
            locationId: true,
            contactId: true,
            primaryPropertyId: true,
            viewingId: true,
            notes: true,
            contextVersion: true,
            sessionKind: true,
            participantMode: true,
            assignmentStatus: true,
            savePolicy: true,
            endedAt: true,
        },
    });

    const contextSnapshot = await refreshViewingSessionContextSnapshot(updated.id);
    await publishViewingSessionRealtimeEvent({
        sessionId: updated.id,
        locationId: updated.locationId,
        type: VIEWING_SESSION_EVENT_TYPES.contextUpdated,
        payload: {
            sessionId: updated.id,
            contextVersion: updated.contextVersion,
            contactId: updated.contactId,
            primaryPropertyId: updated.primaryPropertyId,
            viewingId: updated.viewingId,
            assignmentStatus: updated.assignmentStatus,
            contextAttachedAt: now.toISOString(),
            contextSnapshot,
        },
    });
    await appendViewingSessionEvent({
        sessionId: updated.id,
        locationId: updated.locationId,
        type: "viewing_session.context.updated",
        actorRole: "admin",
        actorUserId: asString(args.actorUserId) || null,
        source: "api",
        payload: {
            contactId: updated.contactId,
            primaryPropertyId: updated.primaryPropertyId,
            viewingId: updated.viewingId,
            assignmentStatus: updated.assignmentStatus,
        },
    });

    const contactAttachedNow = !!updated.contactId && updated.contactId !== session.contactId;
    if (contactAttachedNow) {
        await createViewingSessionContactHistory({
            contactId: updated.contactId!,
            actorUserId: args.actorUserId || null,
            action: "VIEWING_SESSION_ATTACHED",
            session: updated,
        });

        if (updated.endedAt && normalizeViewingSessionSavePolicy(updated.savePolicy) !== VIEWING_SESSION_SAVE_POLICIES.discardOnClose) {
            await createViewingSessionContactHistory({
                contactId: updated.contactId!,
                actorUserId: args.actorUserId || null,
                action: "VIEWING_SESSION_SAVED",
                session: updated,
            });
        }
    }

    return {
        session: updated,
        contextSnapshot,
    };
}

export async function convertViewingSession(args: {
    sessionId: string;
    actorUserId?: string | null;
    sessionKind?: unknown;
    participantMode?: unknown;
    speechMode?: unknown;
}) {
    const sessionId = asString(args.sessionId);
    if (!sessionId) throw new Error("Missing sessionId.");

    const session = await db.viewingSession.findUnique({
        where: { id: sessionId },
        select: {
            id: true,
            locationId: true,
            sessionThreadId: true,
            sessionKind: true,
            participantMode: true,
            speechMode: true,
            contactId: true,
            primaryPropertyId: true,
            consentStatus: true,
            sessionLinkTokenHash: true,
            pinCodeHash: true,
            pinCodeSalt: true,
            tokenExpiresAt: true,
        },
    });
    if (!session) throw new Error("Viewing session not found.");

    const nextSessionKind = normalizeViewingSessionKind(args.sessionKind || session.sessionKind);
    const nextParticipantMode = normalizeViewingSessionParticipantMode(args.participantMode || session.participantMode);
    const nextSpeechMode = normalizeViewingSessionSpeechMode(args.speechMode || session.speechMode);

    if (
        nextSessionKind === VIEWING_SESSION_KINDS.structuredViewing &&
        (!session.contactId || !session.primaryPropertyId)
    ) {
        throw new Error("Structured viewing conversion requires both contact and primary property context.");
    }

    const updated = await db.viewingSession.update({
        where: { id: session.id },
        data: {
            sessionKind: nextSessionKind,
            participantMode: nextParticipantMode,
            speechMode: nextSpeechMode,
            convertedFromSessionKind: nextSessionKind !== session.sessionKind ? session.sessionKind : undefined,
            consentStatus: nextParticipantMode === VIEWING_SESSION_PARTICIPANT_MODES.agentOnly
                ? "not_required"
                : session.consentStatus === "accepted"
                    ? "accepted"
                    : "required",
        },
        select: {
            id: true,
            locationId: true,
            sessionThreadId: true,
            sessionKind: true,
            participantMode: true,
            speechMode: true,
            consentStatus: true,
            sessionLinkTokenHash: true,
            pinCodeHash: true,
            pinCodeSalt: true,
            tokenExpiresAt: true,
        },
    });

    const join = await ensureViewingSessionJoinSecrets({
        sessionId: updated.id,
        participantMode: updated.participantMode,
    });

    await publishViewingSessionRealtimeEvent({
        sessionId: updated.id,
        locationId: updated.locationId,
        type: VIEWING_SESSION_EVENT_TYPES.contextUpdated,
        payload: {
            sessionId: updated.id,
            sessionKind: updated.sessionKind,
            participantMode: updated.participantMode,
            speechMode: updated.speechMode,
            consentStatus: updated.consentStatus,
        },
    });
    await appendViewingSessionEvent({
        sessionId: updated.id,
        locationId: updated.locationId,
        type: "viewing_session.converted",
        actorRole: "admin",
        actorUserId: asString(args.actorUserId) || null,
        source: "api",
        payload: {
            previousSessionKind: session.sessionKind,
            nextSessionKind: updated.sessionKind,
            previousParticipantMode: session.participantMode,
            nextParticipantMode: updated.participantMode,
            speechMode: updated.speechMode,
            generatedJoinCredentials: !!join,
        },
    });

    return {
        session: updated,
        join: join ? {
            token: join.token,
            pinCode: join.pinCode,
            expiresAt: join.expiresAt.toISOString(),
        } : null,
        pipelinePolicy: resolveViewingSessionPipelinePolicy({ sessionKind: updated.sessionKind }),
    };
}

export async function closeViewingSession(args: {
    sessionId: string;
    actorUserId?: string | null;
    savePolicy?: unknown;
}) {
    const sessionId = asString(args.sessionId);
    if (!sessionId) throw new Error("Missing sessionId.");

    const savePolicy = normalizeViewingSessionSavePolicy(args.savePolicy);
    const session = await db.viewingSession.findUnique({
        where: { id: sessionId },
        select: {
            id: true,
            sessionThreadId: true,
            locationId: true,
            contactId: true,
            primaryPropertyId: true,
            viewingId: true,
            sessionKind: true,
            participantMode: true,
            status: true,
        },
    });
    if (!session) throw new Error("Viewing session not found.");

    const now = new Date();
    const updated = await db.viewingSession.update({
        where: { id: session.id },
        data: {
            status: VIEWING_SESSION_STATUSES.completed,
            endedAt: now,
            savePolicy,
            assignmentStatus: session.contactId
                ? VIEWING_SESSION_ASSIGNMENT_STATUSES.assigned
                : VIEWING_SESSION_ASSIGNMENT_STATUSES.unassigned,
        },
        select: {
            id: true,
            sessionThreadId: true,
            locationId: true,
            contactId: true,
            primaryPropertyId: true,
            viewingId: true,
            sessionKind: true,
            participantMode: true,
            savePolicy: true,
            status: true,
            endedAt: true,
        },
    });

    let summaryId: string | null = null;
    if (savePolicy !== VIEWING_SESSION_SAVE_POLICIES.discardOnClose) {
        const summary = await runViewingSessionSynthesis({
            sessionId: updated.id,
            actorUserId: asString(args.actorUserId) || null,
            status: "final",
            trigger: "completion",
        }).catch(() => null);
        summaryId = summary?.id || null;
    }

    if (savePolicy === VIEWING_SESSION_SAVE_POLICIES.discardOnClose || savePolicy === VIEWING_SESSION_SAVE_POLICIES.saveSummaryOnly) {
        await db.$transaction(async (tx) => {
            await tx.viewingSessionInsight.deleteMany({ where: { sessionId: updated.id } });
            await tx.viewingSessionMessage.deleteMany({ where: { sessionId: updated.id } });

            if (savePolicy === VIEWING_SESSION_SAVE_POLICIES.discardOnClose) {
                await tx.viewingSessionSummary.deleteMany({ where: { sessionId: updated.id } });
            }

            await tx.viewingSession.update({
                where: { id: updated.id },
                data: {
                    ...(savePolicy === VIEWING_SESSION_SAVE_POLICIES.discardOnClose ? { aiSummary: null } : {}),
                    keyPoints: [] as any,
                    objections: [] as any,
                    ...(savePolicy === VIEWING_SESSION_SAVE_POLICIES.discardOnClose ? { recommendedNextActions: [] as any } : {}),
                },
            });
        });
    }

    if (updated.contactId && savePolicy !== VIEWING_SESSION_SAVE_POLICIES.discardOnClose) {
        await createViewingSessionContactHistory({
            contactId: updated.contactId,
            actorUserId: args.actorUserId || null,
            action: "VIEWING_SESSION_SAVED",
            session: updated,
        });
    }

    await publishViewingSessionRealtimeEvent({
        sessionId: updated.id,
        locationId: updated.locationId,
        type: VIEWING_SESSION_EVENT_TYPES.statusChanged,
        payload: {
            sessionId: updated.id,
            status: updated.status,
            endedAt: updated.endedAt ? updated.endedAt.toISOString() : null,
            savePolicy,
            summaryId,
        },
    });
    await appendViewingSessionEvent({
        sessionId: updated.id,
        locationId: updated.locationId,
        type: "viewing_session.closed",
        actorRole: "admin",
        actorUserId: asString(args.actorUserId) || null,
        source: "api",
        payload: {
            savePolicy,
            endedAt: updated.endedAt ? updated.endedAt.toISOString() : null,
            summaryId,
        },
    });

    return {
        session: updated,
        summaryId,
    };
}

export async function getViewingSessionThreadPreview(args: {
    sessionThreadId: string;
    locationId: string;
}) {
    const sessionThreadId = asString(args.sessionThreadId);
    const locationId = asString(args.locationId);
    if (!sessionThreadId || !locationId) return null;

    const sessions = await db.viewingSession.findMany({
        where: {
            sessionThreadId,
            locationId,
        },
        orderBy: [{ chainIndex: "asc" }, { createdAt: "asc" }],
        include: {
            messages: {
                orderBy: [{ timestamp: "asc" }, { createdAt: "asc" }],
            },
            insights: {
                where: { supersededAt: null },
                orderBy: [{ createdAt: "desc" }],
            },
            summary: true,
            usages: {
                orderBy: [{ recordedAt: "desc" }, { createdAt: "desc" }],
            },
        },
    });
    if (sessions.length === 0) return null;

    const latest = sessions[sessions.length - 1];
    const effectiveMessages = selectEffectiveViewingTranscriptMessages(
        sessions.flatMap((session) => session.messages)
    );
    const latestSummary = [...sessions]
        .reverse()
        .map((session) => session.summary)
        .find(Boolean) || null;
    const contextSession = [...sessions]
        .reverse()
        .find((session) => session.contactId || session.primaryPropertyId || session.viewingId) || latest;
    const contextSnapshot = contextSession.contextSnapshot || await assembleViewingSessionContext(contextSession.id);

    return {
        sessionThreadId,
        rootSessionId: sessions[0].id,
        latestSessionId: latest.id,
        sessionCount: sessions.length,
        sessionKind: latest.sessionKind,
        participantMode: latest.participantMode,
        assignmentStatus: latest.assignmentStatus,
        savePolicy: latest.savePolicy,
        startedAt: sessions[0].startedAt ? sessions[0].startedAt.toISOString() : null,
        endedAt: latest.endedAt ? latest.endedAt.toISOString() : null,
        contextSnapshot,
        messages: effectiveMessages.map((message) => ({
            id: message.id,
            sessionId: message.sessionId,
            utteranceId: message.utteranceId,
            speaker: message.speaker,
            originalText: message.originalText,
            translatedText: message.translatedText,
            originalLanguage: message.originalLanguage,
            targetLanguage: message.targetLanguage,
            transcriptStatus: message.transcriptStatus,
            translationStatus: message.translationStatus,
            timestamp: message.timestamp.toISOString(),
            createdAt: message.createdAt.toISOString(),
        })),
        summary: latestSummary ? {
            id: latestSummary.id,
            status: latestSummary.status,
            sessionSummary: latestSummary.sessionSummary,
            crmNote: latestSummary.crmNote,
            followUpWhatsApp: latestSummary.followUpWhatsApp,
            followUpEmail: latestSummary.followUpEmail,
            generatedAt: latestSummary.generatedAt ? latestSummary.generatedAt.toISOString() : null,
        } : null,
        usages: sessions.flatMap((session) => session.usages).slice(0, 30).map((usage) => ({
            id: usage.id,
            phase: usage.phase,
            provider: usage.provider,
            model: usage.model,
            totalTokens: usage.totalTokens,
            estimatedCostUsd: usage.estimatedCostUsd,
            actualCostUsd: usage.actualCostUsd,
            recordedAt: usage.recordedAt.toISOString(),
        })),
    };
}

export function getQuickAssistUiModeConfig(input: {
    sessionKind?: unknown;
    participantMode?: unknown;
}) {
    const sessionKind = normalizeViewingSessionKind(input.sessionKind);
    const participantMode = normalizeViewingSessionParticipantMode(input.participantMode);
    return {
        quickUi: isQuickViewingSessionKind(sessionKind),
        sessionKind,
        participantMode,
        canShare: participantMode === VIEWING_SESSION_PARTICIPANT_MODES.agentOnly,
        pipelinePolicy: resolveViewingSessionPipelinePolicy({ sessionKind }),
    };
}
