import { randomUUID } from "crypto";
import { Prisma } from "@prisma/client";
import db from "@/lib/db";
import { callLLM } from "@/lib/ai/llm";
import { getModelForTask } from "@/lib/ai/model-router";
import { getLocationDefaultReplyLanguage } from "@/lib/ai/location-reply-language";
import { formatViewingDateTimeWithTimeZoneLabel } from "@/lib/viewings/datetime";
import { getShortMapLink } from "@/lib/crm/notion-scraper";
import { enqueueWhatsAppOutbound } from "@/lib/whatsapp/outbound-enqueue";

export const VIEWING_LEAD_REMINDER_DEFAULT_OFFSETS_MINUTES = [1440, 120] as const;
const VIEWING_REMINDER_SCAN_WINDOW_PAST_MS = 3 * 24 * 60 * 60 * 1000;
const VIEWING_REMINDER_SCAN_WINDOW_FUTURE_MS = 3 * 24 * 60 * 60 * 1000;

export type ViewingReminderAudience = "lead" | "owner";
export type GoogleMapsLinkSource =
    | "metadata"
    | "coordinates"
    | "viewingDirections"
    | "viewingNotes"
    | "internalNotes"
    | null;

export type ViewingLeadReminderStatus =
    | "pending"
    | "queued"
    | "suggested"
    | "skipped"
    | "failed";

export type ViewingLeadReminderEntry = {
    offsetMinutes: number;
    dueAt: string;
    status: ViewingLeadReminderStatus;
    enabledAt?: string;
    processedAt?: string;
    messageId?: string | null;
    suggestionId?: string | null;
    reason?: string | null;
    idempotencyKey?: string | null;
    lastError?: string | null;
};

export type ViewingRemindersState = {
    version: 1;
    lead?: Record<string, ViewingLeadReminderEntry>;
    owner?: {
        manualDraftedAt?: string;
    };
    leadManualDraftedAt?: string;
};

type ContactConversationRecord = {
    id: string;
    ghlConversationId: string;
    lastMessageType: string | null;
    status: string | null;
    lastMessageAt: Date | null;
    replyLanguageOverride: string | null;
};

type ContactTargetRecord = {
    id: string;
    name: string | null;
    phone: string | null;
    preferredLang: string | null;
    conversations: ContactConversationRecord[];
};

type ViewingContextRecord = Prisma.ViewingGetPayload<{
    select: {
        id: true;
        contactId: true;
        propertyId: true;
        date: true;
        scheduledLocal: true;
        scheduledTimeZone: true;
        title: true;
        description: true;
        notes: true;
        location: true;
        status: true;
        reminders: true;
        contact: {
            select: {
                id: true;
                name: true;
                phone: true;
                preferredLang: true;
                locationId: true;
                conversations: {
                    orderBy: [
                        { lastMessageAt: "desc" },
                        { updatedAt: "desc" },
                    ];
                    take: 5;
                    select: {
                        id: true;
                        ghlConversationId: true;
                        lastMessageType: true;
                        status: true;
                        lastMessageAt: true;
                        replyLanguageOverride: true;
                    };
                };
            };
        };
        property: {
            select: {
                id: true;
                locationId: true;
                reference: true;
                title: true;
                unitNumber: true;
                addressLine1: true;
                addressLine2: true;
                city: true;
                country: true;
                postalCode: true;
                propertyLocation: true;
                latitude: true;
                longitude: true;
                viewingContact: true;
                viewingDirections: true;
                viewingNotes: true;
                internalNotes: true;
                metadata: true;
                contactRoles: {
                    select: {
                        id: true;
                        role: true;
                        contact: {
                            select: {
                                id: true;
                                name: true;
                                phone: true;
                                preferredLang: true;
                            };
                        };
                    };
                };
            };
        };
        user: {
            select: {
                id: true;
                name: true;
                timeZone: true;
            };
        };
    };
}>;

export type ViewingReminderContext = {
    viewingId: string;
    locationId: string | null;
    status: string;
    scheduledAtIso: string;
    scheduledTimeZone: string;
    scheduledLabel: string;
    propertyId: string | null;
    propertyLabel: string;
    propertyReference: string | null;
    locationLabel: string | null;
    accessNotes: string | null;
    directionsUrl: string | null;
    directionsUrlSource: GoogleMapsLinkSource;
    reminders: ViewingRemindersState;
    lead: {
        contactId: string | null;
        name: string | null;
        phone: string | null;
        preferredLanguage: string | null;
        activeConversationId: string | null;
        activeConversationInternalId: string | null;
        canOpenConversation: boolean;
    };
    owner: {
        contactId: string | null;
        name: string | null;
        phone: string | null;
        preferredLanguage: string | null;
        activeConversationId: string | null;
        activeConversationInternalId: string | null;
        canOpenConversation: boolean;
        fallbackHint: string | null;
    };
};

export type GeneratedViewingReminderDraft = {
    audience: ViewingReminderAudience;
    body: string;
    viewingId: string;
    conversationId: string | null;
    contactId: string | null;
    targetName: string | null;
    canAutoSend: boolean;
    scheduledLabel: string;
    directionsUrl: string | null;
    propertyLabel: string;
    locationLabel: string | null;
    fallbackHint?: string | null;
};

export type ViewingReminderQueueResult = {
    success: boolean;
    viewingId: string;
    offsetMinutes: number;
    status: "pending" | "skipped";
    dueAt: string | null;
    reason?: string;
};

export type ViewingReminderBatchStats = {
    scanned: number;
    due: number;
    queued: number;
    suggested: number;
    skipped: number;
    failed: number;
};

type ProcessorCandidate = {
    context: ViewingReminderContext;
    reminder: ViewingLeadReminderEntry;
    reminderKey: string;
};

type ProcessorDeps = {
    listContexts: (batchSize: number, now: Date) => Promise<ViewingReminderContext[]>;
    generateDraft: (input: { viewingId: string; audience: "lead"; context?: ViewingReminderContext; markGenerated?: boolean }) => Promise<GeneratedViewingReminderDraft>;
    resolveLeadEligibility: (context: ViewingReminderContext) => Promise<{ status: "eligible" | "ineligible" | "unknown"; reason?: string }>;
    enqueueMessage: (candidate: ProcessorCandidate, draft: GeneratedViewingReminderDraft) => Promise<{ messageId: string }>;
    createSuggestedResponse: (candidate: ProcessorCandidate, draft: GeneratedViewingReminderDraft, reason: string) => Promise<{ suggestionId: string | null }>;
    persistReminderResult: (candidate: ProcessorCandidate, patch: Partial<ViewingLeadReminderEntry>) => Promise<void>;
};

function trimToNull(value: unknown): string | null {
    const trimmed = String(value || "").trim();
    return trimmed || null;
}

function toNullableJsonInput(value: Prisma.InputJsonValue | Prisma.JsonValue | Record<string, unknown> | null | undefined) {
    if (value === undefined) return undefined;
    if (value === null) return Prisma.JsonNull;
    return value as Prisma.InputJsonValue;
}

function normalizeRemindersState(value: unknown): ViewingRemindersState {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        return { version: 1 };
    }

    const source = value as Record<string, unknown>;
    const leadSource = source.lead && typeof source.lead === "object" && !Array.isArray(source.lead)
        ? source.lead as Record<string, any>
        : {};
    const lead: Record<string, ViewingLeadReminderEntry> = {};

    for (const [key, raw] of Object.entries(leadSource)) {
        if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
        const offsetMinutes = Number((raw as any).offsetMinutes ?? key);
        const dueAt = trimToNull((raw as any).dueAt);
        if (!Number.isFinite(offsetMinutes) || !dueAt) continue;
        lead[String(offsetMinutes)] = {
            offsetMinutes,
            dueAt,
            status: normalizeLeadReminderStatus((raw as any).status),
            enabledAt: trimToNull((raw as any).enabledAt) || undefined,
            processedAt: trimToNull((raw as any).processedAt) || undefined,
            messageId: trimToNull((raw as any).messageId),
            suggestionId: trimToNull((raw as any).suggestionId),
            reason: trimToNull((raw as any).reason),
            idempotencyKey: trimToNull((raw as any).idempotencyKey),
            lastError: trimToNull((raw as any).lastError),
        };
    }

    const ownerSource = source.owner && typeof source.owner === "object" && !Array.isArray(source.owner)
        ? source.owner as Record<string, unknown>
        : {};

    return {
        version: 1,
        lead,
        owner: {
            manualDraftedAt: trimToNull(ownerSource.manualDraftedAt) || undefined,
        },
        leadManualDraftedAt: trimToNull(source.leadManualDraftedAt) || undefined,
    };
}

function normalizeLeadReminderStatus(value: unknown): ViewingLeadReminderStatus {
    const normalized = String(value || "").trim().toLowerCase();
    if (normalized === "queued" || normalized === "suggested" || normalized === "skipped" || normalized === "failed") {
        return normalized;
    }
    return "pending";
}

function serializeRemindersState(state: ViewingRemindersState): Prisma.InputJsonValue {
    const leadEntries = Object.entries(state.lead || {}).reduce<Record<string, any>>((acc, [key, value]) => {
        acc[key] = {
            offsetMinutes: value.offsetMinutes,
            dueAt: value.dueAt,
            status: value.status,
            ...(value.enabledAt ? { enabledAt: value.enabledAt } : {}),
            ...(value.processedAt ? { processedAt: value.processedAt } : {}),
            ...(value.messageId ? { messageId: value.messageId } : {}),
            ...(value.suggestionId ? { suggestionId: value.suggestionId } : {}),
            ...(value.reason ? { reason: value.reason } : {}),
            ...(value.idempotencyKey ? { idempotencyKey: value.idempotencyKey } : {}),
            ...(value.lastError ? { lastError: value.lastError } : {}),
        };
        return acc;
    }, {});

    return {
        version: 1,
        ...(Object.keys(leadEntries).length > 0 ? { lead: leadEntries } : {}),
        ...(state.owner?.manualDraftedAt ? { owner: { manualDraftedAt: state.owner.manualDraftedAt } } : {}),
        ...(state.leadManualDraftedAt ? { leadManualDraftedAt: state.leadManualDraftedAt } : {}),
    } satisfies Prisma.InputJsonValue;
}

function isGoogleMapsShortLink(url: string): boolean {
    try {
        const parsed = new URL(url);
        return parsed.hostname.toLowerCase() === "maps.app.goo.gl";
    } catch {
        return false;
    }
}

function buildGoogleMapsSearchLink(latitude?: number | null, longitude?: number | null): string | null {
    if (typeof latitude !== "number" || typeof longitude !== "number") return null;
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
    return `https://www.google.com/maps/search/?api=1&query=${latitude},${longitude}`;
}

export function extractGoogleMapsLinkFromText(...texts: Array<string | null | undefined>): { url: string | null; source: GoogleMapsLinkSource } {
    const urlRegex = /https?:\/\/[^\s)]+/gi;
    const candidates: Array<{ text: string; source: GoogleMapsLinkSource }> = [
        { text: String(texts[0] || ""), source: "viewingDirections" },
        { text: String(texts[1] || ""), source: "viewingNotes" },
        { text: String(texts[2] || ""), source: "internalNotes" },
    ];

    for (const candidate of candidates) {
        const matches = candidate.text.match(urlRegex) || [];
        for (const rawUrl of matches) {
            try {
                const parsed = new URL(rawUrl);
                const host = parsed.hostname.toLowerCase();
                const pathname = parsed.pathname.toLowerCase();
                const isGoogleMaps =
                    host === "maps.app.goo.gl" ||
                    (host === "goo.gl" && pathname.startsWith("/maps")) ||
                    (host.includes("google.") && pathname.includes("/maps"));
                if (isGoogleMaps) {
                    return { url: parsed.toString(), source: candidate.source };
                }
            } catch {
                // Ignore malformed URLs in free text.
            }
        }
    }

    return { url: null, source: null };
}

export function deriveGoogleMapsLink(property: {
    latitude?: number | null;
    longitude?: number | null;
    viewingDirections?: string | null;
    viewingNotes?: string | null;
    internalNotes?: string | null;
    metadata?: unknown;
}): { url: string | null; source: GoogleMapsLinkSource } {
    const metadata = property.metadata && typeof property.metadata === "object" && !Array.isArray(property.metadata)
        ? property.metadata as Record<string, unknown>
        : null;
    const metadataCandidates = [
        metadata?.googleMapsLink,
        metadata?.google_maps_link,
        metadata?.googleMapUrl,
        metadata?.google_map_url,
        metadata?.mapLink,
        metadata?.mapsLink,
        metadata?.locationPin,
    ];
    const metadataUrl = metadataCandidates.find((value) => typeof value === "string" && /^https?:\/\//i.test(value));
    if (typeof metadataUrl === "string") {
        return { url: metadataUrl.trim(), source: "metadata" };
    }

    const fromText = extractGoogleMapsLinkFromText(
        property.viewingDirections,
        property.viewingNotes,
        property.internalNotes
    );
    if (fromText.url) return fromText;

    const fromCoordinates = buildGoogleMapsSearchLink(property.latitude, property.longitude);
    if (fromCoordinates) return { url: fromCoordinates, source: "coordinates" };

    return { url: null, source: null };
}

function buildLocationLabel(property: {
    addressLine1?: string | null;
    addressLine2?: string | null;
    city?: string | null;
    propertyLocation?: string | null;
    postalCode?: string | null;
    country?: string | null;
}): string | null {
    const parts = [
        property.addressLine1,
        property.addressLine2,
        property.city,
        property.propertyLocation,
        property.postalCode,
        property.country,
    ]
        .map((value) => String(value || "").trim())
        .filter(Boolean);
    if (parts.length === 0) return null;
    return Array.from(new Set(parts)).join(", ");
}

function buildPropertyLabel(property: {
    reference?: string | null;
    title?: string | null;
    unitNumber?: string | null;
} | null | undefined): string {
    if (!property) return "the property";
    if (property.reference && property.title) return `[${property.reference}] ${property.title}`;
    if (property.reference) return `Property ${property.reference}`;
    if (property.unitNumber && property.title) return `[${property.unitNumber}] ${property.title}`;
    if (property.title) return property.title;
    return "the property";
}

function buildAccessNotes(record: ViewingContextRecord): string | null {
    const parts = [
        trimToNull(record.location),
        trimToNull(record.description),
        trimToNull(record.notes),
        trimToNull(record.property?.viewingDirections),
        trimToNull(record.property?.viewingNotes),
    ].filter(Boolean);

    if (parts.length === 0) return null;
    return parts.join("\n");
}

function isWhatsAppConversation(record: ContactConversationRecord | null | undefined): boolean {
    const type = String(record?.lastMessageType || "").toUpperCase();
    return type.includes("WHATSAPP");
}

function pickBestConversation(conversations: ContactConversationRecord[]): ContactConversationRecord | null {
    if (!Array.isArray(conversations) || conversations.length === 0) return null;
    const openWhatsApp = conversations.find((item) => isWhatsAppConversation(item) && String(item.status || "").toLowerCase() !== "closed");
    if (openWhatsApp) return openWhatsApp;
    const anyWhatsApp = conversations.find((item) => isWhatsAppConversation(item));
    if (anyWhatsApp) return anyWhatsApp;
    const openAny = conversations.find((item) => String(item.status || "").toLowerCase() !== "closed");
    return openAny || conversations[0] || null;
}

async function checkWhatsAppPhoneEligibility(
    location: { evolutionInstanceId?: string | null },
    phone: string | null | undefined,
    options?: { contactName?: string | null; verifyServiceHealth?: boolean }
): Promise<{ status: "eligible" | "ineligible" | "unknown"; reason?: string }> {
    const contactName = options?.contactName || "This contact";
    const phoneValue = String(phone || "").trim();
    if (!phoneValue) {
        return { status: "ineligible", reason: `${contactName} does not have a phone number.` };
    }

    if (phoneValue.includes("*")) {
        return {
            status: "ineligible",
            reason: `${contactName}'s phone number is masked, so WhatsApp cannot be verified.`,
        };
    }

    const rawDigits = phoneValue.replace(/\D/g, "");
    if (rawDigits.length < 7) {
        return {
            status: "ineligible",
            reason: `${contactName}'s phone number is invalid or too short.`,
        };
    }

    if (!location?.evolutionInstanceId) {
        return {
            status: "unknown",
            reason: "WhatsApp eligibility check is unavailable (Evolution is not connected).",
        };
    }

    try {
        const { evolutionClient } = await import("@/lib/evolution/client");
        if (options?.verifyServiceHealth) {
            const health = await evolutionClient.healthCheck();
            if (!health.ok) {
                return {
                    status: "unknown",
                    reason: health.error || "WhatsApp service is unavailable.",
                };
            }
        }

        const lookup = await evolutionClient.checkWhatsAppNumber(location.evolutionInstanceId, rawDigits);
        if (lookup.exists) {
            return { status: "eligible" };
        }

        return {
            status: "ineligible",
            reason: `${contactName}'s phone number is not registered on WhatsApp.`,
        };
    } catch (error) {
        console.warn("[ViewingReminder] WhatsApp lookup failed:", error);
        return {
            status: "unknown",
            reason: "Could not verify WhatsApp registration right now.",
        };
    }
}

async function ensurePropertyDirectionsUrl(property: ViewingContextRecord["property"]): Promise<{ url: string | null; source: GoogleMapsLinkSource }> {
    if (!property?.id) {
        return { url: null, source: null };
    }

    const derived = deriveGoogleMapsLink({
        latitude: property.latitude,
        longitude: property.longitude,
        viewingDirections: property.viewingDirections,
        viewingNotes: property.viewingNotes,
        internalNotes: property.internalNotes,
        metadata: property.metadata,
    });

    if (!derived.url || isGoogleMapsShortLink(derived.url)) {
        return derived;
    }

    try {
        const shortUrl = await getShortMapLink(derived.url);
        if (!shortUrl) return derived;

        const metadata = property.metadata && typeof property.metadata === "object" && !Array.isArray(property.metadata)
            ? property.metadata as Record<string, unknown>
            : {};
        await db.property.update({
            where: { id: property.id },
            data: {
                metadata: toNullableJsonInput({
                    ...metadata,
                    googleMapsLink: shortUrl,
                }),
            },
        });
        return { url: shortUrl, source: "metadata" };
    } catch (error) {
        console.warn("[ViewingReminder] Failed to cache Google Maps short URL:", error);
        return derived;
    }
}

export function buildBaseReminderDraft(context: ViewingReminderContext, audience: ViewingReminderAudience): string {
    const lines: string[] = [];
    const propertyLabel = context.propertyLabel;
    const scheduledLabel = context.scheduledLabel;

    if (audience === "lead") {
        lines.push(`Just a reminder about your viewing for ${propertyLabel} on ${scheduledLabel}.`);
        if (context.locationLabel) {
            lines.push(`Location: ${context.locationLabel}.`);
        }
        lines.push("If anything changes or you need to adjust the time, please let me know.");
        if (context.directionsUrl) {
            lines.push("Directions:");
            lines.push(context.directionsUrl);
        }
    } else {
        lines.push(`Just confirming the viewing for ${propertyLabel} on ${scheduledLabel}.`);
        if (context.locationLabel) {
            lines.push(`Property location: ${context.locationLabel}.`);
        }
        lines.push("Please let me know if the access details or timing have changed.");
        if (context.directionsUrl) {
            lines.push("Directions link for the viewing:");
            lines.push(context.directionsUrl);
        }
    }

    return lines.join("\n");
}

async function maybePolishReminderDraft(
    draft: string,
    context: ViewingReminderContext,
    audience: ViewingReminderAudience
): Promise<string> {
    const targetLanguage = audience === "lead"
        ? (context.lead.preferredLanguage || null)
        : (context.owner.preferredLanguage || null);
    const locationId = context.locationId;
    let fallbackLanguage = "English";

    if (locationId) {
        try {
            fallbackLanguage = await getLocationDefaultReplyLanguage(locationId) || fallbackLanguage;
        } catch {
            // Keep fallback English if location language lookup fails.
        }
    }

    try {
        const modelId = getModelForTask("draft_reply");
        const languageInstruction = targetLanguage || fallbackLanguage;
        const polished = await callLLM(
            modelId,
            [
                "You rewrite operational real-estate reminder messages.",
                "Keep every factual detail unchanged.",
                "Keep the tone concise, direct, and professional.",
                "Use absolute dates and times already provided.",
                "Keep URLs on their own line with no trailing punctuation.",
                "Do not use markdown, bullets, or headings.",
                `Write the final message for the ${audience}.`,
                `Write it in ${languageInstruction}.`,
            ].join("\n"),
            draft,
            {
                temperature: 0.2,
                maxOutputTokens: 260,
                thinkingBudget: 0,
            }
        );
        const normalized = String(polished || "").trim();
        return normalized || draft;
    } catch (error) {
        console.warn("[ViewingReminder] AI polish failed, using template draft:", error);
        return draft;
    }
}

async function markManualDraftGenerated(viewingId: string, audience: ViewingReminderAudience) {
    const viewing = await db.viewing.findUnique({
        where: { id: viewingId },
        select: { reminders: true },
    });
    if (!viewing) return;

    const next = normalizeRemindersState(viewing.reminders);
    const nowIso = new Date().toISOString();
    if (audience === "lead") {
        next.leadManualDraftedAt = nowIso;
    } else {
        next.owner = {
            ...next.owner,
            manualDraftedAt: nowIso,
        };
    }

    await db.viewing.update({
        where: { id: viewingId },
        data: { reminders: serializeRemindersState(next) },
    });
}

export async function getViewingReminderContext(viewingId: string): Promise<ViewingReminderContext | null> {
    const record = await db.viewing.findUnique({
        where: { id: viewingId },
        select: {
            id: true,
            contactId: true,
            propertyId: true,
            date: true,
            scheduledLocal: true,
            scheduledTimeZone: true,
            title: true,
            description: true,
            notes: true,
            location: true,
            status: true,
            reminders: true,
            contact: {
                select: {
                    id: true,
                    name: true,
                    phone: true,
                    preferredLang: true,
                    locationId: true,
                    conversations: {
                        orderBy: [{ lastMessageAt: "desc" }, { updatedAt: "desc" }],
                        take: 5,
                        select: {
                            id: true,
                            ghlConversationId: true,
                            lastMessageType: true,
                            status: true,
                            lastMessageAt: true,
                            replyLanguageOverride: true,
                        },
                    },
                },
            },
            property: {
                select: {
                    id: true,
                    locationId: true,
                    reference: true,
                    title: true,
                    unitNumber: true,
                    addressLine1: true,
                    addressLine2: true,
                    city: true,
                    country: true,
                    postalCode: true,
                    propertyLocation: true,
                    latitude: true,
                    longitude: true,
                    viewingContact: true,
                    viewingDirections: true,
                    viewingNotes: true,
                    internalNotes: true,
                    metadata: true,
                    contactRoles: {
                        select: {
                            id: true,
                            role: true,
                            contact: {
                                select: {
                                    id: true,
                                    name: true,
                                    phone: true,
                                    preferredLang: true,
                                },
                            },
                        },
                    },
                },
            },
            user: {
                select: {
                    id: true,
                    name: true,
                    timeZone: true,
                },
            },
        },
    });

    if (!record) return null;

    const leadConversation = pickBestConversation((record.contact?.conversations || []).map((item) => ({
        id: item.id,
        ghlConversationId: item.ghlConversationId,
        lastMessageType: item.lastMessageType,
        status: item.status,
        lastMessageAt: item.lastMessageAt,
        replyLanguageOverride: item.replyLanguageOverride,
    })));

    const viewingLocationId = trimToNull(record.contact?.locationId) || trimToNull(record.property?.locationId);
    const ownerRole = (record.property?.contactRoles || []).find((role) => String(role.role || "").trim().toLowerCase() === "owner");
    let ownerConversation: ContactConversationRecord | null = null;
    if (ownerRole?.contact?.id) {
        const ownerConversations = await db.conversation.findMany({
            where: {
                contactId: ownerRole.contact.id,
                ...(viewingLocationId ? { locationId: viewingLocationId } : {}),
            },
            orderBy: [{ lastMessageAt: "desc" }, { updatedAt: "desc" }],
            take: 5,
            select: {
                id: true,
                ghlConversationId: true,
                lastMessageType: true,
                status: true,
                lastMessageAt: true,
                replyLanguageOverride: true,
            },
        });
        ownerConversation = pickBestConversation(ownerConversations);
    }

    const scheduledTimeZone = trimToNull(record.scheduledTimeZone)
        || trimToNull(record.user?.timeZone)
        || "UTC";
    const scheduledLabel = formatViewingDateTimeWithTimeZoneLabel(record.date, scheduledTimeZone);
    const locationLabel = buildLocationLabel(record.property || {});
    const directions = await ensurePropertyDirectionsUrl(record.property);
    const reminders = normalizeRemindersState(record.reminders);

    const ownerFallbackHint = [
        trimToNull(record.property?.viewingContact),
        trimToNull(record.property?.viewingDirections),
        trimToNull(record.property?.viewingNotes),
    ].filter(Boolean).join(" | ") || null;

    return {
        viewingId: record.id,
        locationId: viewingLocationId,
        status: String(record.status || "scheduled"),
        scheduledAtIso: record.date.toISOString(),
        scheduledTimeZone,
        scheduledLabel,
        propertyId: record.propertyId || null,
        propertyLabel: buildPropertyLabel(record.property),
        propertyReference: trimToNull(record.property?.reference),
        locationLabel,
        accessNotes: buildAccessNotes(record),
        directionsUrl: directions.url,
        directionsUrlSource: directions.source,
        reminders,
        lead: {
            contactId: record.contact?.id || null,
            name: record.contact?.name || null,
            phone: record.contact?.phone || null,
            preferredLanguage: leadConversation?.replyLanguageOverride || record.contact?.preferredLang || null,
            activeConversationId: leadConversation?.ghlConversationId || null,
            activeConversationInternalId: leadConversation?.id || null,
            canOpenConversation: Boolean(record.contact?.id),
        },
        owner: {
            contactId: ownerRole?.contact?.id || null,
            name: ownerRole?.contact?.name || null,
            phone: ownerRole?.contact?.phone || null,
            preferredLanguage: ownerConversation?.replyLanguageOverride || ownerRole?.contact?.preferredLang || null,
            activeConversationId: ownerConversation?.ghlConversationId || null,
            activeConversationInternalId: ownerConversation?.id || null,
            canOpenConversation: Boolean(ownerRole?.contact?.id),
            fallbackHint: ownerFallbackHint,
        },
    };
}

export async function generateViewingReminderDraft(input: {
    viewingId: string;
    audience: ViewingReminderAudience;
    context?: ViewingReminderContext;
    markGenerated?: boolean;
}): Promise<GeneratedViewingReminderDraft> {
    const context = input.context || await getViewingReminderContext(input.viewingId);
    if (!context) {
        throw new Error("Viewing reminder context not found.");
    }

    if (input.audience === "lead" && !context.lead.contactId) {
        throw new Error("Lead contact is missing for this viewing.");
    }

    const baseDraft = buildBaseReminderDraft(context, input.audience);
    const body = await maybePolishReminderDraft(baseDraft, context, input.audience);

    if (input.markGenerated !== false) {
        await markManualDraftGenerated(input.viewingId, input.audience);
    }

    return {
        audience: input.audience,
        body,
        viewingId: context.viewingId,
        conversationId: input.audience === "lead"
            ? context.lead.activeConversationId
            : context.owner.activeConversationId,
        contactId: input.audience === "lead"
            ? context.lead.contactId
            : context.owner.contactId,
        targetName: input.audience === "lead"
            ? context.lead.name
            : context.owner.name,
        canAutoSend: input.audience === "lead"
            ? Boolean(context.lead.activeConversationId && context.lead.activeConversationInternalId)
            : Boolean(context.owner.activeConversationId && context.owner.activeConversationInternalId),
        scheduledLabel: context.scheduledLabel,
        directionsUrl: context.directionsUrl,
        propertyLabel: context.propertyLabel,
        locationLabel: context.locationLabel,
        fallbackHint: input.audience === "owner" ? context.owner.fallbackHint : null,
    };
}

export async function queueViewingLeadReminder(viewingId: string, offsetMinutes: number): Promise<ViewingReminderQueueResult> {
    const context = await getViewingReminderContext(viewingId);
    if (!context) {
        throw new Error("Viewing not found.");
    }

    const dueAt = new Date(new Date(context.scheduledAtIso).getTime() - offsetMinutes * 60_000);
    if (!Number.isFinite(dueAt.getTime())) {
        throw new Error("Invalid viewing datetime.");
    }

    if (dueAt.getTime() <= Date.now()) {
        return {
            success: true,
            viewingId,
            offsetMinutes,
            status: "skipped",
            dueAt: dueAt.toISOString(),
            reason: "Reminder time has already passed for this viewing.",
        };
    }

    const next = normalizeRemindersState(context.reminders);
    const key = String(offsetMinutes);
    next.lead = next.lead || {};
    const existing = next.lead[key];
    if (existing) {
        const existingDueAt = new Date(existing.dueAt);
        const sameDueAt = Number.isFinite(existingDueAt.getTime()) && existingDueAt.toISOString() === dueAt.toISOString();
        if (sameDueAt) {
            if (existing.status === "pending") {
                return {
                    success: true,
                    viewingId,
                    offsetMinutes,
                    status: "pending",
                    dueAt: existing.dueAt,
                    reason: "Reminder is already queued for processing.",
                };
            }
            if (existing.status === "queued" || existing.status === "suggested") {
                return {
                    success: true,
                    viewingId,
                    offsetMinutes,
                    status: "skipped",
                    dueAt: existing.dueAt,
                    reason: "Reminder has already been processed for this viewing.",
                };
            }
        }
    }

    next.lead[key] = {
        offsetMinutes,
        dueAt: dueAt.toISOString(),
        status: "pending",
        enabledAt: new Date().toISOString(),
        idempotencyKey: `viewing_lead_reminder:${viewingId}:${offsetMinutes}:${dueAt.getTime()}`,
    };

    await db.viewing.update({
        where: { id: viewingId },
        data: {
            reminders: serializeRemindersState(next),
        },
    });

    return {
        success: true,
        viewingId,
        offsetMinutes,
        status: "pending",
        dueAt: dueAt.toISOString(),
    };
}

export async function queueDefaultViewingLeadReminders(viewingId: string) {
    const results: ViewingReminderQueueResult[] = [];
    for (const offsetMinutes of VIEWING_LEAD_REMINDER_DEFAULT_OFFSETS_MINUTES) {
        results.push(await queueViewingLeadReminder(viewingId, offsetMinutes));
    }
    return {
        success: true,
        viewingId,
        results,
    };
}

function collectDueLeadReminderCandidates(contexts: ViewingReminderContext[], now: Date): ProcessorCandidate[] {
    const dueCandidates: ProcessorCandidate[] = [];
    const nowMs = now.getTime();

    for (const context of contexts) {
        const leadEntries = Object.entries(context.reminders.lead || {});
        for (const [reminderKey, reminder] of leadEntries) {
            if (reminder.status !== "pending") continue;
            const dueAt = new Date(reminder.dueAt);
            if (!Number.isFinite(dueAt.getTime())) continue;
            if (dueAt.getTime() > nowMs) continue;
            dueCandidates.push({ context, reminder, reminderKey });
        }
    }

    return dueCandidates;
}

async function listQueuedViewingReminderContexts(batchSize: number, now: Date): Promise<ViewingReminderContext[]> {
    const rows = await db.viewing.findMany({
        where: {
            status: { in: ["scheduled", "confirmed", "lead_confirmed", "reminded"] },
            date: {
                gte: new Date(now.getTime() - VIEWING_REMINDER_SCAN_WINDOW_PAST_MS),
                lte: new Date(now.getTime() + VIEWING_REMINDER_SCAN_WINDOW_FUTURE_MS),
            },
        },
        orderBy: [{ date: "asc" }, { updatedAt: "desc" }],
        take: Math.max(batchSize, 20),
        select: { id: true },
    });

    const contexts = await Promise.all(rows.map((row) => getViewingReminderContext(row.id)));
    return contexts.filter((item): item is ViewingReminderContext => Boolean(item));
}

async function enqueueLeadReminderMessage(candidate: ProcessorCandidate, draft: GeneratedViewingReminderDraft): Promise<{ messageId: string }> {
    const { context, reminder } = candidate;
    if (!context.locationId || !context.lead.activeConversationInternalId || !context.lead.activeConversationId || !context.lead.contactId) {
        throw new Error("Lead conversation context is incomplete.");
    }

    const result = await enqueueWhatsAppOutbound({
        locationId: context.locationId,
        conversationInternalId: context.lead.activeConversationInternalId,
        conversationGhlId: context.lead.activeConversationId,
        contactId: context.lead.contactId,
        body: draft.body,
        kind: "text",
        source: "viewing_reminder",
        clientMessageId: `viewing_reminder:${context.viewingId}:lead:${reminder.offsetMinutes}:${new Date(reminder.dueAt).getTime()}`,
    });

    return { messageId: result.messageId };
}

async function resolveLeadReminderEligibility(context: ViewingReminderContext): Promise<{ status: "eligible" | "ineligible" | "unknown"; reason?: string }> {
    if (!context.locationId) {
        return { status: "unknown", reason: "Viewing location context is missing." };
    }

    const location = await db.location.findUnique({
        where: { id: context.locationId },
        select: { evolutionInstanceId: true },
    });

    return checkWhatsAppPhoneEligibility(
        { evolutionInstanceId: location?.evolutionInstanceId || null },
        context.lead.phone,
        {
            contactName: context.lead.name,
            verifyServiceHealth: true,
        }
    );
}

async function createViewingReminderSuggestedResponse(
    candidate: ProcessorCandidate,
    draft: GeneratedViewingReminderDraft,
    reason: string
): Promise<{ suggestionId: string | null }> {
    const { context, reminder } = candidate;
    if (!context.locationId) {
        return { suggestionId: null };
    }
    const suggestion = await db.aiSuggestedResponse.upsert({
        where: {
            idempotencyKey: `viewing_reminder_suggestion:${context.viewingId}:lead:${reminder.offsetMinutes}:${new Date(reminder.dueAt).getTime()}`,
        },
        create: {
            locationId: context.locationId,
            conversationId: context.lead.activeConversationInternalId || null,
            contactId: context.lead.contactId || null,
            body: draft.body,
            source: "viewing_reminder",
            status: "pending",
            metadata: toNullableJsonInput({
                type: "viewing_lead_reminder",
                viewingId: context.viewingId,
                offsetMinutes: reminder.offsetMinutes,
                dueAt: reminder.dueAt,
                reason,
            }),
            traceId: null,
            expiresAt: new Date(new Date(context.scheduledAtIso).getTime() + 24 * 60 * 60 * 1000),
            idempotencyKey: `viewing_reminder_suggestion:${context.viewingId}:lead:${reminder.offsetMinutes}:${new Date(reminder.dueAt).getTime()}`,
        },
        update: {
            body: draft.body,
            metadata: toNullableJsonInput({
                type: "viewing_lead_reminder",
                viewingId: context.viewingId,
                offsetMinutes: reminder.offsetMinutes,
                dueAt: reminder.dueAt,
                reason,
            }),
            status: "pending",
        },
        select: { id: true },
    });

    return { suggestionId: suggestion.id };
}

async function persistLeadReminderResult(candidate: ProcessorCandidate, patch: Partial<ViewingLeadReminderEntry>) {
    const viewing = await db.viewing.findUnique({
        where: { id: candidate.context.viewingId },
        select: { reminders: true },
    });
    if (!viewing) return;

    const next = normalizeRemindersState(viewing.reminders);
    next.lead = next.lead || {};
    const existing = next.lead[candidate.reminderKey] || candidate.reminder;
    next.lead[candidate.reminderKey] = {
        ...existing,
        ...patch,
    };

    await db.viewing.update({
        where: { id: candidate.context.viewingId },
        data: {
            reminders: serializeRemindersState(next),
        },
    });
}

export async function processViewingReminderBatch(
    options?: { batchSize?: number; now?: Date },
    deps?: Partial<ProcessorDeps>
): Promise<ViewingReminderBatchStats> {
    const batchSize = Math.max(1, Math.min(Number(options?.batchSize || 50), 200));
    const now = options?.now instanceof Date ? options.now : new Date();

    const resolvedDeps: ProcessorDeps = {
        listContexts: deps?.listContexts || listQueuedViewingReminderContexts,
        generateDraft: deps?.generateDraft || ((input) => generateViewingReminderDraft(input)),
        resolveLeadEligibility: deps?.resolveLeadEligibility || resolveLeadReminderEligibility,
        enqueueMessage: deps?.enqueueMessage || enqueueLeadReminderMessage,
        createSuggestedResponse: deps?.createSuggestedResponse || createViewingReminderSuggestedResponse,
        persistReminderResult: deps?.persistReminderResult || persistLeadReminderResult,
    };

    const contexts = await resolvedDeps.listContexts(batchSize, now);
    const candidates = collectDueLeadReminderCandidates(contexts, now).slice(0, batchSize);

    const stats: ViewingReminderBatchStats = {
        scanned: contexts.length,
        due: candidates.length,
        queued: 0,
        suggested: 0,
        skipped: 0,
        failed: 0,
    };

    for (const candidate of candidates) {
        try {
            if (!candidate.context.lead.contactId) {
                await resolvedDeps.persistReminderResult(candidate, {
                    status: "skipped",
                    processedAt: now.toISOString(),
                    reason: "Lead contact is missing for this viewing.",
                });
                stats.skipped += 1;
                continue;
            }

            const draft = await resolvedDeps.generateDraft({
                viewingId: candidate.context.viewingId,
                audience: "lead",
                context: candidate.context,
                markGenerated: false,
            });

            const eligibility = await resolvedDeps.resolveLeadEligibility(candidate.context);

            if (
                candidate.context.lead.activeConversationInternalId
                && candidate.context.lead.activeConversationId
                && eligibility.status === "eligible"
            ) {
                const sent = await resolvedDeps.enqueueMessage(candidate, draft);
                await resolvedDeps.persistReminderResult(candidate, {
                    status: "queued",
                    processedAt: now.toISOString(),
                    messageId: sent.messageId,
                    reason: null,
                    lastError: null,
                });
                stats.queued += 1;
                continue;
            }

            const fallbackReason = eligibility.reason
                || (!candidate.context.lead.activeConversationId ? "No active conversation found." : "WhatsApp eligibility is unavailable.");
            const suggestion = await resolvedDeps.createSuggestedResponse(candidate, draft, fallbackReason);
            await resolvedDeps.persistReminderResult(candidate, {
                status: "suggested",
                processedAt: now.toISOString(),
                suggestionId: suggestion.suggestionId,
                reason: fallbackReason,
                lastError: null,
            });
            stats.suggested += 1;
        } catch (error) {
            await resolvedDeps.persistReminderResult(candidate, {
                status: "failed",
                processedAt: now.toISOString(),
                lastError: error instanceof Error ? error.message : String(error),
            });
            stats.failed += 1;
        }
    }

    return stats;
}
