export type WhatsAppWebBridgeUnhandledRejectionDisposition =
    | { action: "recover"; code: "WA_WEB_POST_NAVIGATION_INJECT_TIMEOUT" }
    | { action: "exit"; code: "UNHANDLED_REJECTION" };

function readErrorField(reason: unknown, field: "name" | "message" | "stack") {
    if (!reason || typeof reason !== "object") return "";
    const value = (reason as Record<string, unknown>)[field];
    return typeof value === "string" ? value : "";
}

/**
 * whatsapp-web.js uses an async Puppeteer `framenavigated` listener which does
 * not attach a rejection handler. A navigation after the client is already
 * ready can therefore turn a transient reinjection timeout into a process-wide
 * unhandled rejection. Only that exact, post-ready upstream failure is safe to
 * absorb; readiness probes remain responsible for fencing an unhealthy page.
 */
export function classifyWhatsAppWebBridgeUnhandledRejection(
    reason: unknown,
    hasReadySession: boolean,
): WhatsAppWebBridgeUnhandledRejectionDisposition {
    const name = readErrorField(reason, "name");
    const message = readErrorField(reason, "message");
    const stack = readErrorField(reason, "stack");
    const isPostNavigationInjectionTimeout = hasReadySession
        && name === "ProtocolError"
        && /^Runtime\.callFunctionOn timed out\b/.test(message)
        && stack.includes("whatsapp-web.js")
        && stack.includes("Client.inject");

    return isPostNavigationInjectionTimeout
        ? { action: "recover", code: "WA_WEB_POST_NAVIGATION_INJECT_TIMEOUT" }
        : { action: "exit", code: "UNHANDLED_REJECTION" };
}
