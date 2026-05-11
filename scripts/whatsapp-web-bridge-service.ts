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
};

const sessions = new Map<string, ManagedSession>();

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

function serializeMessage(message: any) {
    const id = message?.id?._serialized || message?.id?.id || message?.id || "";
    return {
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

    const managed: ManagedSession = { sessionId, locationId, client, ready: false };
    sessions.set(sessionId, managed);

    client.on("qr", async (qr: string) => {
        const qrCode = await qrcode.toDataURL(qr, { margin: 1, width: 320 });
        await emitEvent({ event: "qr", locationId, sessionId, qrCode });
    });

    client.on("loading_screen", async (percent: number, message: string) => {
        await emitEvent({ event: "loading", locationId, sessionId, metadata: { percent, message } }).catch(console.error);
    });

    client.on("authenticated", async () => {
        await emitEvent({ event: "authenticated", locationId, sessionId }).catch(console.error);
    });

    client.on("auth_failure", async (error: string) => {
        managed.ready = false;
        await emitEvent({ event: "auth_failure", locationId, sessionId, error }).catch(console.error);
    });

    client.on("ready", async () => {
        managed.ready = true;
        managed.phone = await getPhone(client);
        await emitEvent({ event: "ready", locationId, sessionId, phone: managed.phone }).catch(console.error);
    });

    client.on("disconnected", async (reason: string) => {
        managed.ready = false;
        sessions.delete(sessionId);
        await emitEvent({ event: "disconnected", locationId, sessionId, error: reason }).catch(console.error);
    });

    client.on("message", async (message: any) => {
        await emitEvent({ event: "message", locationId, sessionId, phone: managed.phone, message: serializeMessage(message) }).catch(console.error);
    });

    client.on("message_create", async (message: any) => {
        await emitEvent({ event: "message_create", locationId, sessionId, phone: managed.phone, message: serializeMessage(message) }).catch(console.error);
    });

    client.on("message_ack", async (message: any, ack: number) => {
        const messageId = message?.id?._serialized || message?.id?.id || "";
        await emitEvent({ event: "message_ack", locationId, sessionId, messageId, ack }).catch(console.error);
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

const server = createServer(async (req, res) => {
    try {
        if (!isAuthorized(req)) return json(res, 401, { error: "Unauthorized" });

        const url = new URL(req.url || "/", `http://${req.headers.host || "127.0.0.1"}`);
        const parts = url.pathname.split("/").filter(Boolean);

        if (req.method === "GET" && url.pathname === "/health") {
            return json(res, 200, { ok: true, sessions: sessions.size });
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
