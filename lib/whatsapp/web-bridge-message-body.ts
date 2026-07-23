const MEDIA_MESSAGE_TYPES = new Set([
    "audio",
    "document",
    "image",
    "ptt",
    "sticker",
    "video",
]);

const MEDIA_BODY_PLACEHOLDERS: Record<string, string> = {
    audio: "[Audio]",
    document: "[Document]",
    image: "[Image]",
    ptt: "[Audio]",
    sticker: "[Sticker]",
    video: "[Video]",
};

function compactBase64(value: string) {
    return value.replace(/\s+/g, "");
}

function inferMediaBodyContentType(body: string, declaredType: string) {
    const dataUrlMatch = body.match(/^data:([^;,]+);base64,/i);
    if (dataUrlMatch?.[1]) return dataUrlMatch[1].toLowerCase();
    const compact = compactBase64(body);
    if (/^\/9j\//.test(compact)) return "image/jpeg";
    if (/^iVBOR/.test(compact)) return "image/png";
    if (/^UklGR/.test(compact)) return "image/webp";
    if (/^R0lGOD/.test(compact)) return "image/gif";
    if (/^JVBER/.test(compact)) return "application/pdf";
    if (/^T2dnUw/.test(compact)) return "audio/ogg";
    if (declaredType === "image") return "image/jpeg";
    return "";
}

export function isOpaqueWhatsAppWebBridgeMediaBody(args: {
    body?: unknown;
    type?: unknown;
    hasMedia?: unknown;
}) {
    const body = String(args.body || "").trim();
    const type = String(args.type || "").trim().toLowerCase();
    if (body.length < 128 || (!args.hasMedia && !MEDIA_MESSAGE_TYPES.has(type))) return false;

    if (/^data:(?:image|audio|video|application)\/[^;,]+;base64,/i.test(body)) return true;

    const compact = compactBase64(body);
    if (
        /^\/9j\//.test(compact)
        || /^iVBOR/.test(compact)
        || /^UklGR/.test(compact)
        || /^R0lGOD/.test(compact)
        || /^JVBER/.test(compact)
        || /^T2dnUw/.test(compact)
    ) {
        return true;
    }

    return compact.length >= 2048
        && compact.length % 4 === 0
        && /^[A-Za-z0-9+/]+={0,2}$/.test(compact);
}

export function getSafeWhatsAppWebBridgeMessageBody(message: any) {
    const type = String(message?.type || "text").trim().toLowerCase();
    const body = String(message?.body || "").trim();
    const caption = String(message?.caption || message?._data?.caption || "").trim();
    const hasMedia = Boolean(message?.hasMedia || MEDIA_MESSAGE_TYPES.has(type));

    if (body && !isOpaqueWhatsAppWebBridgeMediaBody({ body, type, hasMedia })) return body;
    if (caption && !isOpaqueWhatsAppWebBridgeMediaBody({ body: caption, type, hasMedia })) return caption;
    if (hasMedia) return MEDIA_BODY_PLACEHOLDERS[type] || "[Media]";
    return "";
}

export function extractOpaqueWhatsAppWebBridgeMediaBody(args: {
    body?: unknown;
    type?: unknown;
    hasMedia?: unknown;
    mimetype?: unknown;
    maxBytes: number;
}) {
    const body = String(args.body || "").trim();
    const type = String(args.type || "").trim().toLowerCase();
    if (!isOpaqueWhatsAppWebBridgeMediaBody({ body, type, hasMedia: args.hasMedia })) return null;

    const comma = body.indexOf(",");
    const data = compactBase64(body.startsWith("data:") && comma >= 0 ? body.slice(comma + 1) : body);
    if (!data || !/^[A-Za-z0-9+/]+={0,2}$/.test(data)) return null;
    const size = Math.floor((data.replace(/=+$/, "").length * 3) / 4);
    if (size <= 0 || size > Math.max(0, Number(args.maxBytes || 0))) return null;

    const mimetype = String(args.mimetype || "").trim().toLowerCase()
        || inferMediaBodyContentType(body, type);
    if (!mimetype) return null;
    return { data, mimetype, size };
}
