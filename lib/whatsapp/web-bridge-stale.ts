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
