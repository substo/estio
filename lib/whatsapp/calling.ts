import db from "@/lib/db";
import { buildConversationReferenceWhere } from "@/lib/conversations/identity";
import { enqueueWhatsAppAudioTranscription, initWhatsAppAudioTranscriptionWorker } from "@/lib/queue/whatsapp-audio-transcription";
import { publishConversationRealtimeEvent } from "@/lib/realtime/conversation-events";
import { buildWhatsAppInboundAttachmentKey, putWhatsAppMediaObject } from "@/lib/whatsapp/media-r2";
import { readFile, stat } from "node:fs/promises";

export const WHATSAPP_CALL_REQUEST_BODY = "Can I call you here on WhatsApp about this?";
export const WHATSAPP_CALLING_RUNTIME_MODE = "whatsapp_web_browser_call_rnd";
export const WHATSAPP_CALLING_BAILEYS_RUNTIME_MODE = "baileys_rnd";
const RECENT_WHATSAPP_CALL_WINDOW_MS = 24 * 60 * 60 * 1000;
const BAILEYS_OFFER_CALL_TIMEOUT_MS = 45_000;
const BROWSER_CALL_START_TIMEOUT_MS = 45_000;

export type WhatsAppCallStatus =
    | "requested"
    | "consented"
    | "call_attempted"
    | "accepted"
    | "rejected"
    | "failed"
    | "ended";

export type WhatsAppCallingOutcome = "success" | "failed" | "unsupported";
export type BaileysCallBridgeStatus = "offline" | "pairing" | "ready" | "unhealthy";
export type WhatsAppCallMediaStatus = "signaling_only" | "media_probe_started" | "audio_connected" | "failed";
export type BrowserCallBridgeStatus = "offline" | "starting" | "unpaired" | "ready" | "unhealthy";
export type BrowserCallBridgeState = "started" | "ringing" | "recording" | "ended" | "failed";

export type WhatsAppCallingProviderResult = {
    success: boolean;
    outcome: WhatsAppCallingOutcome;
    providerCallId?: string | null;
    bridgeCallId?: string | null;
    whatsappCallId?: string | null;
    status: WhatsAppCallStatus;
    bridgeEvent?: string | null;
    mediaStatus?: WhatsAppCallMediaStatus | string | null;
    errorCode?: string | null;
    errorMessage?: string | null;
    raw?: any;
};

export type WhatsAppCallingReadiness = {
    ready: boolean;
    outcome: WhatsAppCallingOutcome;
    callingRuntimeMode: string;
    baileysCallBridgeStatus: BaileysCallBridgeStatus;
    baileysSessionId: string | null;
    lastBaileysHeartbeatAt: string | null;
    mediaStatus: WhatsAppCallMediaStatus;
    bridgeBaseUrl: string;
    browserCallBridgeStatus: BrowserCallBridgeStatus;
    browserCallState: BrowserCallBridgeState | null;
    browserProfileDir: string | null;
    browserRecordingDir: string | null;
    browserRecordingPath: string | null;
    browserRecordingDurationSeconds: number | null;
    chromeReady: boolean;
    whatsappWebPaired: boolean;
    callButtonAvailable: boolean;
    audioSinkReady: boolean;
    ffmpegReady: boolean;
    errorCode?: string | null;
    errorMessage?: string | null;
};

export type BaileysCallBridgeStartResult = {
    success: boolean;
    status?: BaileysCallBridgeStatus | string | null;
    sessionId?: string | null;
    pairingCode?: string | null;
    qr?: string | null;
    authPath?: string | null;
    simulated?: boolean;
    errorCode?: string | null;
    error?: string | null;
    raw?: any;
};

export type WhatsAppCallingProvider = {
    placeCall(input: {
        locationId: string;
        to: string;
        targetJid?: string | null;
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

export function getWhatsAppCallBridgeBaseUrl(value?: string | null) {
    return String(value || process.env.WHATSAPP_BROWSER_CALL_BRIDGE_BASE_URL || process.env.WHATSAPP_CALL_BRIDGE_BASE_URL || "http://127.0.0.1:3038")
        .replace(/\/+$/, "");
}

export function getBaileysCallBridgeBaseUrl(value?: string | null) {
    return String(value || process.env.WHATSAPP_CALL_BRIDGE_BASE_URL || "http://127.0.0.1:3037")
        .replace(/\/+$/, "");
}

function normalizeBridgeStatus(value: unknown): BaileysCallBridgeStatus {
    const normalized = String(value || "").trim().toLowerCase();
    if (normalized === "pairing" || normalized === "ready" || normalized === "unhealthy" || normalized === "offline") {
        return normalized;
    }
    return "offline";
}

function normalizeBrowserBridgeStatus(value: unknown): BrowserCallBridgeStatus {
    const normalized = String(value || "").trim().toLowerCase();
    if (
        normalized === "starting"
        || normalized === "unpaired"
        || normalized === "ready"
        || normalized === "unhealthy"
        || normalized === "offline"
    ) {
        return normalized;
    }
    return "offline";
}

function normalizeBrowserCallState(value: unknown): BrowserCallBridgeState | null {
    const normalized = String(value || "").trim().toLowerCase();
    if (
        normalized === "started"
        || normalized === "ringing"
        || normalized === "recording"
        || normalized === "ended"
        || normalized === "failed"
    ) {
        return normalized;
    }
    if (normalized === "initiated" || normalized === "dialing") return "started";
    if (normalized === "call_ringing") return "ringing";
    if (normalized === "call_recording") return "recording";
    if (normalized === "complete" || normalized === "completed" || normalized === "hangup") return "ended";
    if (normalized === "error" || normalized === "call_failed") return "failed";
    return null;
}

function normalizeMediaStatus(value: unknown): WhatsAppCallMediaStatus {
    const normalized = String(value || "").trim().toLowerCase();
    if (
        normalized === "signaling_only"
        || normalized === "media_probe_started"
        || normalized === "audio_connected"
        || normalized === "failed"
    ) {
        return normalized;
    }
    return "signaling_only";
}

function normalizeRuntimeMode(value: unknown): string {
    const normalized = String(value || WHATSAPP_CALLING_RUNTIME_MODE).trim().toLowerCase();
    return normalized || WHATSAPP_CALLING_RUNTIME_MODE;
}

export function normalizeBaileysCallBridgeResult(response: any): WhatsAppCallingProviderResult {
    const event = String(response?.event || response?.status || "").trim().toLowerCase();
    const bridgeCallId = response?.bridgeCallId || response?.callId || null;
    const whatsappCallId = response?.whatsappCallId
        || response?.whatsapp_call_id
        || response?.raw?.callId
        || response?.raw?.call_id
        || response?.raw?.id
        || null;
    const callId = response?.providerCallId || whatsappCallId || bridgeCallId || response?.id || null;
    const mediaStatus = normalizeMediaStatus(response?.mediaStatus);
    if (response?.success === false || event === "call_failed" || event === "call_media_unknown") {
        return {
            success: false,
            outcome: "failed",
            status: "failed",
            providerCallId: callId ? String(callId) : null,
            bridgeCallId: bridgeCallId ? String(bridgeCallId) : null,
            whatsappCallId: whatsappCallId ? String(whatsappCallId) : null,
            bridgeEvent: event || "call_failed",
            mediaStatus,
            errorCode: response?.errorCode
                ? String(response.errorCode)
                : event === "call_media_unknown"
                    ? "baileys_offer_unconfirmed"
                    : "baileys_call_bridge_failed",
            errorMessage: response?.errorMessage
                || response?.error
                || (event === "call_media_unknown"
                    ? "WhatsApp accepted the call offer, but no ringing event arrived."
                    : "Baileys call bridge failed."),
            raw: response,
        };
    }

    if (event === "call_rejected") {
        return {
            success: false,
            outcome: "success",
            status: "rejected",
            providerCallId: callId ? String(callId) : null,
            bridgeCallId: bridgeCallId ? String(bridgeCallId) : null,
            whatsappCallId: whatsappCallId ? String(whatsappCallId) : null,
            bridgeEvent: event,
            mediaStatus,
            raw: response,
        };
    }

    if (event === "call_timeout") {
        return {
            success: false,
            outcome: "success",
            status: "failed",
            providerCallId: callId ? String(callId) : null,
            bridgeCallId: bridgeCallId ? String(bridgeCallId) : null,
            whatsappCallId: whatsappCallId ? String(whatsappCallId) : null,
            bridgeEvent: event,
            mediaStatus,
            errorCode: "call_timeout",
            errorMessage: "Baileys call offer timed out.",
            raw: response,
        };
    }

    if (event === "call_terminated") {
        return {
            success: true,
            outcome: "success",
            status: "ended",
            providerCallId: callId ? String(callId) : null,
            bridgeCallId: bridgeCallId ? String(bridgeCallId) : null,
            whatsappCallId: whatsappCallId ? String(whatsappCallId) : null,
            bridgeEvent: event,
            mediaStatus,
            raw: response,
        };
    }

    if (event === "call_accepted" || event === "call_media_connected") {
        return {
            success: true,
            outcome: "success",
            status: "accepted",
            providerCallId: callId ? String(callId) : null,
            bridgeCallId: bridgeCallId ? String(bridgeCallId) : null,
            whatsappCallId: whatsappCallId ? String(whatsappCallId) : null,
            bridgeEvent: event,
            mediaStatus: event === "call_media_connected" ? "audio_connected" : mediaStatus,
            raw: response,
        };
    }

    return {
        success: true,
        outcome: "success",
        status: "call_attempted",
        providerCallId: callId ? String(callId) : null,
        bridgeCallId: bridgeCallId ? String(bridgeCallId) : null,
        whatsappCallId: whatsappCallId ? String(whatsappCallId) : null,
        bridgeEvent: event || "call_offer_sent",
        mediaStatus,
        raw: response,
    };
}

export function normalizeBrowserCallBridgeResult(response: any): WhatsAppCallingProviderResult {
    const state = normalizeBrowserCallState(response?.state || response?.status || response?.event);
    const event = String(response?.event || response?.status || response?.state || state || "").trim().toLowerCase();
    const bridgeCallId = response?.bridgeCallId || response?.callId || response?.id || null;
    const providerCallId = response?.providerCallId || bridgeCallId || null;
    const recordingPath = response?.recordingPath || response?.recording?.path || null;
    const raw = {
        ...response,
        browserCallState: state,
        recordingPath,
        recordingDurationSeconds: response?.recordingDurationSeconds || response?.recording?.durationSeconds || null,
    };

    if (response?.success === false || state === "failed") {
        return {
            success: false,
            outcome: "failed",
            status: "failed",
            providerCallId: providerCallId ? String(providerCallId) : null,
            bridgeCallId: bridgeCallId ? String(bridgeCallId) : null,
            bridgeEvent: event || "failed",
            mediaStatus: recordingPath ? "audio_connected" : "signaling_only",
            errorCode: response?.errorCode ? String(response.errorCode) : "browser_call_bridge_failed",
            errorMessage: response?.errorMessage || response?.error || "WhatsApp Web browser call bridge failed.",
            raw,
        };
    }

    if (state === "ended") {
        return {
            success: true,
            outcome: "success",
            status: "ended",
            providerCallId: providerCallId ? String(providerCallId) : null,
            bridgeCallId: bridgeCallId ? String(bridgeCallId) : null,
            bridgeEvent: event || "ended",
            mediaStatus: recordingPath ? "audio_connected" : "signaling_only",
            raw,
        };
    }

    return {
        success: true,
        outcome: "success",
        status: state === "recording" || state === "ringing" || state === "started" ? "call_attempted" : "call_attempted",
        providerCallId: providerCallId ? String(providerCallId) : null,
        bridgeCallId: bridgeCallId ? String(bridgeCallId) : null,
        bridgeEvent: event || state || "started",
        mediaStatus: state === "recording" || recordingPath ? "audio_connected" : "signaling_only",
        raw,
    };
}

async function bridgeFetch(baseUrl: string, path: string, init?: RequestInit & { timeoutMs?: number }) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), Math.max(500, Number(init?.timeoutMs || 2500)));
    try {
        const response = await fetch(`${getWhatsAppCallBridgeBaseUrl(baseUrl)}${path}`, {
            ...init,
            signal: controller.signal,
            headers: {
                "Content-Type": "application/json",
                ...(process.env.WHATSAPP_CALL_BRIDGE_SECRET
                    ? { "x-whatsapp-call-bridge-secret": process.env.WHATSAPP_CALL_BRIDGE_SECRET }
                    : {}),
                ...(init?.headers || {}),
            },
        });
        clearTimeout(timeout);
        const payload = await response.json().catch(() => null);
        if (!response.ok) {
            return {
                success: false,
                event: "call_failed",
                errorCode: payload?.errorCode || `bridge_http_${response.status}`,
                errorMessage: payload?.error || payload?.message || response.statusText,
                raw: payload,
            };
        }
        return payload;
    } catch (error: any) {
        clearTimeout(timeout);
        return {
            success: false,
            event: "call_failed",
            errorCode: error?.name === "AbortError" ? "bridge_timeout" : "bridge_unreachable",
            errorMessage: error?.name === "AbortError" ? "WhatsApp call bridge did not respond quickly." : error?.message || "WhatsApp call bridge is unreachable.",
        };
    }
}

export function resolveBaileysCallOfferTarget(input: { phone?: string | null; targetJid?: string | null }) {
    const phoneDigits = String(input.phone || "").replace(/\D/g, "");
    if (phoneDigits.length >= 8) return phoneDigits;

    const jid = String(input.targetJid || "").trim().toLowerCase();
    if (/^[0-9]+@(s\.whatsapp\.net|lid)$/.test(jid)) return jid;
    return phoneDigits || "";
}

export class BaileysCallBridgeProvider implements WhatsAppCallingProvider {
    constructor(private readonly baseUrl: string = getBaileysCallBridgeBaseUrl()) {}

    async placeCall(input: {
        locationId: string;
        to: string;
        targetJid?: string | null;
        conversationId: string;
        contactId: string;
        attemptId: string;
    }): Promise<WhatsAppCallingProviderResult> {
        try {
            const config = await (db as any).whatsAppCallBridgeConfig.findUnique({
                where: { locationId: input.locationId },
            }).catch(() => null);
            const sessionId = String(config?.baileysSessionId || input.locationId).trim();
            if (!sessionId) {
                return {
                    success: false,
                    outcome: "failed",
                    status: "failed",
                    errorCode: "baileys_session_missing",
                    errorMessage: "Baileys call bridge session id is not configured.",
                };
            }

            const response = await bridgeFetch(
                this.baseUrl,
                `/sessions/${encodeURIComponent(sessionId)}/offer-call`,
                {
                    method: "POST",
                    timeoutMs: BAILEYS_OFFER_CALL_TIMEOUT_MS,
                    body: JSON.stringify({
                        to: resolveBaileysCallOfferTarget({
                            phone: input.to,
                            targetJid: input.targetJid,
                        }),
                        targetJid: input.targetJid || null,
                        locationId: input.locationId,
                        conversationId: input.conversationId,
                        contactId: input.contactId,
                        attemptId: input.attemptId,
                    }),
                }
            );
            return normalizeBaileysCallBridgeResult(response);
        } catch (error: any) {
            return {
                success: false,
                outcome: "failed",
                status: "failed",
                errorCode: "baileys_call_bridge_unreachable",
                errorMessage: error?.message || "Baileys call bridge is unreachable.",
                raw: error,
            };
        }
    }
}

export class BrowserCallBridgeProvider implements WhatsAppCallingProvider {
    constructor(private readonly baseUrl: string = getWhatsAppCallBridgeBaseUrl()) {}

    async placeCall(input: {
        locationId: string;
        to: string;
        targetJid?: string | null;
        conversationId: string;
        contactId: string;
        attemptId: string;
    }): Promise<WhatsAppCallingProviderResult> {
        const response = await bridgeFetch(
            this.baseUrl,
            "/call/start",
            {
                method: "POST",
                timeoutMs: BROWSER_CALL_START_TIMEOUT_MS,
                body: JSON.stringify({
                    to: resolveBaileysCallOfferTarget({
                        phone: input.to,
                        targetJid: input.targetJid,
                    }),
                    targetJid: input.targetJid || null,
                    locationId: input.locationId,
                    conversationId: input.conversationId,
                    contactId: input.contactId,
                    attemptId: input.attemptId,
                }),
            }
        );
        return normalizeBrowserCallBridgeResult(response);
    }
}

export async function startBaileysCallBridgeSession(input: {
    locationId: string;
    sessionId?: string | null;
    bridgeBaseUrl?: string | null;
    phoneNumber?: string | null;
    resetAuth?: boolean;
}): Promise<BaileysCallBridgeStartResult> {
    const existing = await (db as any).whatsAppCallBridgeConfig.findUnique({
        where: { locationId: input.locationId },
    }).catch(() => null);
    const bridgeBaseUrl = getBaileysCallBridgeBaseUrl(input.bridgeBaseUrl || existing?.bridgeBaseUrl);
    const sessionId = String(input.sessionId || existing?.baileysSessionId || input.locationId).trim();
    if (!sessionId) {
        return {
            success: false,
            status: "offline",
            errorCode: "baileys_session_missing",
            error: "Baileys session id is required.",
        };
    }

    const response = await bridgeFetch(
        bridgeBaseUrl,
        `/sessions/${encodeURIComponent(sessionId)}/start`,
        {
            method: "POST",
            body: JSON.stringify({
                phoneNumber: input.phoneNumber || null,
                resetAuth: input.resetAuth === true,
            }),
        }
    );

    const health = await bridgeFetch(bridgeBaseUrl, "/health", { method: "GET" }).catch(() => null);
    const status = normalizeBridgeStatus(health?.status || response?.status);
    const mediaStatus = normalizeMediaStatus(health?.mediaStatus);
    const lastError = health?.ok === false
        ? String(health?.error || "Bridge unhealthy.")
        : response?.success === false
            ? String(response?.error || response?.errorMessage || "Bridge start failed.")
            : null;
    const updated = await (db as any).whatsAppCallBridgeConfig.upsert({
        where: { locationId: input.locationId },
        create: {
            locationId: input.locationId,
            callingRuntimeMode: WHATSAPP_CALLING_BAILEYS_RUNTIME_MODE,
            baileysCallBridgeStatus: status,
            baileysSessionId: sessionId,
            bridgeBaseUrl,
            lastBaileysHeartbeatAt: health?.lastHeartbeatAt ? new Date(health.lastHeartbeatAt) : new Date(),
            mediaStatus,
            lastError,
            metadata: { start: response, health },
        },
        update: {
            callingRuntimeMode: WHATSAPP_CALLING_BAILEYS_RUNTIME_MODE,
            baileysCallBridgeStatus: status,
            baileysSessionId: sessionId,
            bridgeBaseUrl,
            lastBaileysHeartbeatAt: health?.lastHeartbeatAt ? new Date(health.lastHeartbeatAt) : new Date(),
            mediaStatus,
            lastError,
            metadata: {
                ...((existing?.metadata && typeof existing.metadata === "object") ? existing.metadata : {}),
                start: response,
                health,
            },
        },
    });

    return {
        success: response?.success !== false,
        status,
        sessionId: updated.baileysSessionId || sessionId,
        pairingCode: response?.pairingCode || health?.pairingCode || null,
        qr: response?.qr || health?.qr || null,
        authPath: response?.authPath || null,
        simulated: response?.simulated === true || health?.simulated === true,
        errorCode: response?.errorCode || null,
        error: response?.error || response?.errorMessage || null,
        raw: response,
    };
}

export async function startBrowserCallBridgeSession(input: {
    locationId: string;
    bridgeBaseUrl?: string | null;
}): Promise<BaileysCallBridgeStartResult> {
    const existing = await (db as any).whatsAppCallBridgeConfig.findUnique({
        where: { locationId: input.locationId },
    }).catch(() => null);
    const bridgeBaseUrl = getWhatsAppCallBridgeBaseUrl(input.bridgeBaseUrl || existing?.bridgeBaseUrl);
    const response = await bridgeFetch(bridgeBaseUrl, "/session/start", { method: "POST" });
    const health = await bridgeFetch(bridgeBaseUrl, "/health", { method: "GET" }).catch(() => response);
    const browserStatus = normalizeBrowserBridgeStatus(health?.status || response?.status);
    const status = browserStatus === "ready" ? "ready" : browserStatus === "unpaired" || browserStatus === "starting" ? "pairing" : browserStatus === "unhealthy" ? "unhealthy" : "offline";
    const mediaStatus = health?.audioSinkReady && health?.ffmpegReady ? "media_probe_started" : "failed";

    await (db as any).whatsAppCallBridgeConfig.upsert({
        where: { locationId: input.locationId },
        create: {
            locationId: input.locationId,
            callingRuntimeMode: WHATSAPP_CALLING_RUNTIME_MODE,
            baileysCallBridgeStatus: status,
            baileysSessionId: input.locationId,
            bridgeBaseUrl,
            lastBaileysHeartbeatAt: health?.lastHeartbeatAt ? new Date(health.lastHeartbeatAt) : new Date(),
            mediaStatus,
            lastError: health?.ok ? null : String(health?.error || health?.errorMessage || "Browser call bridge is not ready."),
            metadata: { start: response, health },
        },
        update: {
            callingRuntimeMode: WHATSAPP_CALLING_RUNTIME_MODE,
            baileysCallBridgeStatus: status,
            bridgeBaseUrl,
            lastBaileysHeartbeatAt: health?.lastHeartbeatAt ? new Date(health.lastHeartbeatAt) : new Date(),
            mediaStatus,
            lastError: health?.ok ? null : String(health?.error || health?.errorMessage || "Browser call bridge is not ready."),
            metadata: {
                ...((existing?.metadata && typeof existing.metadata === "object") ? existing.metadata : {}),
                start: response,
                health,
            },
        },
    });

    return {
        success: response?.success !== false,
        status,
        sessionId: input.locationId,
        authPath: health?.profileDir || null,
        simulated: response?.simulated === true || health?.simulated === true,
        errorCode: response?.errorCode || null,
        error: response?.error || response?.errorMessage || null,
        raw: response,
    };
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

    const activityEntry = {
        id: `history:${history.id}`,
        type: "activity",
        createdAt: history.createdAt.toISOString(),
        action: input.action,
        changes,
        user: null,
    };

    void publishConversationRealtimeEvent({
        locationId: input.locationId,
        conversationId: input.conversationId,
        type: "activity.created",
        payload: {
            activityEntry,
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

function buildReadinessFromConfig(config: any): WhatsAppCallingReadiness {
    const callingRuntimeMode = normalizeRuntimeMode(config?.callingRuntimeMode);
    const baileysCallBridgeStatus = normalizeBridgeStatus(config?.baileysCallBridgeStatus);
    const mediaStatus = normalizeMediaStatus(config?.mediaStatus);
    const baileysSessionId = config?.baileysSessionId ? String(config.baileysSessionId) : null;
    const bridgeBaseUrl = getWhatsAppCallBridgeBaseUrl(config?.bridgeBaseUrl);
    const health = config?.metadata && typeof config.metadata === "object" ? (config.metadata as any).health : null;
    const browser = health?.browser && typeof health.browser === "object" ? health.browser : health;
    const profile = health?.profile && typeof health.profile === "object" ? health.profile : {};
    const recording = health?.recording && typeof health.recording === "object" ? health.recording : {};
    const chromeReady = Boolean(browser?.chromeReady ?? health?.chromeReady);
    const whatsappWebPaired = Boolean(browser?.whatsappWebPaired ?? health?.whatsappWebPaired ?? health?.paired);
    const callButtonAvailable = Boolean(browser?.callButtonAvailable ?? health?.callButtonAvailable);
    const audioSinkReady = Boolean(browser?.audioSinkReady ?? health?.audioSinkReady ?? health?.audioReady);
    const ffmpegReady = Boolean(browser?.ffmpegReady ?? health?.ffmpegReady);
    const browserCallBridgeStatus = normalizeBrowserBridgeStatus(
        health?.status
        || (!health ? "offline" : chromeReady && whatsappWebPaired && audioSinkReady && ffmpegReady ? "ready" : "unhealthy")
    );
    const browserCallState = normalizeBrowserCallState(health?.callState || health?.activeCall?.state);
    const simulated = health?.simulated === true;
    const common = {
        callingRuntimeMode,
        baileysCallBridgeStatus,
        baileysSessionId,
        lastBaileysHeartbeatAt: config?.lastBaileysHeartbeatAt?.toISOString?.() || null,
        mediaStatus,
        bridgeBaseUrl,
        browserCallBridgeStatus,
        browserCallState,
        browserProfileDir: String(profile?.dir || health?.profileDir || "").trim() || null,
        browserRecordingDir: String(recording?.dir || health?.recordingDir || "").trim() || null,
        browserRecordingPath: String(recording?.path || health?.recordingPath || "").trim() || null,
        browserRecordingDurationSeconds: Number.isFinite(Number(recording?.durationSeconds || health?.recordingDurationSeconds))
            ? Number(recording?.durationSeconds || health?.recordingDurationSeconds)
            : null,
        chromeReady,
        whatsappWebPaired,
        callButtonAvailable,
        audioSinkReady,
        ffmpegReady,
    };

    if (callingRuntimeMode === WHATSAPP_CALLING_RUNTIME_MODE) {
        if (!health || health?.success === false || browserCallBridgeStatus === "offline") {
            return {
                ready: false,
                outcome: "failed",
                ...common,
                errorCode: health?.errorCode || "browser_call_bridge_unreachable",
                errorMessage: health?.error || health?.errorMessage || "WhatsApp Web browser call bridge is unreachable.",
            };
        }

        if (!chromeReady) {
            return {
                ready: false,
                outcome: "failed",
                ...common,
                errorCode: "browser_chrome_unavailable",
                errorMessage: "Chrome/Xvfb is not ready for WhatsApp Web calling.",
            };
        }

        if (!whatsappWebPaired) {
            return {
                ready: false,
                outcome: "failed",
                ...common,
                errorCode: "whatsapp_web_unpaired",
                errorMessage: "WhatsApp Web is not paired in the browser call bridge profile.",
            };
        }

        if (!audioSinkReady) {
            return {
                ready: false,
                outcome: "failed",
                ...common,
                errorCode: "browser_audio_sink_unavailable",
                errorMessage: "Browser call bridge audio sink is not ready.",
            };
        }

        if (!ffmpegReady) {
            return {
                ready: false,
                outcome: "failed",
                ...common,
                errorCode: "browser_ffmpeg_unavailable",
                errorMessage: "ffmpeg is not available for WhatsApp call recording.",
            };
        }

        return {
            ready: true,
            outcome: "success",
            ...common,
        };
    }

    if (callingRuntimeMode !== WHATSAPP_CALLING_BAILEYS_RUNTIME_MODE) {
        return {
            ready: false,
            outcome: "unsupported",
            ...common,
            errorCode: "unsupported_calling_runtime",
            errorMessage: "Only WhatsApp Web browser call R&D is enabled by default; Baileys is dormant unless explicitly selected.",
        };
    }

    if (simulated) {
        return {
            ready: false,
            outcome: "failed",
            ...common,
            errorCode: "baileys_bridge_simulated",
            errorMessage: "Baileys call bridge is in simulation mode. This can test UI plumbing but cannot ring a customer phone.",
        };
    }

    if (!baileysSessionId) {
        return {
            ready: false,
            outcome: "failed",
            ...common,
            errorCode: "baileys_session_missing",
            errorMessage: "Configure and start a Baileys call bridge session before requesting calls.",
        };
    }

    if (baileysCallBridgeStatus !== "ready") {
        return {
            ready: false,
            outcome: "failed",
            ...common,
            errorCode: "baileys_bridge_not_ready",
            errorMessage: "Baileys call bridge must be ready before sending outbound call offers.",
        };
    }

    if (mediaStatus === "failed") {
        return {
            ready: false,
            outcome: "failed",
            ...common,
            errorCode: "baileys_media_failed",
            errorMessage: "Baileys call bridge media probe is failed. Signaling may work, but media is not viable.",
        };
    }

    return {
        ready: true,
        outcome: "success",
        ...common,
    };
}

export function checkCallingReadinessFromConfig(config: any): WhatsAppCallingReadiness {
    return buildReadinessFromConfig(config);
}

export async function refreshBaileysCallBridgeHealth(locationId: string) {
    const existing = await (db as any).whatsAppCallBridgeConfig.findUnique({
        where: { locationId },
    }).catch(() => null);
    const bridgeBaseUrl = getWhatsAppCallBridgeBaseUrl(existing?.bridgeBaseUrl);
    let health: any = null;
    try {
        health = await bridgeFetch(bridgeBaseUrl, "/health", { method: "GET" });
    } catch (error: any) {
        health = {
            ok: false,
            status: "offline",
            error: error?.message || "Bridge unreachable.",
        };
    }

    const browserStatus = normalizeBrowserBridgeStatus(health?.status || (health?.ok ? "ready" : "offline"));
    const status = browserStatus === "ready" ? "ready" : browserStatus === "unpaired" || browserStatus === "starting" ? "pairing" : browserStatus === "unhealthy" ? "unhealthy" : "offline";
    const mediaStatus = normalizeMediaStatus(health?.mediaStatus || existing?.mediaStatus);
    const sessionId = String(health?.sessionId || existing?.baileysSessionId || locationId).trim();
    const heartbeatAt = health?.lastHeartbeatAt
        ? new Date(health.lastHeartbeatAt)
        : health?.ok
            ? new Date()
            : null;
    const updated = await (db as any).whatsAppCallBridgeConfig.upsert({
        where: { locationId },
        create: {
            locationId,
            callingRuntimeMode: WHATSAPP_CALLING_RUNTIME_MODE,
            baileysCallBridgeStatus: status,
            baileysSessionId: sessionId,
            bridgeBaseUrl,
            lastBaileysHeartbeatAt: heartbeatAt,
            mediaStatus,
            lastError: health?.ok ? null : String(health?.error || "Bridge unhealthy."),
            metadata: { health },
        },
        update: {
            callingRuntimeMode: WHATSAPP_CALLING_RUNTIME_MODE,
            baileysCallBridgeStatus: status,
            baileysSessionId: sessionId,
            bridgeBaseUrl,
            lastBaileysHeartbeatAt: heartbeatAt,
            mediaStatus,
            lastError: health?.ok ? null : String(health?.error || "Bridge unhealthy."),
            metadata: {
                ...((existing?.metadata && typeof existing.metadata === "object") ? existing.metadata : {}),
                health,
            },
        },
    });

    return { health, config: updated };
}

export async function checkCallingReadiness(
    locationId: string,
    options?: { conversationId?: string | null; contactId?: string | null; refreshHealth?: boolean; logActivity?: boolean }
): Promise<WhatsAppCallingReadiness> {
    if (options?.refreshHealth) {
        await refreshBaileysCallBridgeHealth(locationId).catch(() => undefined);
    }
    const config = await (db as any).whatsAppCallBridgeConfig.findUnique({
        where: { locationId },
    }).catch(() => null);
    const readiness = buildReadinessFromConfig(config);

    await (db as any).whatsAppCallBridgeConfig.upsert({
        where: { locationId },
        create: {
            locationId,
            callingRuntimeMode: readiness.callingRuntimeMode,
            baileysCallBridgeStatus: readiness.baileysCallBridgeStatus,
            baileysSessionId: readiness.baileysSessionId || locationId,
            bridgeBaseUrl: readiness.bridgeBaseUrl,
            mediaStatus: readiness.mediaStatus,
            lastReadinessStatus: readiness.outcome,
            lastReadinessCheckedAt: new Date(),
            lastError: readiness.errorMessage || null,
        },
        update: {
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
                runtime: readiness.callingRuntimeMode,
                bridgeStatus: readiness.baileysCallBridgeStatus,
                sessionId: readiness.baileysSessionId || null,
                mediaStatus: readiness.mediaStatus,
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
        refreshHealth: true,
        logActivity: false,
    });
    if (!readiness.ready) {
        return {
            success: false,
            outcome: readiness.outcome,
            errorCode: readiness.errorCode,
            error: readiness.errorMessage || "Baileys call bridge is not ready.",
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
            provider: WHATSAPP_CALLING_RUNTIME_MODE,
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
            runtime: WHATSAPP_CALLING_RUNTIME_MODE,
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

export async function updateWhatsAppCallFromBridgeEvent(input: {
    locationId: string;
    event: any;
}) {
    const eventName = String(input.event?.event || input.event?.type || "").trim();
    const attemptId = input.event?.attemptId ? String(input.event.attemptId) : "";
    const rawBridgeCallId = input.event?.bridgeCallId || input.event?.callId;
    const rawWhatsAppCallId = input.event?.whatsappCallId || input.event?.whatsapp_call_id;
    const rawProviderCallId = input.event?.providerCallId || input.event?.id;
    const bridgeCallId = rawBridgeCallId ? String(rawBridgeCallId) : "";
    const whatsappCallId = rawWhatsAppCallId ? String(rawWhatsAppCallId) : "";
    const providerCallId = rawProviderCallId ? String(rawProviderCallId) : "";
    const attempt = attemptId
        ? await (db as any).whatsAppCallAttempt.findFirst({
            where: { id: attemptId, locationId: input.locationId },
        })
        : whatsappCallId
            ? await (db as any).whatsAppCallAttempt.findFirst({
                where: { whatsappCallId, locationId: input.locationId },
            })
            : bridgeCallId
            ? await (db as any).whatsAppCallAttempt.findFirst({
                where: { bridgeCallId, locationId: input.locationId },
            })
            : providerCallId
                ? await (db as any).whatsAppCallAttempt.findFirst({
                    where: { providerCallId, locationId: input.locationId },
                })
                : null;
    if (!attempt) return { success: false, ignored: true, reason: "attempt_not_found" };

    const runtime = String(attempt.provider || input.event?.runtime || input.event?.provider || WHATSAPP_CALLING_RUNTIME_MODE);
    const result = runtime === WHATSAPP_CALLING_BAILEYS_RUNTIME_MODE
        ? normalizeBaileysCallBridgeResult(input.event)
        : normalizeBrowserCallBridgeResult(input.event);
    const status = result.status;
    const recordingPath = result.raw?.recordingPath || result.raw?.recording?.path || input.event?.recordingPath || input.event?.recording?.path || null;
    const recordingDurationSeconds = result.raw?.recordingDurationSeconds || result.raw?.recording?.durationSeconds || input.event?.recordingDurationSeconds || input.event?.recording?.durationSeconds || null;
    const updatedAttempt = await (db as any).whatsAppCallAttempt.update({
        where: { id: attempt.id },
        data: {
            status,
            providerCallId: result.providerCallId || attempt.providerCallId || null,
            bridgeCallId: result.bridgeCallId || attempt.bridgeCallId || null,
            whatsappCallId: result.whatsappCallId || attempt.whatsappCallId || null,
            endedAt: status === "ended" ? new Date() : attempt.endedAt || null,
            errorCode: result.errorCode || null,
            errorMessage: result.errorMessage || null,
            metadata: {
                ...(attempt.metadata || {}),
                bridgeEvent: input.event || null,
                bridgeCallId: result.bridgeCallId || null,
                whatsappCallId: result.whatsappCallId || null,
                mediaStatus: result.mediaStatus || null,
                browserCallState: normalizeBrowserCallState(result.raw?.browserCallState || input.event?.state || input.event?.status || eventName),
                recordingPath,
                recordingDurationSeconds,
                fallbackCallLink: input.event?.fallbackCallLink || (attempt.metadata as any)?.fallbackCallLink || null,
            },
        },
    });

    if (recordingPath && (status === "ended" || normalizeBrowserCallState(input.event?.state || input.event?.status || eventName) === "ended")) {
        await attachBrowserCallRecording({
            locationId: input.locationId,
            attempt: updatedAttempt,
            recordingPath: String(recordingPath),
            recordingDurationSeconds: recordingDurationSeconds == null ? null : Number(recordingDurationSeconds),
            event: input.event,
        }).catch((error) => {
            console.error("[WhatsApp Browser Call Bridge] Failed to attach call recording:", error);
        });
    }

    if (attempt.status !== status || result.errorCode || status === "ended") {
        await logWhatsAppCallActivity({
            locationId: input.locationId,
            conversationId: attempt.conversationId,
            contactId: attempt.contactId,
            action: mapBridgeEventToTimelineAction(eventName || result.bridgeEvent || "", status),
            fields: {
                status,
                callAttemptId: attempt.id,
                bridgeCallId: result.bridgeCallId || attempt.bridgeCallId || null,
                whatsappCallId: result.whatsappCallId || attempt.whatsappCallId || null,
                browserCallState: normalizeBrowserCallState(result.raw?.browserCallState || input.event?.state || input.event?.status || eventName),
                recordingPath,
                recordingDurationSeconds,
                errorCode: result.errorCode || null,
                errorMessage: result.errorMessage || null,
            },
        });
    }

    return { success: true, callAttemptId: attempt.id, status };
}

async function attachBrowserCallRecording(input: {
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
            clientMessageId: `whatsapp-browser-call-recording:${input.attempt.id}`,
            type: "WhatsApp",
            direction: "inbound",
            status: "delivered",
            body: "WhatsApp call recording",
            source: "whatsapp_browser_call_bridge",
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

function mapBridgeEventToTimelineAction(eventName: string, status: WhatsAppCallStatus) {
    if (eventName === "call_media_connected") return "WHATSAPP_CALL_MEDIA_CONNECTED";
    if (eventName === "call_media_unknown") return "WHATSAPP_CALL_MEDIA_UNKNOWN";
    if (eventName === "call_terminated" || status === "ended") return "WHATSAPP_CALL_ENDED";
    if (eventName === "call_accepted" || status === "accepted") return "WHATSAPP_CALL_ACCEPTED";
    if (eventName === "call_rejected" || status === "rejected") return "WHATSAPP_CALL_REJECTED";
    if (eventName === "call_ringing") return "WHATSAPP_CALL_RINGING";
    if (eventName === "call_timeout") return "WHATSAPP_CALL_TIMEOUT";
    if (eventName === "call_failed" || status === "failed") return "WHATSAPP_CALL_FAILED";
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

async function findWebBridgeConversationJid(conversationId: string, locationId: string) {
    const sync = await (db as any).conversationSync.findFirst({
        where: {
            conversationId,
            locationId,
            provider: "whatsapp_web_bridge",
            providerConversationId: { not: null },
        },
        orderBy: { updatedAt: "desc" },
        select: { providerConversationId: true },
    }).catch(() => null);
    const jid = String(sync?.providerConversationId || "").trim().toLowerCase();
    if (/^[0-9]+@(s\.whatsapp\.net|lid)$/.test(jid)) return jid;
    return null;
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
        refreshHealth: true,
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
                    errorCode: readiness.errorCode || null,
                    errorMessage: readiness.errorMessage || null,
                    metadata: {
                        ...(failedAttempt.metadata || {}),
                        readiness,
                        spikeResult: readiness.callingRuntimeMode === WHATSAPP_CALLING_BAILEYS_RUNTIME_MODE
                            ? "baileys_bridge_not_ready"
                            : "browser_call_bridge_not_ready",
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
                provider: readiness.callingRuntimeMode,
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

    if (!existing) {
        await logWhatsAppCallActivity({
            locationId: input.locationId,
            conversationId: conversation.id,
            contactId: contact.id,
            action: "WHATSAPP_CALL_FAILED",
            fields: {
                status: "failed",
                errorCode: "recent_whatsapp_activity_required",
                errorMessage: "A recent WhatsApp conversation is required before starting a WhatsApp call.",
            },
        });
        return {
            success: false,
            outcome: "failed" as const,
            status: "failed" as const,
            errorCode: "recent_whatsapp_activity_required",
            errorMessage: "A recent WhatsApp conversation is required before starting a WhatsApp call.",
            readiness,
        };
    }
    if (existing.status !== "consented") {
        if (!recentWhatsAppActivity) {
            await logWhatsAppCallActivity({
                locationId: input.locationId,
                conversationId: conversation.id,
                contactId: contact.id,
                action: "WHATSAPP_CALL_FAILED",
                fields: {
                    status: "failed",
                    callAttemptId: existing.id,
                    errorCode: "recent_whatsapp_activity_required",
                    errorMessage: "A recent WhatsApp conversation is required before starting a WhatsApp call.",
                },
            });
            return {
                success: false,
                outcome: "failed" as const,
                status: "failed" as const,
                callAttemptId: existing.id,
                errorCode: "recent_whatsapp_activity_required",
                errorMessage: "A recent WhatsApp conversation is required before starting a WhatsApp call.",
                readiness,
            };
        }
        existing = await (db as any).whatsAppCallAttempt.update({
            where: { id: existing.id },
            data: {
                status: "consented",
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
        data: { status: "call_attempted", attemptedAt: new Date() },
    });

    const provider = input.provider || (
        readiness.callingRuntimeMode === WHATSAPP_CALLING_BAILEYS_RUNTIME_MODE
            ? new BaileysCallBridgeProvider(readiness.bridgeBaseUrl)
            : new BrowserCallBridgeProvider(readiness.bridgeBaseUrl)
    );
    const targetJid = await findWebBridgeConversationJid(conversation.id, input.locationId);
    const result = await provider.placeCall({
        locationId: input.locationId,
        to: contact.phone || existing.contactPhone || "",
        targetJid,
        conversationId: conversation.id,
        contactId: contact.id,
        attemptId: existing.id,
    });

    await (db as any).whatsAppCallAttempt.update({
        where: { id: existing.id },
        data: {
            status: result.status || (result.success ? "call_attempted" : "failed"),
            providerCallId: result.providerCallId || null,
            bridgeCallId: result.bridgeCallId || null,
            whatsappCallId: result.whatsappCallId || null,
            errorCode: result.errorCode || null,
            errorMessage: result.errorMessage || null,
            metadata: {
                ...(existing.metadata || {}),
                bridgeResult: result.raw || null,
                bridgeEvent: result.bridgeEvent || null,
                bridgeCallId: result.bridgeCallId || null,
                whatsappCallId: result.whatsappCallId || null,
                targetJid,
                mediaStatus: result.mediaStatus || null,
                browserCallState: normalizeBrowserCallState(result.raw?.browserCallState || result.raw?.state || result.raw?.status || result.bridgeEvent),
                browserProfileState: result.raw?.profile || result.raw?.profileState || null,
                recordingPath: result.raw?.recordingPath || result.raw?.recording?.path || null,
                recordingDurationSeconds: result.raw?.recordingDurationSeconds || result.raw?.recording?.durationSeconds || null,
                spikeResult: result.success
                    ? readiness.callingRuntimeMode === WHATSAPP_CALLING_BAILEYS_RUNTIME_MODE
                        ? "baileys_call_signaling_started"
                        : "browser_call_started"
                    : readiness.callingRuntimeMode === WHATSAPP_CALLING_BAILEYS_RUNTIME_MODE
                        ? "baileys_call_signaling_failed"
                        : "browser_call_failed",
            },
        },
    });

    if (!result.success) {
        await logWhatsAppCallActivity({
            locationId: input.locationId,
            conversationId: conversation.id,
            contactId: contact.id,
            action: "WHATSAPP_CALL_FAILED",
            fields: {
                status: result.status,
                outcome: result.outcome,
                callAttemptId: existing.id,
                callId: result.providerCallId || null,
                bridgeCallId: result.bridgeCallId || null,
                whatsappCallId: result.whatsappCallId || null,
                event: result.bridgeEvent || null,
                mediaStatus: result.mediaStatus || null,
                errorCode: result.errorCode || null,
                errorMessage: result.errorMessage || null,
            },
        });
    }

    return { success: result.success, callAttemptId: existing.id, ...result };
}
