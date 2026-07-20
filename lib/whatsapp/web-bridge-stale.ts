const STALE_BROWSER_ERROR_PATTERNS = [
    "attempted to use detached frame",
    "execution context was destroyed",
    "target closed",
    "session closed",
    "protocol error",
    "browser has disconnected",
    "navigation failed because browser has disconnected",
    "page closed",
    "device tunnel gateway generation changed",
];

const RECOVERABLE_MEDIA_ERROR_PATTERNS = [
    "getalternateuserwid",
    "invalid get call using devicewid",
    "whatsapp web bridge is not connected",
    "scan the qr code and wait until the session is ready",
    "whatsapp web session is not ready",
];

export function isWhatsAppWebBridgeStaleError(error: unknown) {
    const message = String((error as any)?.message || error || "").trim().toLowerCase();
    return message === "r" || STALE_BROWSER_ERROR_PATTERNS.some((pattern) => message.includes(pattern));
}

export function isWhatsAppWebBridgeOpaqueRuntimeError(error: unknown) {
    return String((error as any)?.message || error || "").trim().toLowerCase() === "r";
}

export function classifyWhatsAppWebBridgeRequestError(error: unknown) {
    const message = String((error as any)?.message || error || "").trim().toLowerCase();
    if (!message) return null;
    if (message === "r") return "WHATSAPP_OPAQUE_RUNTIME";
    if (message.includes("session is not ready") || message.includes("bridge is not connected")) {
        return "WHATSAPP_SESSION_NOT_READY";
    }
    if (message.includes("chat not found") || message.includes("missing chat id")) {
        return "WHATSAPP_CHAT_NOT_FOUND";
    }
    if (message.includes("timed out") || message.includes("timeout")) {
        return "WHATSAPP_OPERATION_TIMEOUT";
    }
    if (STALE_BROWSER_ERROR_PATTERNS.some((pattern) => message.includes(pattern))) {
        return "WHATSAPP_BROWSER_CONTEXT_LOST";
    }
    return null;
}

export function isWhatsAppWebBridgeRecoverableMediaError(error: unknown) {
    const message = String((error as any)?.message || error || "").trim();
    const normalized = message.toLowerCase();
    return message === "r"
        || RECOVERABLE_MEDIA_ERROR_PATTERNS.some((pattern) => normalized.includes(pattern))
        || isWhatsAppWebBridgeStaleError(error);
}

export function shouldRestartWhatsAppWebBridgeSession(
    error: unknown,
    options?: { isolateMediaFetch?: boolean },
) {
    if (options?.isolateMediaFetch) return false;
    return isWhatsAppWebBridgeStaleError(error);
}
