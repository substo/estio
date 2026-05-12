import { createServer, IncomingMessage, ServerResponse } from "http";
import { createRequire } from "module";
import { rm } from "fs/promises";
import path from "path";
import qrcode from "qrcode";
import db from "../lib/db";

const require = createRequire(path.join(process.cwd(), "scripts", "whatsapp-web-bridge-service.ts"));

const PORT = Number(process.env.WHATSAPP_WEB_BRIDGE_PORT || 3218);
const APP_WEBHOOK_URL = String(process.env.WHATSAPP_WEB_BRIDGE_APP_WEBHOOK_URL || "http://127.0.0.1:3000/api/webhooks/whatsapp-web-bridge");
const SECRET = String(process.env.WHATSAPP_WEB_BRIDGE_SECRET || process.env.CRON_SECRET || "").trim();
const SESSION_DIR = String(process.env.WHATSAPP_WEB_BRIDGE_SESSION_DIR || path.join(process.cwd(), ".data", "whatsapp-web-sessions"));

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
};

const sessions = new Map<string, ManagedSession>();
const serviceStartedAt = new Date();
const MAX_INLINE_MEDIA_BYTES = Math.max(Number(process.env.WHATSAPP_WEB_BRIDGE_MAX_INLINE_MEDIA_BYTES || 25 * 1024 * 1024), 1024 * 1024);

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
    const response = await fetch(APP_WEBHOOK_URL, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            ...(SECRET ? { "x-whatsapp-web-bridge-secret": SECRET } : {}),
        },
        body: JSON.stringify(payload),
    });
    if (!response.ok) {
        const text = await response.text().catch(() => "");
        throw new Error(`App webhook failed ${response.status}: ${text}`);
    }
}

function markSessionEvent(session: ManagedSession, status: string, error?: unknown) {
    session.status = status;
    session.lastEventAt = new Date();
    session.lastError = error ? String((error as any)?.message || error) : null;
}

async function emitSessionEvent(session: ManagedSession, payload: Record<string, any>) {
    try {
        await emitEvent(payload);
    } catch (error: any) {
        session.lastError = error?.message || "Failed to emit bridge webhook event.";
        session.lastEventAt = new Date();
        console.error(`[WhatsApp Web Bridge] Failed to emit ${payload.event || "event"} for ${session.sessionId}:`, error?.message || error);
    }
}

function serializeManagedSession(session: ManagedSession) {
    return {
        sessionId: session.sessionId,
        locationId: session.locationId,
        ready: Boolean(session.ready),
        phone: session.phone || null,
        status: session.status || (session.ready ? "ready" : "starting"),
        startedAt: session.startedAt.toISOString(),
        lastEventAt: session.lastEventAt?.toISOString?.() || null,
        lastReadyAt: session.lastReadyAt?.toISOString?.() || null,
        lastError: session.lastError || null,
    };
}

async function serializeMessage(message: any, options?: { includeMedia?: boolean }) {
    const id = message?.id?._serialized || message?.id?.id || message?.id || "";
    const serialized: Record<string, any> = {
        id,
        from: message?.from || "",
        to: message?.to || "",
        fromMe: Boolean(message?.fromMe),
        body: message?.body || "",
        caption: message?._data?.caption || "",
        type: message?.type || "text",
        timestamp: Number(message?.timestamp || Math.floor(Date.now() / 1000)),
        notifyName: message?._data?.notifyName || message?._data?.pushName || "",
        contactName: message?._data?.verifiedName || message?._data?.notifyName || "",
        hasMedia: Boolean(message?.hasMedia),
    };

    if (options?.includeMedia && message?.hasMedia && typeof message.downloadMedia === "function") {
        try {
            const media = await message.downloadMedia();
            const base64 = String(media?.data || "");
            const approxBytes = Math.floor((base64.length * 3) / 4);
            if (media?.data && approxBytes <= MAX_INLINE_MEDIA_BYTES) {
                serialized.media = {
                    mimetype: media.mimetype || message?._data?.mimetype || "",
                    filename: media.filename || message?._data?.filename || message?._data?.title || "",
                    data: base64,
                    size: approxBytes,
                };
            } else if (media?.data) {
                serialized.mediaError = `Media is too large to inline (${approxBytes} bytes).`;
            }
        } catch (error: any) {
            serialized.mediaError = error?.message || "Failed to download media.";
        }
    }

    return serialized;
}

async function getPhone(client: any) {
    const wid = client?.info?.wid?._serialized || client?.info?.wid?.user || "";
    return String(wid).replace(/@(c\.us|s\.whatsapp\.net)$/i, "") || null;
}

async function startSession(sessionId: string, locationId: string) {
    const existing = sessions.get(sessionId);
    if (existing) return existing;

    const { Client, LocalAuth } = require("whatsapp-web.js");
    const client = new Client({
        authStrategy: new LocalAuth({
            clientId: sessionId,
            dataPath: SESSION_DIR,
        }),
        puppeteer: {
            headless: true,
            args: [
                "--no-sandbox",
                "--disable-setuid-sandbox",
                "--disable-dev-shm-usage",
                "--disable-accelerated-2d-canvas",
                "--no-first-run",
                "--no-zygote",
                "--disable-gpu",
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
        managed.ready = true;
        managed.phone = await getPhone(client);
        markSessionEvent(managed, "ready");
        managed.lastReadyAt = new Date();
        console.log(`[WhatsApp Web Bridge] Ready ${sessionId} phone=${managed.phone || "unknown"}`);
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
        await emitSessionEvent(managed, { event: "message", locationId, sessionId, phone: managed.phone, message: await serializeMessage(message, { includeMedia: true }) });
    });

    client.on("message_create", async (message: any) => {
        managed.lastEventAt = new Date();
        await emitSessionEvent(managed, { event: "message_create", locationId, sessionId, phone: managed.phone, message: await serializeMessage(message, { includeMedia: true }) });
    });

    client.on("message_ack", async (message: any, ack: number) => {
        managed.lastEventAt = new Date();
        const messageId = message?.id?._serialized || message?.id?.id || "";
        await emitSessionEvent(managed, { event: "message_ack", locationId, sessionId, messageId, ack });
    });

    await client.initialize();
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

    if (payload.mediaUrl) {
        const { MessageMedia } = require("whatsapp-web.js");
        const media = await MessageMedia.fromUrl(String(payload.mediaUrl), {
            unsafeMime: true,
            filename: payload.fileName || undefined,
        });
        const sent = await session.client.sendMessage(String(payload.to), media, {
            caption: payload.caption || payload.text || undefined,
        });
        return { messageId: sent?.id?._serialized || sent?.id?.id || "" };
    }

    const sent = await session.client.sendMessage(String(payload.to), String(payload.text || ""));
    return { messageId: sent?.id?._serialized || sent?.id?.id || "" };
}

async function listChats(sessionId: string) {
    const session = sessions.get(sessionId);
    if (!session?.client || !session.ready) throw new Error("WhatsApp Web session is not ready.");

    const chats = await session.client.getChats();
    return (chats || []).map((chat: any) => ({
        id: chat?.id?._serialized || chat?.id?.user || "",
        name: chat?.name || chat?.formattedTitle || chat?.id?.user || "",
        isGroup: Boolean(chat?.isGroup),
        unreadCount: Number(chat?.unreadCount || 0),
        timestamp: Number(chat?.timestamp || 0),
        archived: Boolean(chat?.archived),
        pinned: Boolean(chat?.pinned),
    }));
}

async function fetchMessages(sessionId: string, payload: any) {
    const session = sessions.get(sessionId);
    if (!session?.client || !session.ready) throw new Error("WhatsApp Web session is not ready.");

    const chatId = String(payload.chatId || payload.to || "").trim();
    if (!chatId) throw new Error("Missing chat id.");

    const limit = Math.min(Math.max(Number(payload.limit || 30), 1), 100);
    const chat = await session.client.getChatById(chatId);
    const messages = await chat.fetchMessages({ limit });
    return Promise.all((messages || []).map((message: any) => serializeMessage(message, { includeMedia: false })));
}

const server = createServer(async (req, res) => {
    try {
        if (!isAuthorized(req)) return json(res, 401, { error: "Unauthorized" });

        const url = new URL(req.url || "/", `http://${req.headers.host || "127.0.0.1"}`);
        const parts = url.pathname.split("/").filter(Boolean);

        if (req.method === "GET" && url.pathname === "/health") {
            return json(res, 200, {
                ok: true,
                uptimeSeconds: Math.floor((Date.now() - serviceStartedAt.getTime()) / 1000),
                sessionCount: sessions.size,
                sessions: Array.from(sessions.values()).map(serializeManagedSession),
                sessionDir: SESSION_DIR,
                maxInlineMediaBytes: MAX_INLINE_MEDIA_BYTES,
            });
        }

        if (parts[0] === "sessions" && parts[1]) {
            const sessionId = decodeURIComponent(parts[1]);
            if (req.method === "POST" && parts[2] === "start") {
                const body = await readJson(req);
                const locationId = String(body.locationId || "").trim();
                if (!locationId) return json(res, 400, { error: "Missing locationId." });
                await startSession(sessionId, locationId);
                return json(res, 200, { success: true, sessionId });
            }
            if (req.method === "POST" && parts[2] === "stop") {
                await stopSession(sessionId);
                return json(res, 200, { success: true, sessionId });
            }
            if (req.method === "POST" && parts[2] === "clear") {
                await stopSession(sessionId);
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
        }

        return json(res, 404, { error: "Not found." });
    } catch (error: any) {
        console.error("[WhatsApp Web Bridge] Request failed:", error);
        return json(res, 500, { error: error?.message || "Internal Server Error" });
    }
});

server.listen(PORT, () => {
    console.log(`[WhatsApp Web Bridge] Listening on ${PORT}; session dir ${SESSION_DIR}`);
});

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
