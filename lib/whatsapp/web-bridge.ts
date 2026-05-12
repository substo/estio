import db from "@/lib/db";

export const WHATSAPP_WEB_BRIDGE_PROVIDER = "whatsapp_web_bridge";
export const WHATSAPP_WEB_BRIDGE_TRANSPORT = "web_bridge";

export type WhatsAppWebBridgeSessionStatus =
    | "disconnected"
    | "starting"
    | "qr"
    | "authenticated"
    | "ready"
    | "failed";

export type WhatsAppWebBridgeSessionRow = {
    id: string;
    locationId: string;
    sessionId: string;
    phone?: string | null;
    status: WhatsAppWebBridgeSessionStatus | string;
    qrCode?: string | null;
    lastReadyAt?: Date | null;
    lastSeenAt?: Date | null;
    lastError?: string | null;
    isDefaultOutbound: boolean;
    metadata?: any;
};

export type WhatsAppWebBridgeHealthSession = {
    sessionId: string;
    locationId: string;
    ready: boolean;
    phone?: string | null;
    status?: string | null;
    startedAt?: string | null;
    lastEventAt?: string | null;
    lastReadyAt?: string | null;
    lastError?: string | null;
};

export type WhatsAppWebBridgeHealth = {
    reachable: boolean;
    ok: boolean;
    baseUrl: string;
    uptimeSeconds?: number | null;
    sessionCount?: number | null;
    sessions?: WhatsAppWebBridgeHealthSession[];
    sessionDir?: string | null;
    maxInlineMediaBytes?: number | null;
    error?: string | null;
};

const DEFAULT_BRIDGE_BASE_URL = "http://127.0.0.1:3218";

export function getWhatsAppWebBridgeBaseUrl() {
    return String(process.env.WHATSAPP_WEB_BRIDGE_URL || DEFAULT_BRIDGE_BASE_URL).replace(/\/+$/, "");
}

export function getWhatsAppWebBridgeSecret() {
    return String(process.env.WHATSAPP_WEB_BRIDGE_SECRET || process.env.CRON_SECRET || "").trim();
}

export function buildWhatsAppWebBridgeSessionId(locationId: string) {
    const normalized = String(locationId || "").trim();
    if (!normalized) throw new Error("Missing location id for WhatsApp Web bridge session.");
    return `estio_loc_${normalized}`;
}

export function normalizeWhatsAppWebChatId(value: unknown) {
    const raw = String(value || "").trim();
    if (!raw) return "";
    if (raw.includes("@")) return raw;
    const digits = raw.replace(/\D/g, "");
    return digits ? `${digits}@c.us` : "";
}

export function extractPhoneFromWhatsAppWebId(value: unknown) {
    const raw = String(value || "").trim();
    if (!raw) return "";
    // WhatsApp multi-device JIDs look like 15551234567:95@c.us
    // First, strip the domain part
    const withoutDomain = raw.replace(/@(c\.us|s\.whatsapp\.net|lid)$/i, "");
    // Next, split by colon to discard any device ID
    const withoutDevice = withoutDomain.split(":")[0];
    // Finally, keep only the digits
    return withoutDevice.replace(/\D/g, "");
}

function serializeSession(row: any): WhatsAppWebBridgeSessionRow | null {
    if (!row) return null;
    return {
        id: String(row.id),
        locationId: String(row.locationId),
        sessionId: String(row.sessionId),
        phone: row.phone || null,
        status: String(row.status || "disconnected"),
        qrCode: row.qrCode || null,
        lastReadyAt: row.lastReadyAt || null,
        lastSeenAt: row.lastSeenAt || null,
        lastError: row.lastError || null,
        isDefaultOutbound: Boolean(row.isDefaultOutbound),
        metadata: row.metadata || null,
    };
}

export async function getWhatsAppWebBridgeSession(locationId: string) {
    const id = String(locationId || "").trim();
    if (!id) return null;
    const row = await (db as any).whatsAppWebBridgeSession.findUnique({
        where: { locationId: id },
    }).catch(() => null);
    return serializeSession(row);
}

export async function getReadyWhatsAppWebBridgeSession(locationId: string) {
    const session = await getWhatsAppWebBridgeSession(locationId);
    if (!session || session.status !== "ready") return null;
    return session;
}

export async function upsertWhatsAppWebBridgeSession(locationId: string, data?: Partial<WhatsAppWebBridgeSessionRow>) {
    const sessionId = data?.sessionId || buildWhatsAppWebBridgeSessionId(locationId);
    const row = await (db as any).whatsAppWebBridgeSession.upsert({
        where: { locationId },
        create: {
            locationId,
            sessionId,
            status: data?.status || "disconnected",
            phone: data?.phone || null,
            qrCode: data?.qrCode || null,
            lastReadyAt: data?.lastReadyAt || null,
            lastSeenAt: data?.lastSeenAt || null,
            lastError: data?.lastError || null,
            isDefaultOutbound: data?.isDefaultOutbound ?? true,
            metadata: data?.metadata || undefined,
        },
        update: {
            sessionId,
            ...(data?.status ? { status: data.status } : {}),
            ...(data && "phone" in data ? { phone: data.phone || null } : {}),
            ...(data && "qrCode" in data ? { qrCode: data.qrCode || null } : {}),
            ...(data && "lastReadyAt" in data ? { lastReadyAt: data.lastReadyAt || null } : {}),
            ...(data && "lastSeenAt" in data ? { lastSeenAt: data.lastSeenAt || null } : {}),
            ...(data && "lastError" in data ? { lastError: data.lastError || null } : {}),
            ...(data && "isDefaultOutbound" in data ? { isDefaultOutbound: Boolean(data.isDefaultOutbound) } : {}),
            ...(data && "metadata" in data ? { metadata: data.metadata || undefined } : {}),
        },
    });
    return serializeSession(row)!;
}

async function bridgeFetch(path: string, init?: RequestInit) {
    const secret = getWhatsAppWebBridgeSecret();
    const response = await fetch(`${getWhatsAppWebBridgeBaseUrl()}${path}`, {
        ...init,
        headers: {
            "Content-Type": "application/json",
            ...(secret ? { "x-whatsapp-web-bridge-secret": secret } : {}),
            ...(init?.headers || {}),
        },
    });
    const json = await response.json().catch(() => ({}));
    if (!response.ok) {
        throw new Error(String((json as any)?.error || response.statusText || "WhatsApp Web bridge request failed."));
    }
    return json as any;
}

export async function getWhatsAppWebBridgeHealth(): Promise<WhatsAppWebBridgeHealth> {
    const baseUrl = getWhatsAppWebBridgeBaseUrl();
    const secret = getWhatsAppWebBridgeSecret();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5_000);

    try {
        const response = await fetch(`${baseUrl}/health`, {
            method: "GET",
            signal: controller.signal,
            headers: {
                ...(secret ? { "x-whatsapp-web-bridge-secret": secret } : {}),
            },
        });
        const json = await response.json().catch(() => ({}));
        if (!response.ok) {
            return {
                reachable: false,
                ok: false,
                baseUrl,
                error: String((json as any)?.error || response.statusText || `Bridge health returned ${response.status}.`),
            };
        }

        return {
            reachable: true,
            ok: Boolean((json as any)?.ok),
            baseUrl,
            uptimeSeconds: Number.isFinite(Number((json as any)?.uptimeSeconds)) ? Number((json as any).uptimeSeconds) : null,
            sessionCount: Number.isFinite(Number((json as any)?.sessionCount)) ? Number((json as any).sessionCount) : null,
            sessions: Array.isArray((json as any)?.sessions) ? (json as any).sessions : [],
            sessionDir: (json as any)?.sessionDir || null,
            maxInlineMediaBytes: Number.isFinite(Number((json as any)?.maxInlineMediaBytes)) ? Number((json as any).maxInlineMediaBytes) : null,
            error: null,
        };
    } catch (error: any) {
        return {
            reachable: false,
            ok: false,
            baseUrl,
            error: error?.name === "AbortError"
                ? "WhatsApp Web Bridge health check timed out."
                : (error?.message || "WhatsApp Web Bridge is not reachable."),
        };
    } finally {
        clearTimeout(timeout);
    }
}

export async function startWhatsAppWebBridgeSession(locationId: string) {
    const session = await upsertWhatsAppWebBridgeSession(locationId, {
        status: "starting",
        qrCode: null,
        lastError: null,
        isDefaultOutbound: true,
    });
    return bridgeFetch(`/sessions/${encodeURIComponent(session.sessionId)}/start`, {
        method: "POST",
        body: JSON.stringify({ locationId }),
    });
}

export async function stopWhatsAppWebBridgeSession(locationId: string) {
    const session = await getWhatsAppWebBridgeSession(locationId);
    if (!session) return { success: true, skipped: true };
    const result = await bridgeFetch(`/sessions/${encodeURIComponent(session.sessionId)}/stop`, { method: "POST" });
    await upsertWhatsAppWebBridgeSession(locationId, {
        status: "disconnected",
        qrCode: null,
        lastError: null,
        isDefaultOutbound: false,
    });
    return result;
}

export async function restartWhatsAppWebBridgeSession(locationId: string) {
    const session = await getWhatsAppWebBridgeSession(locationId);
    if (session) {
        await bridgeFetch(`/sessions/${encodeURIComponent(session.sessionId)}/stop`, { method: "POST" }).catch(() => null);
    }
    return startWhatsAppWebBridgeSession(locationId);
}

export async function clearWhatsAppWebBridgeSession(locationId: string) {
    const session = await getWhatsAppWebBridgeSession(locationId);
    if (session) {
        await bridgeFetch(`/sessions/${encodeURIComponent(session.sessionId)}/clear`, { method: "POST" }).catch(() => null);
        await (db as any).whatsAppWebBridgeSession.delete({ where: { locationId } }).catch(() => null);
    }
    return { success: true };
}

export async function sendWhatsAppWebBridgeMessage(input: {
    locationId: string;
    to: string;
    text?: string | null;
    mediaUrl?: string | null;
    mimetype?: string | null;
    fileName?: string | null;
    caption?: string | null;
}) {
    const session = await getReadyWhatsAppWebBridgeSession(input.locationId);
    if (!session) {
        throw new Error("WhatsApp Web Bridge is not connected. Scan the QR code and wait until the session is ready.");
    }

    const chatId = normalizeWhatsAppWebChatId(input.to);
    if (!chatId) throw new Error("Missing WhatsApp recipient for Web Bridge send.");

    return bridgeFetch(`/sessions/${encodeURIComponent(session.sessionId)}/send`, {
        method: "POST",
        body: JSON.stringify({
            locationId: input.locationId,
            to: chatId,
            text: input.text || "",
            mediaUrl: input.mediaUrl || null,
            mimetype: input.mimetype || null,
            fileName: input.fileName || null,
            caption: input.caption || null,
        }),
    });
}

export async function fetchWhatsAppWebBridgeChats(locationId: string) {
    const session = await getReadyWhatsAppWebBridgeSession(locationId);
    if (!session) {
        throw new Error("WhatsApp Web Bridge is not connected. Scan the QR code and wait until the session is ready.");
    }

    return bridgeFetch(`/sessions/${encodeURIComponent(session.sessionId)}/chats`, {
        method: "GET",
    });
}

export async function fetchWhatsAppWebBridgeMessages(input: {
    locationId: string;
    chatId: string;
    limit?: number;
}) {
    const session = await getReadyWhatsAppWebBridgeSession(input.locationId);
    if (!session) {
        throw new Error("WhatsApp Web Bridge is not connected. Scan the QR code and wait until the session is ready.");
    }

    return bridgeFetch(`/sessions/${encodeURIComponent(session.sessionId)}/messages`, {
        method: "POST",
        body: JSON.stringify({
            chatId: input.chatId,
            limit: input.limit || 30,
        }),
    });
}
