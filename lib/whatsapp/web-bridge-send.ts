import { isIP } from "node:net";

export function requireWhatsAppWebBridgeSentMessageId(sent: unknown) {
    if (!sent || typeof sent !== "object") {
        throw new Error("WHATSAPP_SEND_RESULT_MISSING_ID");
    }
    const id = (sent as { id?: { _serialized?: unknown; id?: unknown } }).id;
    const messageId = String(id?._serialized || id?.id || "").trim();
    if (!messageId) throw new Error("WHATSAPP_SEND_RESULT_MISSING_ID");
    return messageId;
}

export const WHATSAPP_WEB_BRIDGE_TEXT_SEND_REQUEST_TIMEOUT_MS = 35_000;
export const WHATSAPP_WEB_BRIDGE_MEDIA_SEND_REQUEST_TIMEOUT_MS = 75_000;
export const WHATSAPP_WEB_BRIDGE_LINK_PREVIEW_TIMEOUT_MS = 2_500;

export function getWhatsAppWebBridgeSendRequestTimeoutMs(input: { hasMedia: boolean }) {
    return input.hasMedia
        ? WHATSAPP_WEB_BRIDGE_MEDIA_SEND_REQUEST_TIMEOUT_MS
        : WHATSAPP_WEB_BRIDGE_TEXT_SEND_REQUEST_TIMEOUT_MS;
}

const MAX_LINK_PREVIEW_URL_LENGTH = 2_048;
const MAX_LINK_PREVIEW_TITLE_LENGTH = 512;
const MAX_LINK_PREVIEW_DESCRIPTION_LENGTH = 2_048;
const MAX_LINK_PREVIEW_THUMBNAIL_LENGTH = 2 * 1024 * 1024;
const PRIVATE_HOST_SUFFIXES = [
    ".internal",
    ".invalid",
    ".lan",
    ".local",
    ".localhost",
    ".test",
];

export function isWhatsAppWebBridgeLinkPreviewUrlEligible(value: unknown) {
    const raw = String(value || "").trim();
    if (!raw || raw.length > MAX_LINK_PREVIEW_URL_LENGTH) return false;
    try {
        const url = new URL(raw);
        const hostname = url.hostname.toLowerCase().replace(/\.$/, "");
        if (
            !["http:", "https:"].includes(url.protocol)
            || url.username
            || url.password
            || !hostname
            || isIP(hostname) !== 0
            || hostname === "localhost"
            || !hostname.includes(".")
            || PRIVATE_HOST_SUFFIXES.some((suffix) => hostname.endsWith(suffix))
        ) {
            return false;
        }
        if (url.port && !(
            (url.protocol === "http:" && url.port === "80")
            || (url.protocol === "https:" && url.port === "443")
        )) {
            return false;
        }
        return true;
    } catch {
        return false;
    }
}

function boundedPreviewString(value: unknown, maximumLength: number) {
    if (typeof value !== "string") return null;
    const normalized = value.trim();
    if (!normalized || normalized.length > maximumLength) return null;
    return normalized;
}

export function sanitizeWhatsAppWebBridgeLinkPreview(
    value: unknown,
    requestedUrl: string,
): Record<string, unknown> | null {
    if (!isWhatsAppWebBridgeLinkPreviewUrlEligible(requestedUrl)) return null;
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const envelope = value as Record<string, unknown>;
    const candidate = (
        envelope.data
        && typeof envelope.data === "object"
        && !Array.isArray(envelope.data)
    )
        ? envelope.data as Record<string, unknown>
        : envelope;

    const title = boundedPreviewString(candidate.title, MAX_LINK_PREVIEW_TITLE_LENGTH);
    const description = boundedPreviewString(candidate.description, MAX_LINK_PREVIEW_DESCRIPTION_LENGTH);
    const thumbnail = boundedPreviewString(candidate.thumbnail, MAX_LINK_PREVIEW_THUMBNAIL_LENGTH);
    const hqThumbnail = boundedPreviewString(
        candidate.hqThumbnail ?? candidate.thumbnailHQ,
        MAX_LINK_PREVIEW_THUMBNAIL_LENGTH,
    );
    const jpegThumbnail = boundedPreviewString(candidate.jpegThumbnail, MAX_LINK_PREVIEW_THUMBNAIL_LENGTH);
    if (!title && !description && !thumbnail && !hqThumbnail && !jpegThumbnail) return null;

    return {
        canonicalUrl: requestedUrl,
        matchedText: requestedUrl,
        ...(title ? { title } : {}),
        ...(description ? { description } : {}),
        ...(thumbnail ? { thumbnail } : {}),
        ...(hqThumbnail ? { hqThumbnail } : {}),
        ...(jpegThumbnail ? { jpegThumbnail } : {}),
        preview: true,
        subtype: "url",
    };
}

export function getWhatsAppWebBridgeLinkPreviewPolicy(input: {
    requested: boolean;
    previewReady?: boolean;
}) {
    const injected = input.requested && input.previewReady === true;
    return {
        requested: input.requested,
        enabled: false,
        injected,
        suppressed: input.requested && !injected,
    } as const;
}

export function getWhatsAppWebBridgeDispatchConfirmationPolicy() {
    // whatsapp-web.js has already created and queued the browser message when
    // sendMessage returns without waiting for sendMsgResultPromise. Treat the
    // returned provider id as dispatch acceptance and let message_ack provide
    // the authoritative sent/delivered/read transition. This avoids holding an
    // app request open when the Android tunnel is slow or briefly reconnecting.
    return { waitUntilMsgSent: false } as const;
}

export function buildWhatsAppWebBridgeTextSendOptions(
    previewExtra: Record<string, unknown> | null,
) {
    return {
        // Keep whatsapp-web.js's unbounded lookup disabled. A preview resolved
        // under Estio's separate deadline is injected through `extra`.
        linkPreview: false,
        ...(previewExtra ? { extra: previewExtra } : {}),
        ...getWhatsAppWebBridgeDispatchConfirmationPolicy(),
    };
}

export class WhatsAppWebBridgeDeliveryUnconfirmedError extends Error {
    readonly code = "WHATSAPP_WEB_BRIDGE_DELIVERY_UNCONFIRMED";

    constructor() {
        super("WhatsApp Web send outcome is unknown; not retrying automatically to avoid duplicate delivery.");
        this.name = "WhatsAppWebBridgeDeliveryUnconfirmedError";
    }
}

export function isWhatsAppWebBridgeDeliveryUnconfirmedError(error: unknown) {
    return error instanceof WhatsAppWebBridgeDeliveryUnconfirmedError
        || String((error as any)?.code || "") === "WHATSAPP_WEB_BRIDGE_DELIVERY_UNCONFIRMED";
}
