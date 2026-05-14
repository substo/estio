const STALE_BROWSER_ERROR_PATTERNS = [
    "attempted to use detached frame",
    "execution context was destroyed",
    "target closed",
    "session closed",
    "protocol error",
    "browser has disconnected",
    "navigation failed because browser has disconnected",
    "page closed",
];

export function isWhatsAppWebBridgeStaleError(error: unknown) {
    const message = String((error as any)?.message || error || "").toLowerCase();
    return STALE_BROWSER_ERROR_PATTERNS.some((pattern) => message.includes(pattern));
}
