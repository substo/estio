export const WHATSAPP_WEB_BRIDGE_CHAT_LIST_TIMEOUT_MS = 35_000;
export const WHATSAPP_WEB_BRIDGE_HISTORY_TIMEOUT_MS = 35_000;

function parseDirectChatIdentity(value: unknown) {
    const raw = String(value || "").trim();
    if (/@lid$/i.test(raw)) return { kind: "lid" as const, phone: "" };
    if (!/@(c\.us|s\.whatsapp\.net)$/i.test(raw)) return { kind: "other" as const, phone: "" };
    const phone = raw.replace(/@(c\.us|s\.whatsapp\.net)$/i, "").split(":")[0].replace(/\D/g, "");
    return phone.length >= 7 ? { kind: "phone" as const, phone } : { kind: "other" as const, phone: "" };
}

function normalizePhoneChat(value: unknown) {
    const digits = String(value || "").replace(/\D/g, "");
    return digits.length >= 7 ? `${digits}@c.us` : "";
}

export function buildLightweightWhatsAppWebBridgeChat(raw: any) {
    const chatId = String(raw?.id?._serialized || raw?.id || "").trim();
    const parsed = parseDirectChatIdentity(chatId);
    const displayName = String(raw?.name || raw?.formattedTitle || "").trim();
    const phoneJid = parsed.kind === "phone" ? chatId : null;
    const lidJid = parsed.kind === "lid" ? chatId : null;

    return {
        id: chatId,
        name: displayName || parsed.phone,
        isGroup: Boolean(raw?.isGroup),
        unreadCount: Number(raw?.unreadCount || 0),
        timestamp: Number(raw?.timestamp || 0),
        archived: Boolean(raw?.archived),
        pinned: Boolean(raw?.pinned),
        contactIdentity: {
            rawChatId: chatId,
            remoteJid: chatId,
            lidJid,
            phoneJid,
            number: parsed.phone || null,
            phone: parsed.phone || null,
            displayName: displayName || null,
            source: "lightweight_chat_inventory",
        },
    };
}

export function buildWhatsAppWebBridgeHistoryChatCandidates(input: {
    providerConversationId?: unknown;
    contactLid?: unknown;
    contactPhone?: unknown;
    resolvedChatId?: unknown;
}) {
    const candidates = [
        input.providerConversationId,
        input.contactLid,
        input.resolvedChatId,
        normalizePhoneChat(input.contactPhone),
    ];
    return Array.from(new Set(candidates.map((value) => String(value || "").trim()).filter(Boolean)));
}
