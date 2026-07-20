import { createServer, IncomingMessage, ServerResponse } from "http";
import { createRequire } from "module";
import { execFileSync } from "child_process";
import { rm } from "fs/promises";
import path from "path";
import qrcode from "qrcode";
import db from "../lib/db";
import { prepareWhatsAppWebBridgeWebhookPayload } from "../lib/whatsapp/web-bridge-payload";
import {
    DEFAULT_WEB_BRIDGE_NON_READY_STALE_MS,
    getStaleWhatsAppWebBridgeNonReadyReason,
} from "../lib/whatsapp/web-bridge-readiness";
import {
    isWhatsAppWebBridgeRecoverableMediaError,
    isWhatsAppWebBridgeStaleError,
    shouldRestartWhatsAppWebBridgeSession,
} from "../lib/whatsapp/web-bridge-stale";
import { getWhatsAppLinkPreviewDecision } from "../lib/whatsapp/link-preview";
import {
    isDeviceTunnelRuntimeLeaseEnforcementActive,
    sameDeviceTunnelRuntimeOwnership,
    validateDeviceTunnelRuntimeOwnership,
    validateDeviceTunnelRuntimeOwnershipDescriptor,
    type DeviceTunnelRuntimeOwnership,
} from "../lib/device-tunnel/runtime-ownership";

const require = createRequire(path.join(process.cwd(), "scripts", "whatsapp-web-bridge-service.ts"));

const PORT = Number(process.env.WHATSAPP_WEB_BRIDGE_PORT || 3218);
const APP_WEBHOOK_URL = String(process.env.WHATSAPP_WEB_BRIDGE_APP_WEBHOOK_URL || "http://127.0.0.1:3000/api/webhooks/whatsapp-web-bridge");
const SECRET = String(process.env.WHATSAPP_WEB_BRIDGE_SECRET || process.env.CRON_SECRET || "").trim();
const DEVICE_TUNNEL_GATEWAY_URL = String(process.env.DEVICE_TUNNEL_GATEWAY_URL || "http://127.0.0.1:3220").replace(/\/+$/, "");
const DEVICE_TUNNEL_INTERNAL_SECRET = String(process.env.DEVICE_TUNNEL_INTERNAL_SECRET || "").trim();
const RUNTIME_LEASE_ENFORCEMENT = isDeviceTunnelRuntimeLeaseEnforcementActive();
const GATEWAY_NODE_ID = String(process.env.DEVICE_TUNNEL_GATEWAY_NODE_ID || "").trim();
const RUNTIME_OWNER_INSTANCE_ID = String(process.env.DEVICE_TUNNEL_RUNTIME_OWNER_INSTANCE_ID || "").trim();
if (RUNTIME_LEASE_ENFORCEMENT && (!GATEWAY_NODE_ID || !RUNTIME_OWNER_INSTANCE_ID)) {
    throw new Error("The bridge requires DEVICE_TUNNEL_GATEWAY_NODE_ID and DEVICE_TUNNEL_RUNTIME_OWNER_INSTANCE_ID when runtime lease enforcement is enabled");
}
const SESSION_DIR = String(process.env.WHATSAPP_WEB_BRIDGE_SESSION_DIR || path.join(process.cwd(), ".data", "whatsapp-web-sessions"));
const APP_WEBHOOK_BODY_LIMIT_BYTES = 10 * 1024 * 1024;
const DEFAULT_MAX_INLINE_MEDIA_BYTES = Math.floor(APP_WEBHOOK_BODY_LIMIT_BYTES * 0.6);

type ManagedSession = {
    sessionId: string;
    locationId: string;
    client: any;
    ready: boolean;
    phone?: string | null;
    status: string;
    startedAt: Date;
    lastEventAt?: Date | null;
    lastReadyAt?: Date | null;
    lastError?: string | null;
    lastWebhookSuccessAt?: Date | null;
    lastWebhookErrorAt?: Date | null;
    deviceTunnelBindingId?: string | null;
    ownership?: DeviceTunnelRuntimeOwnership | null;
    ownershipValid?: boolean;
    restarting?: boolean;
};

const sessions = new Map<string, ManagedSession>();
const serviceStartedAt = new Date();
const MAX_INLINE_MEDIA_BYTES = Math.min(
    Math.max(Number(process.env.WHATSAPP_WEB_BRIDGE_MAX_INLINE_MEDIA_BYTES || DEFAULT_MAX_INLINE_MEDIA_BYTES), 1024 * 1024),
    DEFAULT_MAX_INLINE_MEDIA_BYTES
);
const SUPPORTED_INLINE_MEDIA_TYPES = new Set(["image", "audio", "ptt", "document", "video"]);
const WATCHDOG_INTERVAL_MS = Math.max(Number(process.env.WHATSAPP_WEB_BRIDGE_WATCHDOG_INTERVAL_MS || 60_000), 15_000);
const QR_STALE_MS = Math.max(Number(process.env.WHATSAPP_WEB_BRIDGE_QR_STALE_MS || 90_000), 30_000);
const NON_READY_STALE_MS = Math.max(Number(process.env.WHATSAPP_WEB_BRIDGE_NON_READY_STALE_MS || DEFAULT_WEB_BRIDGE_NON_READY_STALE_MS), 30_000);
const PROTOCOL_TIMEOUT_MS = Math.max(Number(process.env.WHATSAPP_WEB_BRIDGE_PROTOCOL_TIMEOUT_MS || 120_000), 30_000);
const INITIALIZE_TIMEOUT_MS = Math.max(Number(process.env.WHATSAPP_WEB_BRIDGE_INITIALIZE_TIMEOUT_MS || 45_000), 10_000);
const OPERATION_TIMEOUT_MS = Math.max(Number(process.env.WHATSAPP_WEB_BRIDGE_OPERATION_TIMEOUT_MS || 30_000), 5_000);
const MEDIA_OPERATION_TIMEOUT_MS = Math.max(Number(process.env.WHATSAPP_WEB_BRIDGE_MEDIA_OPERATION_TIMEOUT_MS || 60_000), 10_000);
const SESSION_RESTART_BACKOFF_MS = Math.max(Number(process.env.WHATSAPP_WEB_BRIDGE_SESSION_RESTART_BACKOFF_MS || 15_000), 1_000);
const MAX_SESSION_RESTART_ATTEMPTS = Math.max(Number(process.env.WHATSAPP_WEB_BRIDGE_MAX_SESSION_RESTART_ATTEMPTS || 5), 1);
const MEDIA_DOWNLOAD_RETRY_ATTEMPTS = Math.min(
    Math.max(Number(process.env.WHATSAPP_WEB_BRIDGE_MEDIA_DOWNLOAD_RETRY_ATTEMPTS || 2), 1),
    3,
);
const MEDIA_DOWNLOAD_RETRY_BACKOFF_MS = Math.max(
    Number(process.env.WHATSAPP_WEB_BRIDGE_MEDIA_DOWNLOAD_RETRY_BACKOFF_MS || 1_000),
    100,
);

function detectChromiumUserAgent() {
    const configured = String(process.env.WHATSAPP_WEB_BRIDGE_USER_AGENT || "").trim();
    if (configured) return configured;
    try {
        const puppeteer = require("puppeteer");
        const versionOutput = execFileSync(puppeteer.executablePath(), ["--version"], {
            encoding: "utf8",
            timeout: 5_000,
        });
        const version = String(versionOutput).match(/\b(\d+\.\d+\.\d+\.\d+)\b/)?.[1];
        if (version) {
            const platform = process.platform === "darwin" ? "Macintosh; Intel Mac OS X 10_15_7" : "X11; Linux x86_64";
            return `Mozilla/5.0 (${platform}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${version} Safari/537.36`;
        }
    } catch (error: any) {
        console.warn("[WhatsApp Web Bridge] Could not detect the bundled Chromium version:", error?.message || error);
    }
    // Avoid whatsapp-web.js's legacy Chrome 101 default if version detection is unavailable.
    return "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
}

const BROWSER_USER_AGENT = detectChromiumUserAgent();

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
    let timeout: NodeJS.Timeout | null = null;
    const timeoutPromise = new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms.`)), timeoutMs);
    });
    return Promise.race([promise, timeoutPromise]).finally(() => {
        if (timeout) clearTimeout(timeout);
    });
}

async function sleep(ms: number) {
    await new Promise((resolve) => setTimeout(resolve, ms));
}

function jidFromId(value: any) {
    return String(value?._serialized || value?.serialized || value || "").trim();
}

function phoneJidFromContact(contact: any) {
    const candidates = [
        contact?.id?._serialized,
        contact?.wid?._serialized,
        contact?.jid,
    ].map(jidFromId).filter(Boolean);
    return candidates.find((candidate) => /@(c\.us|s\.whatsapp\.net)$/i.test(candidate)) || "";
}

function lidJidFromContact(contact: any, fallback?: string) {
    const candidates = [
        contact?.lid?._serialized,
        contact?.lid,
        contact?.id?._serialized,
        contact?.wid?._serialized,
        contact?.jid,
        fallback,
    ].map(jidFromId).filter(Boolean);
    return candidates.find((candidate) => /@lid$/i.test(candidate)) || "";
}

async function resolveLidAndPhoneFromClient(messageOrChat: any, fallbackJid: string) {
    const client = messageOrChat?.client;
    if (!client || typeof client.getContactLidAndPhone !== "function" || !fallbackJid) {
        return { phoneJid: "", lidJid: "" };
    }

    try {
        const mappings = await withTimeout(
            client.getContactLidAndPhone([fallbackJid]),
            OPERATION_TIMEOUT_MS,
            `WhatsApp LID/phone lookup ${fallbackJid}`
        );
        const mapping = Array.isArray(mappings) ? mappings[0] : null;
        return {
            phoneJid: jidFromId(mapping?.pn),
            lidJid: jidFromId(mapping?.lid),
        };
    } catch (error: any) {
        console.warn(`[WhatsApp Web Bridge] LID/phone lookup failed for ${fallbackJid}:`, error?.message || error);
        return { phoneJid: "", lidJid: "" };
    }
}

async function buildContactIdentity(messageOrChat: any, fallbackJid: string) {
    let contact: any = null;
    try {
        if (typeof messageOrChat?.getContact === "function") {
            contact = await messageOrChat.getContact();
        }
    } catch (error: any) {
        console.warn(`[WhatsApp Web Bridge] Contact metadata lookup failed for ${fallbackJid}:`, error?.message || error);
    }

    const contactPhoneJid = phoneJidFromContact(contact);
    const contactLidJid = lidJidFromContact(contact, fallbackJid);
    const needsResolver = !contactPhoneJid || !contactLidJid;
    const resolved = needsResolver
        ? await resolveLidAndPhoneFromClient(messageOrChat, fallbackJid)
        : { phoneJid: "", lidJid: "" };
    const phoneJid = contactPhoneJid
        || resolved.phoneJid
        || (/@(c\.us|s\.whatsapp\.net)$/i.test(fallbackJid) ? fallbackJid : "");
    const lidJid = contactLidJid || resolved.lidJid;
    const displayName = String(
        contact?.verifiedName
        || contact?.name
        || contact?.shortName
        || contact?.pushname
        || messageOrChat?.name
        || messageOrChat?.formattedTitle
        || ""
    ).trim();

    return {
        rawChatId: fallbackJid,
        remoteJid: fallbackJid,
        lidJid: lidJid || null,
        phoneJid: phoneJid || null,
        number: contact?.number || null,
        pushname: contact?.pushname || null,
        name: contact?.name || null,
        shortName: contact?.shortName || null,
        verifiedName: contact?.verifiedName || null,
        displayName: displayName || null,
        isMyContact: typeof contact?.isMyContact === "boolean" ? contact.isMyContact : null,
        isBusiness: typeof contact?.isBusiness === "boolean" ? contact.isBusiness : null,
    };
}

function json(res: ServerResponse, status: number, payload: any) {
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(payload));
}

function isAuthorized(req: IncomingMessage) {
    if (!SECRET) return true;
    return req.headers["x-whatsapp-web-bridge-secret"] === SECRET;
}

async function readJson(req: IncomingMessage) {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    if (!chunks.length) return {};
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

async function emitEvent(payload: Record<string, any>) {
    const prepared = prepareWhatsAppWebBridgeWebhookPayload({
        payload,
        maxBodyBytes: APP_WEBHOOK_BODY_LIMIT_BYTES,
    });
    if (prepared.omittedInlineMedia) {
        const messageId = getSerializedMessageId(payload?.message);
        console.warn(
            `[WhatsApp Web Bridge] Inline media omitted for ${payload.event || "event"} ${messageId || "unknown message"}: webhook body ${prepared.originalBodyBytes} bytes exceeds ${APP_WEBHOOK_BODY_LIMIT_BYTES}; sending ${prepared.bodyBytes} bytes.`
        );
    }
    const response = await fetch(APP_WEBHOOK_URL, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            ...(SECRET ? { "x-whatsapp-web-bridge-secret": SECRET } : {}),
        },
        body: prepared.body,
    });
    if (!response.ok) {
        const text = await response.text().catch(() => "");
        throw new Error(`App webhook failed ${response.status}: ${text}`);
    }
}

function markSessionEvent(session: ManagedSession, status: string, error?: unknown) {
    const isLateStartupEvent = session.ready && (status === "starting" || status === "loading" || status === "authenticated");
    if (!isLateStartupEvent) {
        session.status = status;
    }
    session.lastEventAt = new Date();
    session.lastError = error ? String((error as any)?.message || error) : null;
}

async function emitSessionEvent(session: ManagedSession, payload: Record<string, any>) {
    try {
        await assertManagedSessionOwnership(session);
        await emitEvent({
            ...payload,
            ...(RUNTIME_LEASE_ENFORCEMENT && session.deviceTunnelBindingId ? { ownership: session.ownership } : {}),
        });
        session.lastWebhookSuccessAt = new Date();
        if (session.lastWebhookErrorAt && session.lastWebhookSuccessAt > session.lastWebhookErrorAt) {
            session.lastError = null;
        }
    } catch (error: any) {
        session.lastWebhookErrorAt = new Date();
        session.lastError = error?.message || "Failed to emit bridge webhook event.";
        session.lastEventAt = new Date();
        console.error(`[WhatsApp Web Bridge] Failed to emit ${payload.event || "event"} for ${session.sessionId}:`, error?.message || error);
    }
}

function serializeManagedSession(session: ManagedSession) {
    const runtimeReady = !RUNTIME_LEASE_ENFORCEMENT || !session.deviceTunnelBindingId || session.ownershipValid === true;
    return {
        sessionId: session.sessionId,
        locationId: session.locationId,
        ready: Boolean(session.ready && runtimeReady),
        phone: session.phone || null,
        status: session.ready && runtimeReady ? "ready" : (session.status || "starting"),
        restarting: Boolean(session.restarting),
        startedAt: session.startedAt.toISOString(),
        lastEventAt: session.lastEventAt?.toISOString?.() || null,
        lastReadyAt: session.lastReadyAt?.toISOString?.() || null,
        lastWebhookSuccessAt: session.lastWebhookSuccessAt?.toISOString?.() || null,
        lastWebhookErrorAt: session.lastWebhookErrorAt?.toISOString?.() || null,
        lastError: session.lastError || null,
    };
}

function createRuntimeOwnershipUnavailableError(message = "WhatsApp Android egress runtime ownership is unavailable.") {
    const error: any = new Error(message);
    error.code = "DEVICE_EGRESS_OFFLINE";
    return error;
}

async function assertManagedSessionOwnership(session: ManagedSession) {
    if (!RUNTIME_LEASE_ENFORCEMENT || !session.deviceTunnelBindingId) return;
    if (!session.ownership || !session.ownershipValid) throw createRuntimeOwnershipUnavailableError();
    if (
        session.ownership.gatewayNodeId !== GATEWAY_NODE_ID
        || session.ownership.ownerInstanceId !== RUNTIME_OWNER_INSTANCE_ID
        || !await validateDeviceTunnelRuntimeOwnership({ db: db as any, ownership: session.ownership })
    ) {
        session.ownershipValid = false;
        throw createRuntimeOwnershipUnavailableError();
    }
}

async function fenceManagedSession(session: ManagedSession, reason: string) {
    if (sessions.get(session.sessionId) !== session) return;
    sessions.delete(session.sessionId);
    session.ready = false;
    session.ownershipValid = false;
    markSessionEvent(session, "blocked_egress", reason);
    await session.client?.destroy?.().catch(() => null);
}

async function refreshRuntimeSessionOwnerships() {
    if (!RUNTIME_LEASE_ENFORCEMENT) return;
    await Promise.all(Array.from(sessions.values()).map(async (session) => {
        if (!session.deviceTunnelBindingId || !session.ownership || !session.ownershipValid) return;
        await assertManagedSessionOwnership(session).catch((error: any) => (
            fenceManagedSession(session, error?.message || "Runtime ownership was fenced")
        ));
    }));
}

async function restartStaleSession(session: ManagedSession, error: unknown) {
    if (session.restarting) return;
    const metadata = (session as any).restartMetadata || { attempts: 0, firstRestartAt: Date.now() };
    const windowAgeMs = Date.now() - Number(metadata.firstRestartAt || Date.now());
    const attempts = windowAgeMs > 10 * 60 * 1000 ? 1 : Number(metadata.attempts || 0) + 1;
    (session as any).restartMetadata = {
        attempts,
        firstRestartAt: windowAgeMs > 10 * 60 * 1000 ? Date.now() : metadata.firstRestartAt,
    };
    if (attempts > MAX_SESSION_RESTART_ATTEMPTS) {
        session.ready = false;
        markSessionEvent(session, "failed", `Restart limit reached after ${MAX_SESSION_RESTART_ATTEMPTS} attempts. Last error: ${(error as any)?.message || error}`);
        await emitSessionEvent(session, {
            event: "auth_failure",
            locationId: session.locationId,
            sessionId: session.sessionId,
            error: session.lastError,
        });
        return;
    }
    session.restarting = true;
    session.ready = false;
    markSessionEvent(session, "restarting", error);
    console.warn(`[WhatsApp Web Bridge] Restarting stale session ${session.sessionId}:`, (error as any)?.message || error);
    await emitSessionEvent(session, {
        event: "restarting",
        locationId: session.locationId,
        sessionId: session.sessionId,
        error: (error as any)?.message || String(error || "Stale WhatsApp Web browser session."),
    });
    const { sessionId, locationId } = session;
    try {
        sessions.delete(sessionId);
        await session.client?.destroy?.().catch(() => null);
    } finally {
        setTimeout(() => {
            startSession(sessionId, locationId).catch((restartError: any) => {
                console.error(`[WhatsApp Web Bridge] Failed to restart stale session ${sessionId}:`, restartError?.message || restartError);
            });
        }, SESSION_RESTART_BACKOFF_MS);
    }
}

async function withStaleRecovery<T>(
    session: ManagedSession,
    operation: () => Promise<T>,
    options?: { isolateMediaFetch?: boolean },
): Promise<T> {
    try {
        return await operation();
    } catch (error) {
        if (shouldRestartWhatsAppWebBridgeSession(error, options)) {
            await restartStaleSession(session, error);
        }
        throw error;
    }
}

async function downloadMessageMediaWithRetry(message: any, messageId: string) {
    let lastError: unknown = null;
    for (let attempt = 1; attempt <= MEDIA_DOWNLOAD_RETRY_ATTEMPTS; attempt++) {
        try {
            const media = await withTimeout(
                message.downloadMedia(),
                MEDIA_OPERATION_TIMEOUT_MS,
                `WhatsApp media download ${messageId || "unknown"}`
            );
            if (media?.data) return media;
            lastError = new Error("WhatsApp Web returned empty media data.");
            break;
        } catch (error) {
            lastError = error;
            const retryable = isWhatsAppWebBridgeRecoverableMediaError(error);
            if (!retryable || attempt >= MEDIA_DOWNLOAD_RETRY_ATTEMPTS) break;
            console.warn(
                `[WhatsApp Web Bridge] Media download retry ${attempt}/${MEDIA_DOWNLOAD_RETRY_ATTEMPTS - 1} for ${messageId}:`,
                (error as any)?.message || error,
            );
            await sleep(MEDIA_DOWNLOAD_RETRY_BACKOFF_MS * attempt);
        }
    }

    try {
        const media = await downloadMessageMediaFromRawFields(message, messageId);
        if (media?.data) {
            console.log(`[WhatsApp Web Bridge] Media fallback download succeeded for ${messageId}`);
            return media;
        }
    } catch (fallbackError: any) {
        console.warn(
            `[WhatsApp Web Bridge] Media fallback download failed for ${messageId}:`,
            fallbackError?.message || fallbackError,
        );
    }

    throw lastError || new Error("Failed to download media.");
}

async function downloadMessageMediaFromRawFields(message: any, messageId: string) {
    const page = message?.client?.pupPage;
    if (!page || typeof page.evaluate !== "function") {
        throw new Error("WhatsApp Web media fallback cannot access the browser page.");
    }

    const data = message?._data || {};
    const mediaFields = {
        directPath: message?.directPath || data.directPath || "",
        encFilehash: message?.encFilehash || data.encFilehash || "",
        filehash: message?.filehash || data.filehash || "",
        mediaKey: message?.mediaKey || data.mediaKey || "",
        mediaKeyTimestamp: message?.mediaKeyTimestamp || data.mediaKeyTimestamp || "",
        type: message?.type || data.type || "",
        mimetype: data.mimetype || message?.mimetype || "",
        filename: data.filename || data.title || message?.filename || "",
        filesize: Number(data.size || data.fileSize || message?.size || 0) || null,
    };

    if (!mediaFields.directPath || !mediaFields.mediaKey) {
        throw new Error("WhatsApp Web media fallback is missing directPath or mediaKey.");
    }

    return withTimeout(
        page.evaluate(async (fields: any) => {
            const manager = window.require("WAWebDownloadManager")?.downloadManager;
            if (!manager?.downloadAndMaybeDecrypt) {
                throw new Error("WhatsApp Web download manager is unavailable.");
            }

            const mockQpl = {
                addAnnotations() {
                    return this;
                },
                addPoint() {
                    return this;
                },
            };
            const decryptedMedia = await manager.downloadAndMaybeDecrypt({
                directPath: fields.directPath,
                encFilehash: fields.encFilehash,
                filehash: fields.filehash,
                mediaKey: fields.mediaKey,
                mediaKeyTimestamp: fields.mediaKeyTimestamp,
                type: fields.type,
                signal: new AbortController().signal,
                downloadQpl: mockQpl,
            });
            const data = await window.WWebJS.arrayBufferToBase64Async(decryptedMedia);
            return {
                data,
                mimetype: fields.mimetype,
                filename: fields.filename,
                filesize: fields.filesize,
            };
        }, mediaFields),
        MEDIA_OPERATION_TIMEOUT_MS,
        `WhatsApp raw media fallback ${messageId || "unknown"}`
    );
}

function getSerializedMessageId(message: any) {
    return message?.id?._serialized || message?.id?.id || message?.id || "";
}

function buildMessageLookupIds(messageId: string, chatId: string) {
    const candidates = [messageId];
    if (messageId && chatId && !messageId.includes("_")) {
        candidates.push(`false_${chatId}_${messageId}`);
        candidates.push(`true_${chatId}_${messageId}`);
    }
    return Array.from(new Set(candidates.filter(Boolean)));
}

async function serializeMessage(message: any, options?: { includeMedia?: boolean }) {
    const id = getSerializedMessageId(message);
    const messageType = String(message?.type || "text");
    const caption = message?._data?.caption || "";
    const remoteJid = String(message?.fromMe ? message?.to : message?.from || "").trim();
    const contactIdentity = await buildContactIdentity(message, remoteJid);
    const serialized: Record<string, any> = {
        id,
        from: message?.from || "",
        to: message?.to || "",
        fromMe: Boolean(message?.fromMe),
        body: message?.body || "",
        caption,
        type: messageType,
        timestamp: Number(message?.timestamp || Math.floor(Date.now() / 1000)),
        notifyName: message?._data?.notifyName || message?._data?.pushName || "",
        contactName: contactIdentity.displayName || message?._data?.verifiedName || message?._data?.notifyName || "",
        contactIdentity,
        hasMedia: Boolean(message?.hasMedia),
        ack: Number(message?.ack ?? message?._data?.ack ?? 0),
    };

    if (message?.hasMedia) {
        serialized.mediaMeta = {
            mimetype: message?._data?.mimetype || "",
            filename: message?._data?.filename || message?._data?.title || "",
            size: Number(message?._data?.size || message?._data?.fileSize || 0) || null,
            type: messageType,
            caption,
            attemptedDownload: Boolean(options?.includeMedia),
            inlined: false,
        };
    }

    if (options?.includeMedia && message?.hasMedia && typeof message.downloadMedia === "function") {
        if (!SUPPORTED_INLINE_MEDIA_TYPES.has(messageType)) {
            serialized.mediaError = {
                code: "unsupported_media_type",
                message: `Unsupported WhatsApp Web media type: ${messageType}`,
                type: messageType,
            };
            console.warn(`[WhatsApp Web Bridge] Media skipped for ${id}: unsupported type ${messageType}`);
            return serialized;
        }

        try {
            const media = await downloadMessageMediaWithRetry(message, id);
            const base64 = String(media?.data || "");
            const approxBytes = Math.floor((base64.length * 3) / 4);
            const mimetype = media?.mimetype || message?._data?.mimetype || "";
            const filename = media?.filename || message?._data?.filename || message?._data?.title || "";
            serialized.mediaMeta = {
                ...(serialized.mediaMeta || {}),
                mimetype,
                filename,
                size: approxBytes || Number(message?._data?.size || message?._data?.fileSize || 0) || null,
                type: messageType,
                caption,
                attemptedDownload: true,
                inlined: false,
            };

            if (!mimetype) {
                serialized.mediaError = {
                    code: "missing_mimetype",
                    message: "WhatsApp Web returned media without a mimetype.",
                    type: messageType,
                    size: approxBytes || null,
                };
                console.warn(`[WhatsApp Web Bridge] Media skipped for ${id}: missing mimetype`);
            } else if (media?.data && approxBytes <= MAX_INLINE_MEDIA_BYTES) {
                serialized.media = {
                    mimetype,
                    filename,
                    data: base64,
                    size: approxBytes,
                };
                serialized.mediaMeta.inlined = true;
                console.log(`[WhatsApp Web Bridge] Media inlined for ${id}: ${mimetype} ${approxBytes} bytes`);
            } else if (media?.data) {
                serialized.mediaError = {
                    code: "media_too_large",
                    message: `Media is too large to inline (${approxBytes} bytes).`,
                    size: approxBytes,
                    limit: MAX_INLINE_MEDIA_BYTES,
                    mimetype,
                    filename,
                };
                console.warn(`[WhatsApp Web Bridge] Media too large for ${id}: ${approxBytes} bytes > ${MAX_INLINE_MEDIA_BYTES}`);
            } else {
                serialized.mediaError = {
                    code: "missing_media_data",
                    message: "WhatsApp Web did not return media data.",
                    mimetype,
                    filename,
                    type: messageType,
                };
                console.warn(`[WhatsApp Web Bridge] Media skipped for ${id}: missing media data`);
            }
        } catch (error: any) {
            serialized.mediaError = {
                code: "download_failed",
                message: error?.message || "Failed to download media.",
                type: messageType,
            };
            console.error(`[WhatsApp Web Bridge] Media download failed for ${id}:`, error?.message || error);
        }
    } else if (options?.includeMedia && message?.hasMedia) {
        serialized.mediaError = {
            code: "download_unavailable",
            message: "WhatsApp Web message does not expose downloadMedia().",
            type: messageType,
        };
        console.warn(`[WhatsApp Web Bridge] Media download unavailable for ${id}`);
    }

    return serialized;
}

async function getPhone(client: any) {
    const wid = client?.info?.wid?._serialized || client?.info?.wid?.user || "";
    return String(wid).replace(/@(c\.us|s\.whatsapp\.net)$/i, "") || null;
}

async function getDeviceTunnelProxy(
    sessionId: string,
    locationId: string,
    expectedOwnership?: DeviceTunnelRuntimeOwnership | null,
) {
    const session = await (db as any).whatsAppWebBridgeSession.findUnique({
        where: { locationId },
        select: { id: true, sessionId: true, egressMode: true },
    }).catch(() => null);
    if (session?.egressMode !== "device_tunnel") return null;
    if (session.sessionId !== sessionId) {
        throw createRuntimeOwnershipUnavailableError("The Android egress binding does not match this WhatsApp session.");
    }
    if (!DEVICE_TUNNEL_INTERNAL_SECRET) {
        const error: any = new Error("WhatsApp Android egress is required but DEVICE_TUNNEL_INTERNAL_SECRET is not configured.");
        error.code = "DEVICE_EGRESS_OFFLINE";
        throw error;
    }

    const response = await fetch(`${DEVICE_TUNNEL_GATEWAY_URL}/sessions/${encodeURIComponent(sessionId)}`, {
        headers: { "x-device-tunnel-secret": DEVICE_TUNNEL_INTERNAL_SECRET },
        signal: AbortSignal.timeout(5_000),
    }).catch(() => null);
    if (!response?.ok) {
        const error: any = new Error("The assigned Android WhatsApp network relay is offline.");
        error.code = "DEVICE_EGRESS_OFFLINE";
        throw error;
    }
    const payload = await response.json();
    const proxyHost = String(payload?.proxyHost || "").trim();
    const proxyPort = Number(payload?.proxyPort || 0);
    if (!payload?.ready || proxyHost !== "127.0.0.1" || !Number.isInteger(proxyPort) || proxyPort <= 0) {
        const error: any = new Error("The Android WhatsApp network relay returned an invalid proxy endpoint.");
        error.code = "DEVICE_EGRESS_OFFLINE";
        throw error;
    }
    const ownership = payload?.ownership
        ? validateDeviceTunnelRuntimeOwnershipDescriptor(payload.ownership)
        : null;
    if (RUNTIME_LEASE_ENFORCEMENT) {
        if (!ownership || ownership.locationId !== locationId || ownership.sessionId !== session.id) {
            throw createRuntimeOwnershipUnavailableError();
        }
        if (
            ownership.gatewayNodeId !== GATEWAY_NODE_ID
            || ownership.ownerInstanceId !== RUNTIME_OWNER_INSTANCE_ID
            || (expectedOwnership && !sameDeviceTunnelRuntimeOwnership(ownership, expectedOwnership))
            || !await validateDeviceTunnelRuntimeOwnership({ db: db as any, ownership })
        ) {
            throw createRuntimeOwnershipUnavailableError();
        }
    }
    return { proxyHost, proxyPort, bindingId: String(payload?.bindingId || ""), ownership };
}

async function beginDeviceTunnelSendProof(session: ManagedSession) {
    if (!session.deviceTunnelBindingId || !DEVICE_TUNNEL_INTERNAL_SECRET) return null;
    await assertManagedSessionOwnership(session);
    const response = await fetch(`${DEVICE_TUNNEL_GATEWAY_URL}/sessions/${encodeURIComponent(session.sessionId)}/send-proof-start`, {
        method: "POST",
        headers: { "x-device-tunnel-secret": DEVICE_TUNNEL_INTERNAL_SECRET },
        signal: AbortSignal.timeout(5_000),
    }).catch(() => null);
    if (!response?.ok) {
        if (RUNTIME_LEASE_ENFORCEMENT) throw createRuntimeOwnershipUnavailableError();
        return null;
    }
    const payload = await response.json().catch(() => null);
    return String(payload?.proofNonce || "").trim() || null;
}

async function recordDeviceTunnelSendProof(session: ManagedSession, messageId: string, proofNonce: string | null) {
    if (!session.deviceTunnelBindingId || !messageId || !proofNonce || !DEVICE_TUNNEL_INTERNAL_SECRET) return null;
    const response = await fetch(`${DEVICE_TUNNEL_GATEWAY_URL}/sessions/${encodeURIComponent(session.sessionId)}/verify-send`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "x-device-tunnel-secret": DEVICE_TUNNEL_INTERNAL_SECRET,
        },
        body: JSON.stringify({ messageId, proofNonce }),
        signal: AbortSignal.timeout(5_000),
    }).catch(() => null);
    if (!response?.ok) {
        console.warn(`[WhatsApp Web Bridge] Send succeeded but tunnel proof was unavailable for ${session.sessionId}.`);
        return null;
    }
    return response.json().catch(() => null);
}

async function startSession(sessionId: string, locationId: string, expectedOwnership?: DeviceTunnelRuntimeOwnership | null) {
    const existing = sessions.get(sessionId);
    if (existing) {
        if (
            RUNTIME_LEASE_ENFORCEMENT
            && expectedOwnership
            && !sameDeviceTunnelRuntimeOwnership(existing.ownership, expectedOwnership)
        ) {
            await fenceManagedSession(existing, "Runtime ownership changed");
        } else {
            await assertManagedSessionOwnership(existing);
            return existing;
        }
    }

    const tunnelProxy = await getDeviceTunnelProxy(sessionId, locationId, expectedOwnership);
    const { Client, LocalAuth } = require("whatsapp-web.js");
    const client = new Client({
        userAgent: BROWSER_USER_AGENT,
        authStrategy: new LocalAuth({
            clientId: sessionId,
            dataPath: SESSION_DIR,
        }),
        puppeteer: {
            headless: true,
            protocolTimeout: PROTOCOL_TIMEOUT_MS,
            args: [
                "--no-sandbox",
                "--disable-setuid-sandbox",
                "--disable-dev-shm-usage",
                "--disable-accelerated-2d-canvas",
                "--no-first-run",
                "--no-zygote",
                "--disable-gpu",
                ...(tunnelProxy ? [
                    `--proxy-server=socks5://${tunnelProxy.proxyHost}:${tunnelProxy.proxyPort}`,
                    `--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE ${tunnelProxy.proxyHost}`,
                    "--disable-quic",
                ] : []),
            ],
        },
    });

    const managed: ManagedSession = {
        sessionId,
        locationId,
        client,
        ready: false,
        status: "starting",
        startedAt: new Date(),
        lastEventAt: new Date(),
        lastReadyAt: null,
        lastError: null,
        lastWebhookSuccessAt: null,
        lastWebhookErrorAt: null,
        deviceTunnelBindingId: tunnelProxy?.bindingId || null,
        ownership: tunnelProxy?.ownership || null,
        ownershipValid: !RUNTIME_LEASE_ENFORCEMENT || !tunnelProxy || Boolean(tunnelProxy.ownership),
    };
    sessions.set(sessionId, managed);

    client.on("qr", async (qr: string) => {
        markSessionEvent(managed, "qr");
        console.log(`[WhatsApp Web Bridge] QR generated for ${sessionId}`);
        const qrCode = await qrcode.toDataURL(qr, { margin: 1, width: 320 });
        await emitSessionEvent(managed, { event: "qr", locationId, sessionId, qrCode });
    });

    client.on("loading_screen", async (percent: number, message: string) => {
        markSessionEvent(managed, "starting");
        await emitSessionEvent(managed, { event: "loading", locationId, sessionId, metadata: { percent, message } });
    });

    client.on("authenticated", async () => {
        markSessionEvent(managed, "authenticated");
        console.log(`[WhatsApp Web Bridge] Authenticated ${sessionId}`);
        await emitSessionEvent(managed, { event: "authenticated", locationId, sessionId });
    });

    client.on("auth_failure", async (error: string) => {
        managed.ready = false;
        markSessionEvent(managed, "failed", error);
        console.error(`[WhatsApp Web Bridge] Auth failure for ${sessionId}:`, error);
        await emitSessionEvent(managed, { event: "auth_failure", locationId, sessionId, error });
    });

    client.on("ready", async () => {
        try {
            await assertManagedSessionOwnership(managed);
        } catch (error: any) {
            await fenceManagedSession(managed, error?.message || "Runtime ownership was fenced");
            return;
        }
        managed.ready = true;
        managed.phone = await getPhone(client);
        markSessionEvent(managed, "ready");
        managed.lastReadyAt = new Date();
        console.log(`[WhatsApp Web Bridge] Ready ${sessionId}`);
        await emitSessionEvent(managed, { event: "ready", locationId, sessionId, phone: managed.phone });
    });

    client.on("disconnected", async (reason: string) => {
        managed.ready = false;
        markSessionEvent(managed, "disconnected", reason);
        console.warn(`[WhatsApp Web Bridge] Disconnected ${sessionId}:`, reason);
        sessions.delete(sessionId);
        await emitSessionEvent(managed, { event: "disconnected", locationId, sessionId, error: reason });
    });

    client.on("message", async (message: any) => {
        managed.lastEventAt = new Date();
        try {
            await emitSessionEvent(managed, { event: "message", locationId, sessionId, phone: managed.phone, message: await withStaleRecovery(managed, () => serializeMessage(message, { includeMedia: true })) });
        } catch (error: any) {
            console.error(`[WhatsApp Web Bridge] Failed to serialize inbound message for ${sessionId}:`, error?.message || error);
        }
    });

    client.on("message_create", async (message: any) => {
        managed.lastEventAt = new Date();
        try {
            await emitSessionEvent(managed, { event: "message_create", locationId, sessionId, phone: managed.phone, message: await withStaleRecovery(managed, () => serializeMessage(message, { includeMedia: true })) });
        } catch (error: any) {
            console.error(`[WhatsApp Web Bridge] Failed to serialize outbound echo for ${sessionId}:`, error?.message || error);
        }
    });

    client.on("message_ack", async (message: any, ack: number) => {
        managed.lastEventAt = new Date();
        const messageId = message?.id?._serialized || message?.id?.id || "";
        await emitSessionEvent(managed, { event: "message_ack", locationId, sessionId, messageId, ack });
    });

    try {
        await withTimeout(client.initialize(), INITIALIZE_TIMEOUT_MS, `WhatsApp session initialize ${sessionId}`);
    } catch (error: any) {
        managed.ready = false;
        markSessionEvent(managed, "failed", error);
        await emitSessionEvent(managed, {
            event: "auth_failure",
            locationId,
            sessionId,
            error: error?.message || "WhatsApp session initialization failed.",
        });
        throw error;
    }
    return managed;
}

async function stopSession(sessionId: string) {
    const session = sessions.get(sessionId);
    sessions.delete(sessionId);
    if (session?.client) {
        await session.client.destroy().catch(() => null);
    }
}

async function sendMessage(sessionId: string, payload: any) {
    const session = sessions.get(sessionId);
    if (!session?.client || !session.ready) throw new Error("WhatsApp Web session is not ready.");
    await assertManagedSessionOwnership(session);
    const to = String(payload.to || "").trim();
    if (!to) throw new Error("Missing WhatsApp Web recipient.");

    if (payload.mediaUrl) {
        const { MessageMedia } = require("whatsapp-web.js");
        let media: any;
        try {
            media = await MessageMedia.fromUrl(String(payload.mediaUrl), {
                unsafeMime: true,
                filename: payload.fileName || undefined,
            });
        } catch (error: any) {
            throw new Error(`WhatsApp Web could not read the signed media URL. Re-upload or resend the attachment. ${error?.message || ""}`.trim());
        }
        try {
            const proofNonce = await beginDeviceTunnelSendProof(session);
            const sent = await withStaleRecovery(session, () => withTimeout(
                session.client.sendMessage(to, media, {
                    caption: payload.caption || payload.text || undefined,
                }),
                MEDIA_OPERATION_TIMEOUT_MS,
                `WhatsApp media send ${sessionId}`
            ));
            const messageId = sent?.id?._serialized || sent?.id?.id || "";
            const proofMessageId = messageId || String(payload.proofMessageId || "").trim();
            const egressProof = await recordDeviceTunnelSendProof(session, proofMessageId, proofNonce);
            return { messageId, egressProof };
        } catch (error: any) {
            throw new Error(`WhatsApp Web media send failed. Confirm the recipient is on WhatsApp and the bridge is still connected. ${error?.message || ""}`.trim());
        }
    }

    try {
        const text = String(payload.text || "");
        const preview = getWhatsAppLinkPreviewDecision(text);
        const proofNonce = await beginDeviceTunnelSendProof(session);
        const sent = await withStaleRecovery(session, () => withTimeout(
            session.client.sendMessage(to, text, preview.shouldRequestPreview ? { linkPreview: true } : undefined),
            OPERATION_TIMEOUT_MS,
            `WhatsApp text send ${sessionId}`
        ));
        const messageId = sent?.id?._serialized || sent?.id?.id || "";
        const proofMessageId = messageId || String(payload.proofMessageId || "").trim();
        const egressProof = await recordDeviceTunnelSendProof(session, proofMessageId, proofNonce);
        if (preview.shouldRequestPreview) {
            const sentLinks = Array.isArray(sent?.links) ? sent.links.length : null;
            console.log("[WhatsApp Web Bridge] Text URL send completed", {
                sessionId,
                toKind: /@lid$/i.test(to) ? "lid" : /@c\.us$/i.test(to) ? "phone" : "other",
                urlHost: preview.host,
                linkPreviewRequested: true,
                sentLinks,
                messageId,
            });
        }
        return {
            messageId,
            egressProof,
            linkPreviewRequested: preview.shouldRequestPreview,
            linkPreviewHost: preview.host,
            sentLinksCount: Array.isArray(sent?.links) ? sent.links.length : undefined,
        };
    } catch (error: any) {
        throw new Error(`WhatsApp Web send failed. Confirm the recipient is on WhatsApp and the bridge is still connected. ${error?.message || ""}`.trim());
    }
}

async function listChats(sessionId: string) {
    const session = sessions.get(sessionId);
    if (!session?.client || !session.ready) throw new Error("WhatsApp Web session is not ready.");
    await assertManagedSessionOwnership(session);

    const chats = await withStaleRecovery(session, () => withTimeout(
        session.client.getChats(),
        OPERATION_TIMEOUT_MS,
        `WhatsApp chat list ${sessionId}`
    ));
    return Promise.all((chats || []).map(async (chat: any) => {
        const chatId = chat?.id?._serialized || chat?.id?.user || "";
        const contactIdentity = await buildContactIdentity(chat, chatId);
        return {
        id: chatId,
        name: chat?.name || chat?.formattedTitle || contactIdentity.displayName || chat?.id?.user || "",
        isGroup: Boolean(chat?.isGroup),
        unreadCount: Number(chat?.unreadCount || 0),
        timestamp: Number(chat?.timestamp || 0),
        archived: Boolean(chat?.archived),
        pinned: Boolean(chat?.pinned),
        contactIdentity,
    };
    }));
}

async function fetchMessages(sessionId: string, payload: any) {
    const session = sessions.get(sessionId);
    if (!session?.client || !session.ready) throw new Error("WhatsApp Web session is not ready.");
    await assertManagedSessionOwnership(session);

    const chatId = String(payload.chatId || payload.to || "").trim();
    if (!chatId) throw new Error("Missing chat id.");

    const limit = Math.min(Math.max(Number(payload.limit || 30), 1), 100);
    const includeMedia = Boolean(payload.includeMedia);
    const targetMessageId = String(payload.targetMessageId || payload.messageId || "").trim();

    if (targetMessageId && typeof session.client.getMessageById === "function") {
        for (const lookupMessageId of buildMessageLookupIds(targetMessageId, chatId)) {
            try {
                const targetMessage = await withStaleRecovery(session, () => withTimeout(
                    session.client.getMessageById(lookupMessageId),
                    OPERATION_TIMEOUT_MS,
                    `WhatsApp get message ${sessionId}`
                ));
                if (targetMessage) {
                    console.log(`[WhatsApp Web Bridge] Direct message lookup matched ${targetMessageId} via ${lookupMessageId}`);
                    return [
                        await withStaleRecovery(
                            session,
                            () => serializeMessage(targetMessage, { includeMedia }),
                            includeMedia ? { isolateMediaFetch: true } : undefined,
                        ),
                    ];
                }
            } catch (error: any) {
                console.warn(
                    `[WhatsApp Web Bridge] Direct message lookup failed for ${lookupMessageId}; falling back to next candidate:`,
                    error?.message || error,
                );
            }
        }
    }

    const messages = await withStaleRecovery(session, async () => {
        const chat = await withTimeout(
            session.client.getChatById(chatId),
            OPERATION_TIMEOUT_MS,
            `WhatsApp get chat ${sessionId}`
        );
        return withTimeout(
            chat.fetchMessages({ limit }),
            OPERATION_TIMEOUT_MS,
            `WhatsApp fetch messages ${sessionId}`
        );
    });
    if (targetMessageId) {
        return Promise.all((messages || []).map((message: any) => {
            const messageId = getSerializedMessageId(message);
            if (messageId === targetMessageId) {
                return withStaleRecovery(
                    session,
                    () => serializeMessage(message, { includeMedia }),
                    includeMedia ? { isolateMediaFetch: true } : undefined,
                );
            }
            return {
                id: messageId,
                type: String(message?.type || "text"),
                timestamp: Number(message?.timestamp || Math.floor(Date.now() / 1000)),
                hasMedia: Boolean(message?.hasMedia),
            };
        }));
    }
    return Promise.all((messages || []).map((message: any) => {
        return withStaleRecovery(
            session,
            () => serializeMessage(message, { includeMedia }),
            includeMedia ? { isolateMediaFetch: true } : undefined,
        );
    }));
}

async function resolveChatForPhone(sessionId: string, payload: any) {
    const session = sessions.get(sessionId);
    if (!session?.client || !session.ready) throw new Error("WhatsApp Web session is not ready.");
    await assertManagedSessionOwnership(session);

    const digits = String(payload.phone || "").replace(/\D/g, "");
    if (!digits) throw new Error("Missing phone number.");

    const numberId = await withStaleRecovery(session, async () => {
        if (typeof session.client.getNumberId !== "function") return null;
        return withTimeout(
            session.client.getNumberId(digits),
            OPERATION_TIMEOUT_MS,
            `WhatsApp get number id ${sessionId}`
        ).catch(() => null);
    });
    const numberChatId = jidFromId(numberId);
    if (numberChatId) {
        return { chatId: numberChatId, source: "getNumberId" };
    }

    const chats = await withStaleRecovery(session, () => withTimeout(
        session.client.getChats(),
        OPERATION_TIMEOUT_MS,
        `WhatsApp resolve chat scan ${sessionId}`
    ));
    for (const chat of chats || []) {
        if (chat?.isGroup) continue;
        const chatId = jidFromId(chat?.id);
        if (!chatId) continue;

        const identity = await buildContactIdentity(chat, chatId);
        const candidates = [
            identity.phoneJid,
            identity.number,
            chatId,
        ].filter(Boolean);
        if (candidates.some((candidate) => String(candidate).replace(/\D/g, "") === digits)) {
            return { chatId, source: "chat_scan", contactIdentity: identity };
        }
    }

    return {
        chatId: null,
        source: "not_found",
        available: false,
        reason: "number_not_found",
    };
}

const server = createServer(async (req, res) => {
    try {
        if (!isAuthorized(req)) return json(res, 401, { error: "Unauthorized" });

        const url = new URL(req.url || "/", `http://${req.headers.host || "127.0.0.1"}`);
        const parts = url.pathname.split("/").filter(Boolean);

        if (req.method === "GET" && url.pathname === "/health") {
            await refreshRuntimeSessionOwnerships();
            return json(res, 200, {
                ok: true,
                uptimeSeconds: Math.floor((Date.now() - serviceStartedAt.getTime()) / 1000),
                sessionCount: sessions.size,
                sessions: Array.from(sessions.values()).map(serializeManagedSession),
                sessionDir: SESSION_DIR,
                maxInlineMediaBytes: MAX_INLINE_MEDIA_BYTES,
                protocolTimeoutMs: PROTOCOL_TIMEOUT_MS,
            });
        }

        if (req.method === "GET" && url.pathname === "/ready") {
            await refreshRuntimeSessionOwnerships();
            const serializedSessions = Array.from(sessions.values()).map(serializeManagedSession);
            const readySessions = serializedSessions.filter((session) => session.ready);
            return json(res, readySessions.length > 0 ? 200 : 503, {
                ok: readySessions.length > 0,
                readySessionCount: readySessions.length,
                sessions: serializedSessions,
                sessionDir: SESSION_DIR,
            });
        }

        if (parts[0] === "sessions" && parts[1]) {
            const sessionId = decodeURIComponent(parts[1]);
            if (req.method === "POST" && parts[2] === "start") {
                const body = await readJson(req);
                const locationId = String(body.locationId || "").trim();
                if (!locationId) return json(res, 400, { error: "Missing locationId." });
                const ownership = body.ownership
                    ? validateDeviceTunnelRuntimeOwnershipDescriptor(body.ownership)
                    : null;
                startSession(sessionId, locationId, ownership).catch((error: any) => {
                    console.error(`[WhatsApp Web Bridge] Failed to start session ${sessionId}:`, error?.message || error);
                });
                return json(res, 202, { success: true, sessionId, status: "starting" });
            }
            if (req.method === "POST" && parts[2] === "fence") {
                const body = await readJson(req);
                const ownership = validateDeviceTunnelRuntimeOwnershipDescriptor(body.ownership);
                const session = sessions.get(sessionId);
                if (!session || !sameDeviceTunnelRuntimeOwnership(session.ownership, ownership)) {
                    return json(res, 409, { error: "Runtime ownership no longer matches this browser." });
                }
                await fenceManagedSession(session, "Runtime ownership was fenced");
                return json(res, 200, { success: true, sessionId });
            }
            if (req.method === "POST" && parts[2] === "stop") {
                await withTimeout(stopSession(sessionId), OPERATION_TIMEOUT_MS, `WhatsApp stop session ${sessionId}`);
                return json(res, 200, { success: true, sessionId });
            }
            if (req.method === "POST" && parts[2] === "clear") {
                await withTimeout(stopSession(sessionId), OPERATION_TIMEOUT_MS, `WhatsApp clear stop session ${sessionId}`);
                await rm(path.join(SESSION_DIR, `session-${sessionId}`), { recursive: true, force: true }).catch(() => null);
                return json(res, 200, { success: true, sessionId });
            }
            if (req.method === "POST" && parts[2] === "send") {
                const body = await readJson(req);
                const result = await sendMessage(sessionId, body);
                return json(res, 200, { success: true, ...result });
            }
            if (req.method === "GET" && parts[2] === "chats") {
                const chats = await listChats(sessionId);
                return json(res, 200, { success: true, chats });
            }
            if (req.method === "POST" && parts[2] === "messages") {
                const body = await readJson(req);
                const messages = await fetchMessages(sessionId, body);
                return json(res, 200, { success: true, messages });
            }
            if (req.method === "POST" && parts[2] === "resolve-chat") {
                const body = await readJson(req);
                const result = await resolveChatForPhone(sessionId, body);
                return json(res, 200, { success: true, ...result });
            }
        }

        return json(res, 404, { error: "Not found." });
    } catch (error: any) {
        const deviceEgressOffline = String(error?.code || "") === "DEVICE_EGRESS_OFFLINE";
        console.error("[WhatsApp Web Bridge] Request failed", {
            code: deviceEgressOffline ? "DEVICE_EGRESS_OFFLINE" : String(error?.code || "BRIDGE_REQUEST_FAILED").slice(0, 64),
            name: String(error?.name || "Error").slice(0, 64),
        });
        return json(res, deviceEgressOffline ? 503 : 500, {
            error: error?.message || "Internal Server Error",
            ...(deviceEgressOffline ? { code: "DEVICE_EGRESS_OFFLINE" } : {}),
        });
    }
});

server.listen(PORT, () => {
    console.log(`[WhatsApp Web Bridge] Listening on ${PORT}; session dir ${SESSION_DIR}`);
    if (!process.env.WHATSAPP_WEB_BRIDGE_SESSION_DIR) {
        console.warn("[WhatsApp Web Bridge] WHATSAPP_WEB_BRIDGE_SESSION_DIR is not set. Set it to a persistent path outside release folders, for example /home/martin/whatsapp-web-sessions.");
    }
});

setInterval(() => {
    for (const session of sessions.values()) {
        if ((session.status === "qr" || session.status === "qrcode") && session.lastEventAt) {
            const ageMs = Date.now() - session.lastEventAt.getTime();
            if (ageMs > QR_STALE_MS && !session.restarting) {
                restartStaleSession(session, new Error(`WhatsApp QR expired after ${Math.round(ageMs / 1000)} seconds.`)).catch((error: any) => {
                    console.warn(`[WhatsApp Web Bridge] Failed to refresh expired QR for ${session.sessionId}:`, error?.message || error);
                });
                continue;
            }
        }
        const staleNonReadyReason = getStaleWhatsAppWebBridgeNonReadyReason({
            status: session.status,
            ready: session.ready,
            lastEventAt: session.lastEventAt,
            startedAt: session.startedAt,
            maxAgeMs: NON_READY_STALE_MS,
        });
        if (staleNonReadyReason && !session.restarting) {
            restartStaleSession(session, new Error(staleNonReadyReason)).catch((error: any) => {
                console.warn(`[WhatsApp Web Bridge] Failed to recover non-ready session ${session.sessionId}:`, error?.message || error);
            });
            continue;
        }
        if (!session.ready || session.restarting || !session.client) continue;
        withStaleRecovery(session, async () => {
            if (typeof session.client.getState === "function") {
                await withTimeout(
                    session.client.getState(),
                    OPERATION_TIMEOUT_MS,
                    `WhatsApp watchdog state ${session.sessionId}`
                );
            } else {
                await withTimeout(
                    session.client.getChats(),
                    OPERATION_TIMEOUT_MS,
                    `WhatsApp watchdog chats ${session.sessionId}`
                );
            }
        }).catch((error: any) => {
            if (!isWhatsAppWebBridgeStaleError(error)) {
                session.lastError = error?.message || String(error || "WhatsApp Web watchdog failed.");
                console.warn(`[WhatsApp Web Bridge] Watchdog check failed for ${session.sessionId}:`, session.lastError);
            }
        });
    }
}, WATCHDOG_INTERVAL_MS).unref?.();

setInterval(() => {
    void refreshRuntimeSessionOwnerships();
}, 5_000).unref?.();

async function bootstrapPersistedSessions() {
    const rows = await (db as any).whatsAppWebBridgeSession.findMany({
        where: {
            status: { in: ["ready", "authenticated", "starting", "qr"] },
        },
        select: { sessionId: true, locationId: true },
    }).catch((error: any) => {
        console.error("[WhatsApp Web Bridge] Failed to load persisted sessions:", error?.message || error);
        return [];
    });

    for (const row of rows) {
        startSession(String(row.sessionId), String(row.locationId)).catch((error) => {
            console.error(`[WhatsApp Web Bridge] Failed to bootstrap ${row.sessionId}:`, error?.message || error);
        });
    }
}

void bootstrapPersistedSessions();
