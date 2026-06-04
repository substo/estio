import db from "@/lib/db";
import { buildConversationReferenceWhere } from "@/lib/conversations/identity";
import { enqueueWhatsAppAudioTranscription, initWhatsAppAudioTranscriptionWorker } from "@/lib/queue/whatsapp-audio-transcription";
import { publishConversationRealtimeEvent } from "@/lib/realtime/conversation-events";
import { buildWhatsAppInboundAttachmentKey, putWhatsAppMediaObject } from "@/lib/whatsapp/media-r2";
import { readFile, stat } from "node:fs/promises";

export const WHATSAPP_CALL_REQUEST_BODY = "Can I call you here on WhatsApp about this?";
export const WHATSAPP_CALLING_PROVIDER = "meta_calling_api";
export const WHATSAPP_CALLING_DEFAULT_MEDIA_MODE = "sip";
const RECENT_WHATSAPP_CALL_WINDOW_MS = 24 * 60 * 60 * 1000;

export type WhatsAppCallStatus =
    | "requested"
    | "consented"
    | "call_attempted"
    | "ringing"
    | "accepted"
    | "rejected"
    | "failed"
    | "ended";

export type WhatsAppCallingOutcome = "success" | "failed" | "unsupported";
export type WhatsAppCallingProviderName = "meta_calling_api";
export type WhatsAppCallingConfigStatus = "not_configured" | "blocked" | "ready" | "unhealthy";
export type WhatsAppCallingMediaMode = "sip" | "browser_webrtc" | "manual_sdp" | "provider_managed";
export type WhatsAppCallMediaStatus = "not_connected" | "signaling_only" | "audio_connected" | "failed";

export type WhatsAppCallingProviderResult = {
    success: boolean;
    outcome: WhatsAppCallingOutcome;
    providerCallId?: string | null;
    bridgeCallId?: string | null;
    whatsappCallId?: string | null;
    status: WhatsAppCallStatus;
    providerEvent?: string | null;
    mediaStatus?: WhatsAppCallMediaStatus | string | null;
    errorCode?: string | null;
    errorMessage?: string | null;
    raw?: any;
};

export type WhatsAppCallingReadiness = {
    ready: boolean;
    outcome: WhatsAppCallingOutcome;
    provider: WhatsAppCallingProviderName;
    status: WhatsAppCallingConfigStatus;
    phoneNumberId: string | null;
    wabaId: string | null;
    displayPhoneNumber: string | null;
    coexistenceEnabled: boolean;
    hasCloudChannel: boolean;
    hasAccessToken: boolean;
    callingEnabled: boolean;
    webhooksEnabled: boolean;
    mediaMode: WhatsAppCallingMediaMode;
    sipEndpoint: string | null;
    lastReadinessCheckedAt: string | null;
    lastError: string | null;
    errorCode?: string | null;
    errorMessage?: string | null;
};

export type WhatsAppCallingProvider = {
    placeCall(input: {
        locationId: string;
        to: string;
        conversationId: string;
        contactId: string;
        attemptId: string;
    }): Promise<WhatsAppCallingProviderResult>;
};

function normalizeConsentText(value: string): string {
    return String(value || "")
        .toLowerCase()
        .replace(/[^\p{L}\p{N}\s]/gu, " ")
        .replace(/\s+/g, " ")
        .trim();
}

const POSITIVE_EXACT = new Set([
    "yes",
    "yeah",
    "yep",
    "yea",
    "sure",
    "ok",
    "okay",
    "please",
    "call me",
    "yes call",
    "yes call me",
    "you can call",
    "you can call me",
    "go ahead",
    "do it",
]);

const NEGATIVE_PATTERN = /\b(no|nope|dont|don t|do not|not now|later|stop|busy|text me)\b/i;
const POSITIVE_PATTERN = /\b(yes|yeah|yep|sure|ok|okay|call me|you can call|go ahead|please call)\b/i;

export function isPositiveWhatsAppCallConsentReply(body: string): boolean {
    const normalized = normalizeConsentText(body);
    if (!normalized) return false;
    if (NEGATIVE_PATTERN.test(normalized)) return false;
    if (POSITIVE_EXACT.has(normalized)) return true;
    if (normalized.length > 80) return false;
    return POSITIVE_PATTERN.test(normalized);
}

function normalizeMediaMode(value: unknown): WhatsAppCallingMediaMode {
    const normalized = String(value || WHATSAPP_CALLING_DEFAULT_MEDIA_MODE).trim().toLowerCase();
    if (normalized === "sip" || normalized === "browser_webrtc" || normalized === "manual_sdp" || normalized === "provider_managed") {
        return normalized;
    }
    return WHATSAPP_CALLING_DEFAULT_MEDIA_MODE;
}

function normalizeConfigStatus(value: unknown): WhatsAppCallingConfigStatus {
    const normalized = String(value || "").trim().toLowerCase();
    if (normalized === "blocked" || normalized === "ready" || normalized === "unhealthy" || normalized === "not_configured") {
        return normalized;
    }
    return "not_configured";
}

function normalizePhoneDigits(value: unknown): string {
    return String(value || "").replace(/\D/g, "");
}

function getGraphApiVersion() {
    return String(process.env.WHATSAPP_GRAPH_API_VERSION || process.env.META_GRAPH_API_VERSION || "v24.0").replace(/^\/+/, "");
}

function getLocationWhatsAppToken(location: any): string {
    return String(location?.whatsappAccessToken || process.env.WHATSAPP_ACCESS_TOKEN || "").trim();
}

function getManualSdp(config: any): string {
    const metadata = config?.metadata && typeof config.metadata === "object" ? config.metadata : {};
    return String(metadata.manualSdp || process.env.WHATSAPP_CALLING_MANUAL_SDP || "").trim();
}

function normalizeOfficialCallResult(response: any): WhatsAppCallingProviderResult {
    const event = String(response?.event || response?.status || response?.call_status || "").trim().toLowerCase();
    const call = Array.isArray(response?.calls) ? response.calls[0] : response?.call || response;
    const callId = response?.providerCallId || call?.id || response?.call_id || response?.id || null;

    if (response?.success === false || response?.error) {
        return {
            success: false,
            outcome: "failed",
            status: "failed",
            providerCallId: callId ? String(callId) : null,
            whatsappCallId: callId ? String(callId) : null,
            providerEvent: event || "call_failed",
            mediaStatus: "failed",
            errorCode: response?.errorCode || response?.error?.code
                ? String(response.errorCode || response.error.code)
                : "meta_calling_api_failed",
            errorMessage: response?.errorMessage || response?.error?.message || response?.error || "WhatsApp Business Calling API call failed.",
            raw: response,
        };
    }

    if (event === "ringing" || event === "call_ringing") {
        return {
            success: true,
            outcome: "success",
            status: "ringing",
            providerCallId: callId ? String(callId) : null,
            whatsappCallId: callId ? String(callId) : null,
            providerEvent: event,
            mediaStatus: "signaling_only",
            raw: response,
        };
    }

    if (event === "accepted" || event === "call_accepted" || event === "connect" || event === "connected") {
        return {
            success: true,
            outcome: "success",
            status: "accepted",
            providerCallId: callId ? String(callId) : null,
            whatsappCallId: callId ? String(callId) : null,
            providerEvent: event,
            mediaStatus: "audio_connected",
            raw: response,
        };
    }

    if (event === "ended" || event === "terminated" || event === "call_terminated") {
        return {
            success: true,
            outcome: "success",
            status: "ended",
            providerCallId: callId ? String(callId) : null,
            whatsappCallId: callId ? String(callId) : null,
            providerEvent: event,
            mediaStatus: "audio_connected",
            raw: response,
        };
    }

    return {
        success: true,
        outcome: "success",
        status: "call_attempted",
        providerCallId: callId ? String(callId) : null,
        whatsappCallId: callId ? String(callId) : null,
        providerEvent: event || "connect",
        mediaStatus: "signaling_only",
        raw: response,
    };
}

export function normalizeWhatsAppCallingProviderResult(response: any): WhatsAppCallingProviderResult {
    return normalizeOfficialCallResult(response);
}

export class OfficialWhatsAppCallingProvider implements WhatsAppCallingProvider {
    async placeCall(input: {
        locationId: string;
        to: string;
        conversationId: string;
        contactId: string;
        attemptId: string;
    }): Promise<WhatsAppCallingProviderResult> {
        const [location, config] = await Promise.all([
            (db as any).location.findUnique({ where: { id: input.locationId } }),
            (db as any).whatsAppCallingConfig.findUnique({ where: { locationId: input.locationId } }).catch(() => null),
        ]);
        const token = getLocationWhatsAppToken(location);
        const phoneNumberId = String(config?.phoneNumberId || location?.whatsappPhoneNumberId || "").trim();
        const to = normalizePhoneDigits(input.to);
        if (!token || !phoneNumberId || !to) {
            return {
                success: false,
                outcome: "failed",
                status: "failed",
                errorCode: "meta_calling_api_missing_credentials",
                errorMessage: "WhatsApp Business Calling API requires a WABA access token, phone number id, and contact phone.",
            };
        }

        const mediaMode = normalizeMediaMode(config?.mediaMode);
        const manualSdp = getManualSdp(config);
        if (mediaMode !== "manual_sdp") {
            return {
                success: false,
                outcome: "unsupported",
                status: "failed",
                errorCode: "media_session_not_implemented",
                errorMessage: `${mediaMode} calling readiness is configured, but the media session connector is not implemented yet.`,
            };
        }
        if (!manualSdp) {
            return {
                success: false,
                outcome: "failed",
                status: "failed",
                errorCode: "manual_sdp_missing",
                errorMessage: "Manual SDP diagnostic mode requires metadata.manualSdp or WHATSAPP_CALLING_MANUAL_SDP.",
            };
        }

        const url = `https://graph.facebook.com/${getGraphApiVersion()}/${encodeURIComponent(phoneNumberId)}/calls`;
        try {
            const response = await fetch(url, {
                method: "POST",
                headers: {
                    Authorization: `Bearer ${token}`,
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    messaging_product: "whatsapp",
                    to,
                    action: "connect",
                    session: {
                        sdp_type: "offer",
                        sdp: manualSdp,
                    },
                    biz_opaque_callback_data: input.attemptId,
                }),
            });
            const payload = await response.json().catch(() => null);
            if (!response.ok) {
                return normalizeOfficialCallResult({
                    success: false,
                    errorCode: payload?.error?.code || `meta_http_${response.status}`,
                    errorMessage: payload?.error?.message || response.statusText,
                    error: payload?.error || payload,
                });
            }
            return normalizeOfficialCallResult(payload);
        } catch (error: any) {
            return {
                success: false,
                outcome: "failed",
                status: "failed",
                errorCode: "meta_calling_api_unreachable",
                errorMessage: error?.message || "WhatsApp Business Calling API is unreachable.",
                raw: error,
            };
        }
    }
}

function serializeTimelineValue(value: unknown): string {
    if (value == null) return "";
    if (typeof value === "string") return value;
    try {
        return JSON.stringify(value);
    } catch {
        return String(value);
    }
}

async function logWhatsAppCallActivity(input: {
    locationId: string;
    conversationId: string;
    contactId: string;
    action: string;
    fields: Record<string, unknown>;
}) {
    const changes = Object.entries(input.fields).map(([field, value]) => ({
        field,
        old: null,
        new: serializeTimelineValue(value),
    }));
    const history = await (db as any).contactHistory.create({
        data: {
            contactId: input.contactId,
            userId: null,
            action: input.action,
            changes,
        },
        select: {
            id: true,
            createdAt: true,
        },
    });

    void publishConversationRealtimeEvent({
        locationId: input.locationId,
        conversationId: input.conversationId,
        type: "activity.created",
        payload: {
            activityEntry: {
                id: `history:${history.id}`,
                type: "activity",
                createdAt: history.createdAt.toISOString(),
                action: input.action,
                changes,
                user: null,
            },
        },
    });
}

async function findConversationContact(locationId: string, conversationId: string, contactId: string) {
    const conversation = await (db as any).conversation.findFirst({
        where: buildConversationReferenceWhere(locationId, conversationId),
        select: {
            id: true,
            locationId: true,
            contactId: true,
            contact: { select: { id: true, phone: true, name: true } },
        },
    });
    if (!conversation) throw new Error("Conversation not found.");

    const contact = await (db as any).contact.findFirst({
        where: {
            locationId,
            OR: [{ id: contactId }, { ghlContactId: contactId }],
        },
        select: { id: true, phone: true, name: true },
    });
    if (!contact) throw new Error("Contact not found.");
    if (conversation.contactId !== contact.id) throw new Error("Conversation/contact mismatch.");

    return { conversation, contact };
}

async function findDefaultWhatsAppChannel(locationId: string, phoneNumberId?: string | null) {
    return (db as any).whatsAppChannel.findFirst({
        where: {
            locationId,
            ...(phoneNumberId ? { phoneNumberId } : {}),
        },
        orderBy: [
            { isDefaultOutbound: "desc" },
            { updatedAt: "desc" },
        ],
    }).catch(() => null);
}

async function buildReadiness(locationId: string, config: any): Promise<WhatsAppCallingReadiness> {
    const location = await (db as any).location.findUnique({
        where: { id: locationId },
        select: {
            whatsappAccessToken: true,
            whatsappPhoneNumberId: true,
            whatsappBusinessAccountId: true,
        },
    }).catch(() => null);
    const configuredPhoneNumberId = String(config?.phoneNumberId || location?.whatsappPhoneNumberId || "").trim();
    const channel = await findDefaultWhatsAppChannel(locationId, configuredPhoneNumberId || null);
    const mediaMode = normalizeMediaMode(config?.mediaMode);
    const phoneNumberId = String(config?.phoneNumberId || channel?.phoneNumberId || location?.whatsappPhoneNumberId || "").trim() || null;
    const wabaId = String(config?.wabaId || channel?.wabaId || location?.whatsappBusinessAccountId || "").trim() || null;
    const hasAccessToken = Boolean(getLocationWhatsAppToken(location));
    const callingEnabled = config?.callingEnabled === true;
    const webhooksEnabled = config?.webhooksEnabled === true;
    const sipEndpoint = String(config?.sipEndpoint || "").trim() || null;
    const status = normalizeConfigStatus(config?.status);
    const common = {
        provider: WHATSAPP_CALLING_PROVIDER as const,
        status,
        phoneNumberId,
        wabaId,
        displayPhoneNumber: channel?.displayPhoneNumber || null,
        coexistenceEnabled: channel?.coexistenceEnabled === true,
        hasCloudChannel: Boolean(channel?.id),
        hasAccessToken,
        callingEnabled,
        webhooksEnabled,
        mediaMode,
        sipEndpoint,
        lastReadinessCheckedAt: config?.lastReadinessCheckedAt?.toISOString?.() || null,
        lastError: config?.lastError || null,
    };

    if (!channel?.id) {
        return {
            ready: false,
            outcome: "failed",
            ...common,
            errorCode: "waba_channel_missing",
            errorMessage: "No WABA-registered WhatsApp Cloud API number is available for this location.",
        };
    }
    if (!hasAccessToken) {
        return {
            ready: false,
            outcome: "failed",
            ...common,
            errorCode: "waba_access_token_missing",
            errorMessage: "WhatsApp Cloud API access token is missing.",
        };
    }
    if (!phoneNumberId || !wabaId) {
        return {
            ready: false,
            outcome: "failed",
            ...common,
            errorCode: "waba_phone_number_missing",
            errorMessage: "Select a WABA phone number before enabling WhatsApp calling.",
        };
    }
    if (!callingEnabled || status === "blocked") {
        return {
            ready: false,
            outcome: "failed",
            ...common,
            errorCode: "calling_not_enabled",
            errorMessage: "The selected WABA phone number is not marked calling-enabled.",
        };
    }
    if (!webhooksEnabled) {
        return {
            ready: false,
            outcome: "failed",
            ...common,
            errorCode: "calling_webhooks_missing",
            errorMessage: "Call lifecycle webhooks are not enabled for this WhatsApp app/WABA.",
        };
    }
    if (mediaMode === "sip" && !sipEndpoint) {
        return {
            ready: false,
            outcome: "failed",
            ...common,
            errorCode: "sip_endpoint_missing",
            errorMessage: "SIP media mode requires a configured SIP endpoint.",
        };
    }
    if (mediaMode === "browser_webrtc" || mediaMode === "provider_managed") {
        return {
            ready: true,
            outcome: "success",
            ...common,
        };
    }
    if (mediaMode === "manual_sdp" && !getManualSdp(config)) {
        return {
            ready: false,
            outcome: "failed",
            ...common,
            errorCode: "manual_sdp_missing",
            errorMessage: "Manual SDP diagnostic mode requires metadata.manualSdp or WHATSAPP_CALLING_MANUAL_SDP.",
        };
    }

    return {
        ready: true,
        outcome: "success",
        ...common,
    };
}

export function checkCallingReadinessFromConfig(config: any): WhatsAppCallingReadiness {
    const mediaMode = normalizeMediaMode(config?.mediaMode);
    const phoneNumberId = String(config?.phoneNumberId || "").trim() || null;
    const wabaId = String(config?.wabaId || "").trim() || null;
    const callingEnabled = config?.callingEnabled === true;
    const webhooksEnabled = config?.webhooksEnabled === true;
    const sipEndpoint = String(config?.sipEndpoint || "").trim() || null;
    const hasCloudChannel = Boolean(config?.hasCloudChannel ?? (phoneNumberId && wabaId));
    const hasAccessToken = config?.hasAccessToken !== false;
    const common = {
        provider: WHATSAPP_CALLING_PROVIDER as const,
        status: normalizeConfigStatus(config?.status),
        phoneNumberId,
        wabaId,
        displayPhoneNumber: config?.displayPhoneNumber || null,
        coexistenceEnabled: config?.coexistenceEnabled === true,
        hasCloudChannel,
        hasAccessToken,
        callingEnabled,
        webhooksEnabled,
        mediaMode,
        sipEndpoint,
        lastReadinessCheckedAt: config?.lastReadinessCheckedAt?.toISOString?.() || config?.lastReadinessCheckedAt || null,
        lastError: config?.lastError || null,
    };
    if (!hasCloudChannel || !phoneNumberId || !wabaId) {
        return { ready: false, outcome: "failed", ...common, errorCode: "waba_channel_missing", errorMessage: "No WABA-registered WhatsApp Cloud API number is available for this location." };
    }
    if (!hasAccessToken) {
        return { ready: false, outcome: "failed", ...common, errorCode: "waba_access_token_missing", errorMessage: "WhatsApp Cloud API access token is missing." };
    }
    if (!callingEnabled || common.status === "blocked") {
        return { ready: false, outcome: "failed", ...common, errorCode: "calling_not_enabled", errorMessage: "The selected WABA phone number is not marked calling-enabled." };
    }
    if (!webhooksEnabled) {
        return { ready: false, outcome: "failed", ...common, errorCode: "calling_webhooks_missing", errorMessage: "Call lifecycle webhooks are not enabled for this WhatsApp app/WABA." };
    }
    if (mediaMode === "sip" && !sipEndpoint) {
        return { ready: false, outcome: "failed", ...common, errorCode: "sip_endpoint_missing", errorMessage: "SIP media mode requires a configured SIP endpoint." };
    }
    if (mediaMode === "manual_sdp" && !getManualSdp(config)) {
        return { ready: false, outcome: "failed", ...common, errorCode: "manual_sdp_missing", errorMessage: "Manual SDP diagnostic mode requires metadata.manualSdp or WHATSAPP_CALLING_MANUAL_SDP." };
    }
    return { ready: true, outcome: "success", ...common };
}

export async function checkCallingReadiness(
    locationId: string,
    options?: { conversationId?: string | null; contactId?: string | null; refreshHealth?: boolean; logActivity?: boolean }
): Promise<WhatsAppCallingReadiness> {
    const config = await (db as any).whatsAppCallingConfig.findUnique({
        where: { locationId },
    }).catch(() => null);
    const readiness = await buildReadiness(locationId, config);

    await (db as any).whatsAppCallingConfig.upsert({
        where: { locationId },
        create: {
            locationId,
            provider: WHATSAPP_CALLING_PROVIDER,
            status: readiness.status,
            phoneNumberId: readiness.phoneNumberId,
            wabaId: readiness.wabaId,
            callingEnabled: readiness.callingEnabled,
            webhooksEnabled: readiness.webhooksEnabled,
            mediaMode: readiness.mediaMode,
            sipEndpoint: readiness.sipEndpoint,
            lastReadinessStatus: readiness.outcome,
            lastReadinessCheckedAt: new Date(),
            lastError: readiness.errorMessage || null,
        },
        update: {
            status: readiness.ready ? "ready" : readiness.status === "blocked" ? "blocked" : readiness.status,
            lastReadinessStatus: readiness.outcome,
            lastReadinessCheckedAt: new Date(),
            lastError: readiness.errorMessage || null,
        },
    }).catch(() => undefined);

    if (options?.conversationId && options?.contactId && options?.logActivity !== false) {
        await logWhatsAppCallActivity({
            locationId,
            conversationId: options.conversationId,
            contactId: options.contactId,
            action: "WHATSAPP_CALL_READINESS_CHECKED",
            fields: {
                outcome: readiness.outcome,
                ready: readiness.ready,
                provider: readiness.provider,
                phoneNumberId: readiness.phoneNumberId,
                mediaMode: readiness.mediaMode,
                errorCode: readiness.errorCode || null,
                errorMessage: readiness.errorMessage || null,
            },
        });
    }

    return readiness;
}

export async function requestWhatsAppCallConsent(input: {
    locationId: string;
    conversationId: string;
    contactId: string;
    sendWhatsAppMessage: (
        conversationId: string,
        contactId: string,
        body: string
    ) => Promise<{ success?: boolean; error?: unknown; messageId?: string | null; [key: string]: any }>;
}) {
    const { conversation, contact } = await findConversationContact(input.locationId, input.conversationId, input.contactId);
    const readiness = await checkCallingReadiness(input.locationId, {
        conversationId: conversation.id,
        contactId: contact.id,
        logActivity: false,
    });
    if (!readiness.ready) {
        return {
            success: false,
            outcome: readiness.outcome,
            errorCode: readiness.errorCode,
            error: readiness.errorMessage || "WhatsApp Business Calling API is not ready.",
            readiness,
        };
    }

    const sendResult = await input.sendWhatsAppMessage(conversation.id, contact.id, WHATSAPP_CALL_REQUEST_BODY);
    if (!sendResult?.success) {
        return {
            success: false,
            outcome: "failed",
            error: String((sendResult as any)?.error || "Failed to send WhatsApp call request."),
        };
    }

    const attempt = await (db as any).whatsAppCallAttempt.create({
        data: {
            locationId: input.locationId,
            conversationId: conversation.id,
            contactId: contact.id,
            status: "requested",
            provider: WHATSAPP_CALLING_PROVIDER,
            requestMessageId: (sendResult as any)?.messageId || null,
            requestedAt: new Date(),
            contactPhone: contact.phone || null,
            metadata: {
                requestBody: WHATSAPP_CALL_REQUEST_BODY,
                sendResult,
                consentSource: "whatsapp_web_bridge_message",
                readiness,
            },
        },
    });

    await logWhatsAppCallActivity({
        locationId: input.locationId,
        conversationId: conversation.id,
        contactId: contact.id,
        action: "WHATSAPP_CALL_REQUESTED",
        fields: {
            status: "requested",
            prompt: WHATSAPP_CALL_REQUEST_BODY,
            callAttemptId: attempt.id,
            messageId: (sendResult as any)?.messageId || null,
            provider: WHATSAPP_CALLING_PROVIDER,
        },
    });

    return { success: true, callAttemptId: attempt.id, messageId: (sendResult as any)?.messageId || null };
}

export async function detectAndHandleWhatsAppCallConsent(input: {
    locationId: string;
    conversationId: string;
    contactId: string;
    messageId: string;
    wamId?: string | null;
    body: string;
    contactPhone?: string | null;
    receivedAt?: Date | null;
    provider?: WhatsAppCallingProvider;
}) {
    if (!isPositiveWhatsAppCallConsentReply(input.body)) {
        return { success: true, detected: false };
    }

    const pending = await (db as any).whatsAppCallAttempt.findFirst({
        where: {
            locationId: input.locationId,
            conversationId: input.conversationId,
            contactId: input.contactId,
            status: { in: ["requested"] },
        },
        orderBy: { createdAt: "desc" },
    });
    if (!pending) return { success: true, detected: false, reason: "no_pending_request" };

    const consentedAt = input.receivedAt || new Date();
    const attempt = await (db as any).whatsAppCallAttempt.update({
        where: { id: pending.id },
        data: {
            status: "consented",
            provider: WHATSAPP_CALLING_PROVIDER,
            consentMessageId: input.messageId,
            consentedAt,
            contactPhone: input.contactPhone || pending.contactPhone || null,
            metadata: {
                ...(pending.metadata || {}),
                consentBody: input.body,
                consentWamId: input.wamId || null,
                consentSource: "whatsapp_web_bridge_inbound",
            },
        },
    });

    await logWhatsAppCallActivity({
        locationId: input.locationId,
        conversationId: input.conversationId,
        contactId: input.contactId,
        action: "WHATSAPP_CALL_CONSENTED",
        fields: {
            status: "consented",
            reply: input.body,
            callAttemptId: attempt.id,
            sourceMessageId: input.messageId,
            sourceWamId: input.wamId || null,
        },
    });

    const callResult = await startWhatsAppCall({
        locationId: input.locationId,
        conversationId: input.conversationId,
        contactId: input.contactId,
        callAttemptId: attempt.id,
        provider: input.provider,
    });

    return { success: true, detected: true, callAttemptId: attempt.id, callResult };
}

export async function updateWhatsAppCallFromProviderEvent(input: {
    locationId: string;
    event: any;
}) {
    const eventName = String(input.event?.event || input.event?.type || input.event?.status || "").trim();
    const attemptId = input.event?.attemptId || input.event?.biz_opaque_callback_data ? String(input.event.attemptId || input.event.biz_opaque_callback_data) : "";
    const rawProviderCallId = input.event?.providerCallId || input.event?.call_id || input.event?.id || input.event?.calls?.[0]?.id;
    const providerCallId = rawProviderCallId ? String(rawProviderCallId) : "";
    const attempt = attemptId
        ? await (db as any).whatsAppCallAttempt.findFirst({ where: { id: attemptId, locationId: input.locationId } })
        : providerCallId
            ? await (db as any).whatsAppCallAttempt.findFirst({
                where: {
                    locationId: input.locationId,
                    OR: [{ providerCallId }, { whatsappCallId: providerCallId }],
                },
            })
            : null;
    if (!attempt) return { success: false, ignored: true, reason: "attempt_not_found" };

    const result = normalizeOfficialCallResult(input.event);
    const status = result.status;
    const recordingPath = input.event?.recordingPath || input.event?.recording?.path || null;
    const recordingDurationSeconds = input.event?.recordingDurationSeconds || input.event?.recording?.durationSeconds || null;
    const updatedAttempt = await (db as any).whatsAppCallAttempt.update({
        where: { id: attempt.id },
        data: {
            status,
            provider: WHATSAPP_CALLING_PROVIDER,
            providerCallId: result.providerCallId || attempt.providerCallId || null,
            whatsappCallId: result.whatsappCallId || attempt.whatsappCallId || null,
            endedAt: status === "ended" ? new Date() : attempt.endedAt || null,
            errorCode: result.errorCode || null,
            errorMessage: result.errorMessage || null,
            metadata: {
                ...(attempt.metadata || {}),
                providerEvent: input.event || null,
                providerCallId: result.providerCallId || null,
                whatsappCallId: result.whatsappCallId || null,
                mediaStatus: result.mediaStatus || null,
                recordingPath,
                recordingDurationSeconds,
            },
        },
    });

    if (recordingPath && status === "ended") {
        await attachOfficialCallRecording({
            locationId: input.locationId,
            attempt: updatedAttempt,
            recordingPath: String(recordingPath),
            recordingDurationSeconds: recordingDurationSeconds == null ? null : Number(recordingDurationSeconds),
            event: input.event,
        }).catch((error) => {
            console.error("[WhatsApp Calling API] Failed to attach call recording:", error);
        });
    }

    if (attempt.status !== status || result.errorCode || status === "ended") {
        await logWhatsAppCallActivity({
            locationId: input.locationId,
            conversationId: attempt.conversationId,
            contactId: attempt.contactId,
            action: mapProviderEventToTimelineAction(eventName || result.providerEvent || "", status),
            fields: {
                status,
                callAttemptId: attempt.id,
                providerCallId: result.providerCallId || attempt.providerCallId || null,
                whatsappCallId: result.whatsappCallId || attempt.whatsappCallId || null,
                recordingPath,
                recordingDurationSeconds,
                errorCode: result.errorCode || null,
                errorMessage: result.errorMessage || null,
            },
        });
    }

    return { success: true, callAttemptId: attempt.id, status };
}

export const updateWhatsAppCallFromBridgeEvent = updateWhatsAppCallFromProviderEvent;

async function attachOfficialCallRecording(input: {
    locationId: string;
    attempt: any;
    recordingPath: string;
    recordingDurationSeconds: number | null;
    event: any;
}) {
    const metadata = input.attempt?.metadata && typeof input.attempt.metadata === "object" ? input.attempt.metadata : {};
    if ((metadata as any).recordingAttachmentId) return;

    const message = await (db as any).message.create({
        data: {
            conversationId: input.attempt.conversationId,
            clientMessageId: `whatsapp-official-call-recording:${input.attempt.id}`,
            type: "WhatsApp",
            direction: "inbound",
            status: "delivered",
            body: "WhatsApp call recording",
            source: "whatsapp_calling_api",
            createdAt: new Date(),
        },
    });
    const fileName = input.recordingPath.split("/").pop() || `whatsapp-call-${input.attempt.id}.wav`;
    const contentType = input.event?.recordingContentType || input.event?.recording?.contentType || "audio/wav";
    const fileStat = await stat(input.recordingPath).catch(() => null);
    const body = await readFile(input.recordingPath);
    const uploaded = await putWhatsAppMediaObject({
        key: buildWhatsAppInboundAttachmentKey({
            locationId: input.locationId,
            contactId: input.attempt.contactId,
            conversationId: input.attempt.conversationId,
            messageId: message.id,
            fileName,
            contentType,
        }),
        body,
        contentType,
        contentLength: fileStat?.size || body.length,
    });
    const attachment = await (db as any).messageAttachment.create({
        data: {
            messageId: message.id,
            fileName,
            contentType,
            size: Number(input.event?.recordingSize || input.event?.recording?.size || fileStat?.size || body.length || 0),
            url: uploaded.r2Uri,
        },
    });

    await (db as any).whatsAppCallAttempt.update({
        where: { id: input.attempt.id },
        data: {
            metadata: {
                ...metadata,
                recordingMessageId: message.id,
                recordingAttachmentId: attachment.id,
                recordingPath: input.recordingPath,
                recordingR2Uri: uploaded.r2Uri,
                recordingDurationSeconds: input.recordingDurationSeconds,
            },
        },
    });

    await initWhatsAppAudioTranscriptionWorker();
    await enqueueWhatsAppAudioTranscription({
        locationId: input.locationId,
        messageId: message.id,
        attachmentId: attachment.id,
    });
}

function mapProviderEventToTimelineAction(eventName: string, status: WhatsAppCallStatus) {
    const normalized = String(eventName || "").trim().toLowerCase();
    if (normalized === "call_media_connected") return "WHATSAPP_CALL_MEDIA_CONNECTED";
    if (normalized === "call_terminated" || normalized === "terminated" || status === "ended") return "WHATSAPP_CALL_ENDED";
    if (normalized === "call_accepted" || normalized === "accepted" || status === "accepted") return "WHATSAPP_CALL_ACCEPTED";
    if (normalized === "call_rejected" || normalized === "rejected" || status === "rejected") return "WHATSAPP_CALL_REJECTED";
    if (normalized === "call_ringing" || normalized === "ringing" || status === "ringing") return "WHATSAPP_CALL_RINGING";
    if (normalized === "call_timeout") return "WHATSAPP_CALL_TIMEOUT";
    if (normalized === "call_failed" || status === "failed") return "WHATSAPP_CALL_FAILED";
    return "WHATSAPP_CALL_PROVIDER_RESULT";
}

async function findRecentWhatsAppConversationActivity(conversationId: string) {
    const since = new Date(Date.now() - RECENT_WHATSAPP_CALL_WINDOW_MS);
    return (db as any).message.findFirst({
        where: {
            conversationId,
            type: "WhatsApp",
            createdAt: { gte: since },
        },
        orderBy: { createdAt: "desc" },
        select: {
            id: true,
            createdAt: true,
            direction: true,
            source: true,
            wamId: true,
        },
    });
}

export async function startWhatsAppCall(input: {
    locationId: string;
    conversationId: string;
    contactId: string;
    callAttemptId?: string | null;
    provider?: WhatsAppCallingProvider;
}) {
    const { conversation, contact } = await findConversationContact(input.locationId, input.conversationId, input.contactId);
    const readiness = await checkCallingReadiness(input.locationId, {
        conversationId: conversation.id,
        contactId: contact.id,
        logActivity: false,
    });
    if (!readiness.ready) {
        const failedAttempt = input.callAttemptId
            ? await (db as any).whatsAppCallAttempt.findFirst({
                where: {
                    id: input.callAttemptId,
                    locationId: input.locationId,
                    conversationId: conversation.id,
                    contactId: contact.id,
                },
            })
            : null;
        if (failedAttempt?.id) {
            await (db as any).whatsAppCallAttempt.update({
                where: { id: failedAttempt.id },
                data: {
                    status: "failed",
                    provider: WHATSAPP_CALLING_PROVIDER,
                    errorCode: readiness.errorCode || null,
                    errorMessage: readiness.errorMessage || null,
                    metadata: {
                        ...(failedAttempt.metadata || {}),
                        readiness,
                        providerResult: "official_calling_not_ready",
                    },
                },
            });
        }
        await logWhatsAppCallActivity({
            locationId: input.locationId,
            conversationId: conversation.id,
            contactId: contact.id,
            action: "WHATSAPP_CALL_FAILED",
            fields: {
                status: "failed",
                outcome: readiness.outcome,
                callAttemptId: failedAttempt?.id || input.callAttemptId || null,
                errorCode: readiness.errorCode || null,
                errorMessage: readiness.errorMessage || null,
            },
        });
        return {
            success: false,
            outcome: readiness.outcome,
            status: "failed" as const,
            errorCode: readiness.errorCode || null,
            errorMessage: readiness.errorMessage || null,
            readiness,
        };
    }

    let existing = input.callAttemptId
        ? await (db as any).whatsAppCallAttempt.findFirst({
            where: {
                id: input.callAttemptId,
                locationId: input.locationId,
                conversationId: conversation.id,
                contactId: contact.id,
            },
        })
        : await (db as any).whatsAppCallAttempt.findFirst({
            where: {
                locationId: input.locationId,
                conversationId: conversation.id,
                contactId: contact.id,
                status: "consented",
            },
            orderBy: { createdAt: "desc" },
        });

    const recentWhatsAppActivity = await findRecentWhatsAppConversationActivity(conversation.id);
    if (!existing && recentWhatsAppActivity) {
        existing = await (db as any).whatsAppCallAttempt.create({
            data: {
                locationId: input.locationId,
                conversationId: conversation.id,
                contactId: contact.id,
                status: "consented",
                provider: WHATSAPP_CALLING_PROVIDER,
                requestedAt: new Date(),
                consentedAt: recentWhatsAppActivity.createdAt,
                consentMessageId: recentWhatsAppActivity.id,
                contactPhone: contact.phone || null,
                metadata: {
                    consentSource: "recent_whatsapp_conversation_24h",
                    recentMessageId: recentWhatsAppActivity.id,
                    recentMessageDirection: recentWhatsAppActivity.direction,
                    recentMessageSource: recentWhatsAppActivity.source || null,
                    recentWamId: recentWhatsAppActivity.wamId || null,
                    readiness,
                },
            },
        });
    }

    if (!existing || (existing.status !== "consented" && !recentWhatsAppActivity)) {
        await logWhatsAppCallActivity({
            locationId: input.locationId,
            conversationId: conversation.id,
            contactId: contact.id,
            action: "WHATSAPP_CALL_FAILED",
            fields: {
                status: "failed",
                callAttemptId: existing?.id || null,
                errorCode: "recent_whatsapp_activity_required",
                errorMessage: "A recent WhatsApp conversation or explicit call consent is required before starting a WhatsApp call.",
            },
        });
        return {
            success: false,
            outcome: "failed" as const,
            status: "failed" as const,
            callAttemptId: existing?.id || null,
            errorCode: "recent_whatsapp_activity_required",
            errorMessage: "A recent WhatsApp conversation or explicit call consent is required before starting a WhatsApp call.",
            readiness,
        };
    }

    if (existing.status !== "consented" && recentWhatsAppActivity) {
        existing = await (db as any).whatsAppCallAttempt.update({
            where: { id: existing.id },
            data: {
                status: "consented",
                provider: WHATSAPP_CALLING_PROVIDER,
                consentedAt: recentWhatsAppActivity.createdAt,
                consentMessageId: recentWhatsAppActivity.id,
                metadata: {
                    ...(existing.metadata || {}),
                    consentSource: "recent_whatsapp_conversation_24h",
                    recentMessageId: recentWhatsAppActivity.id,
                    recentMessageDirection: recentWhatsAppActivity.direction,
                    recentMessageSource: recentWhatsAppActivity.source || null,
                    recentWamId: recentWhatsAppActivity.wamId || null,
                },
            },
        });
    }

    await (db as any).whatsAppCallAttempt.update({
        where: { id: existing.id },
        data: { status: "call_attempted", provider: WHATSAPP_CALLING_PROVIDER, attemptedAt: new Date() },
    });

    const provider = input.provider || new OfficialWhatsAppCallingProvider();
    const result = await provider.placeCall({
        locationId: input.locationId,
        to: contact.phone || existing.contactPhone || "",
        conversationId: conversation.id,
        contactId: contact.id,
        attemptId: existing.id,
    });

    await (db as any).whatsAppCallAttempt.update({
        where: { id: existing.id },
        data: {
            status: result.status || (result.success ? "call_attempted" : "failed"),
            provider: WHATSAPP_CALLING_PROVIDER,
            providerCallId: result.providerCallId || null,
            bridgeCallId: null,
            whatsappCallId: result.whatsappCallId || null,
            errorCode: result.errorCode || null,
            errorMessage: result.errorMessage || null,
            metadata: {
                ...(existing.metadata || {}),
                providerResult: result.raw || null,
                providerEvent: result.providerEvent || null,
                providerCallId: result.providerCallId || null,
                whatsappCallId: result.whatsappCallId || null,
                mediaStatus: result.mediaStatus || null,
                readiness,
            },
        },
    });

    await logWhatsAppCallActivity({
        locationId: input.locationId,
        conversationId: conversation.id,
        contactId: contact.id,
        action: result.success ? "WHATSAPP_CALL_PROVIDER_RESULT" : "WHATSAPP_CALL_FAILED",
        fields: {
            status: result.status,
            outcome: result.outcome,
            callAttemptId: existing.id,
            callId: result.providerCallId || null,
            event: result.providerEvent || null,
            mediaStatus: result.mediaStatus || null,
            errorCode: result.errorCode || null,
            errorMessage: result.errorMessage || null,
        },
    });

    return { success: result.success, callAttemptId: existing.id, ...result };
}
