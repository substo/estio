import http from "node:http";
import { randomUUID } from "node:crypto";

type BridgeSession = {
    sessionId: string;
    status: "offline" | "pairing" | "ready" | "unhealthy";
    startedAt: string | null;
    lastHeartbeatAt: string | null;
    pairingCode: string | null;
    qr: string | null;
    mediaStatus: "signaling_only" | "media_probe_started" | "audio_connected" | "failed";
    calls: Map<string, BridgeCall>;
    error?: string | null;
    socket?: any;
    capabilities: {
        offerCall: boolean;
    };
};

type BridgeCall = {
    callId: string;
    whatsappCallId?: string | null;
    attemptId?: string | null;
    locationId?: string | null;
    to: string;
    conversationId?: string | null;
    contactId?: string | null;
    status: string;
    event: string;
    mediaStatus: BridgeSession["mediaStatus"];
    createdAt: string;
    updatedAt: string;
    raw?: any;
    error?: string | null;
};

const PORT = Number(process.env.WHATSAPP_CALL_BRIDGE_PORT || 3037);
const SECRET = String(process.env.WHATSAPP_CALL_BRIDGE_SECRET || "");
const APP_WEBHOOK_URL = String(process.env.WHATSAPP_CALL_BRIDGE_APP_WEBHOOK_URL || "").trim();
const SIMULATE = process.env.WHATSAPP_CALL_BRIDGE_SIMULATE === "1";
const AUTH_ROOT = String(process.env.WHATSAPP_CALL_BRIDGE_AUTH_DIR || ".data/whatsapp-call-bridge").trim();
const sessions = new Map<string, BridgeSession>();

function json(res: http.ServerResponse, status: number, body: any) {
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(body));
}

function isAuthorized(req: http.IncomingMessage) {
    if (!SECRET) return true;
    return req.headers["x-whatsapp-call-bridge-secret"] === SECRET;
}

async function readJson(req: http.IncomingMessage) {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const text = Buffer.concat(chunks).toString("utf8");
    if (!text.trim()) return {};
    return JSON.parse(text);
}

async function emitEvent(event: Record<string, any>) {
    if (!APP_WEBHOOK_URL) return;
    try {
        await fetch(APP_WEBHOOK_URL, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                ...(SECRET ? { "x-whatsapp-call-bridge-secret": SECRET } : {}),
            },
            body: JSON.stringify(event),
        });
    } catch (error: any) {
        console.warn("[WhatsApp Call Bridge] Failed to emit callback:", error?.message || error);
    }
}

function getSession(sessionId: string): BridgeSession {
    const existing = sessions.get(sessionId);
    if (existing) return existing;
    const session: BridgeSession = {
        sessionId,
        status: "offline",
        startedAt: null,
        lastHeartbeatAt: null,
        pairingCode: null,
        qr: null,
        mediaStatus: "signaling_only",
        calls: new Map(),
        error: null,
        capabilities: {
            offerCall: false,
        },
    };
    sessions.set(sessionId, session);
    return session;
}

async function loadBaileysRuntime(): Promise<any | null> {
    const packageName = process.env.WHATSAPP_CALL_BRIDGE_BAILEYS_PACKAGE || "@vreden/meta";
    try {
        return await import(packageName);
    } catch {
        return null;
    }
}

function sanitizeSessionId(sessionId: string) {
    return String(sessionId || "default").replace(/[^a-zA-Z0-9_.-]+/g, "_");
}

function getSocketFactory(baileys: any) {
    return baileys?.makeWASocket || baileys?.default || baileys?.makeSocket || null;
}

function extractWhatsAppCallId(value: any): string | null {
    const candidates = [
        value?.whatsappCallId,
        value?.whatsapp_call_id,
        value?.callId,
        value?.call_id,
        value?.id,
        value?.attrs?.id,
        value?.node?.attrs?.id,
    ];
    for (const candidate of candidates) {
        const normalized = String(candidate || "").trim();
        if (normalized) return normalized;
    }
    return null;
}

function mapBaileysCallEvent(value: any) {
    const rawStatus = String(value?.status || value?.event || value?.tag || value?.type || "").toLowerCase();
    if (rawStatus.includes("ring")) return "call_ringing";
    if (rawStatus.includes("accept")) return "call_accepted";
    if (rawStatus.includes("reject") || rawStatus.includes("decline")) return "call_rejected";
    if (rawStatus.includes("timeout")) return "call_timeout";
    if (rawStatus.includes("terminate") || rawStatus.includes("end") || rawStatus.includes("close")) return "call_terminated";
    if (rawStatus.includes("media") && rawStatus.includes("connect")) return "call_media_connected";
    return rawStatus ? `call_${rawStatus.replace(/[^a-z0-9]+/g, "_")}` : "call_media_unknown";
}

function findCallByWhatsAppCallId(session: BridgeSession, whatsappCallId: string | null) {
    if (!whatsappCallId) return null;
    for (const call of session.calls.values()) {
        if (call.whatsappCallId === whatsappCallId || call.raw?.callId === whatsappCallId || call.raw?.id === whatsappCallId) {
            return call;
        }
    }
    const activeCalls = Array.from(session.calls.values()).filter((call) => (
        call.status === "call_attempted" || call.status === "accepted"
    ));
    return activeCalls.length === 1 ? activeCalls[0] : null;
}

function bindBaileysEvents(session: BridgeSession, socket: any, saveCreds?: () => Promise<void>) {
    if (!socket?.ev?.on) return;

    if (saveCreds) {
        socket.ev.on("creds.update", () => {
            void saveCreds().catch((error: any) => {
                console.warn("[WhatsApp Call Bridge] Failed to persist Baileys creds:", error?.message || error);
            });
        });
    }

    socket.ev.on("connection.update", (update: any) => {
        session.lastHeartbeatAt = new Date().toISOString();
        if (update?.qr) {
            session.qr = String(update.qr);
            session.status = "pairing";
        }
        if (update?.connection === "open") {
            session.status = "ready";
            session.qr = null;
            session.error = null;
        }
        if (update?.connection === "close") {
            session.status = "unhealthy";
            session.error = update?.lastDisconnect?.error?.message || "Baileys connection closed.";
        }
    });

    socket.ev.on("call", (events: any) => {
        const list = Array.isArray(events) ? events : [events];
        for (const event of list) {
            const whatsappCallId = extractWhatsAppCallId(event);
            const call = findCallByWhatsAppCallId(session, whatsappCallId);
            if (!call) continue;

            const mappedEvent = mapBaileysCallEvent(event);
            call.event = mappedEvent;
            call.updatedAt = new Date().toISOString();
            call.whatsappCallId = whatsappCallId || call.whatsappCallId || null;
            call.raw = { ...(call.raw || {}), lastBaileysEvent: event };
            if (mappedEvent === "call_accepted") call.status = "accepted";
            else if (mappedEvent === "call_rejected") call.status = "rejected";
            else if (mappedEvent === "call_terminated") call.status = "ended";
            else if (mappedEvent === "call_timeout" || mappedEvent === "call_failed") call.status = "failed";

            void emitEvent({
                success: mappedEvent !== "call_failed",
                event: mappedEvent,
                callId: call.callId,
                bridgeCallId: call.callId,
                whatsappCallId: call.whatsappCallId,
                attemptId: call.attemptId,
                locationId: call.locationId,
                conversationId: call.conversationId,
                contactId: call.contactId,
                status: call.status,
                mediaStatus: call.mediaStatus,
                raw: event,
            });
        }
    });
}

async function createBaileysSocket(session: BridgeSession, baileys: any, body: any) {
    if (typeof baileys?.useMultiFileAuthState !== "function") {
        return {
            success: false,
            errorCode: "baileys_auth_state_unavailable",
            error: "Selected Baileys package does not expose useMultiFileAuthState().",
        };
    }

    const socketFactory = getSocketFactory(baileys);
    if (typeof socketFactory !== "function") {
        return {
            success: false,
            errorCode: "baileys_socket_factory_missing",
            error: "Selected Baileys package does not expose makeWASocket/default socket factory.",
        };
    }

    const authPath = `${AUTH_ROOT}/${sanitizeSessionId(session.sessionId)}`;
    const { state, saveCreds } = await baileys.useMultiFileAuthState(authPath);
    const version = typeof baileys.fetchLatestBaileysVersion === "function"
        ? (await baileys.fetchLatestBaileysVersion().catch(() => null))?.version
        : undefined;

    const socket = socketFactory({
        auth: state,
        version,
        printQRInTerminal: false,
        browser: ["Estio", "Chrome", "1.0.0"],
    });
    session.socket = socket;
    session.capabilities.offerCall = typeof socket.offerCall === "function";
    bindBaileysEvents(session, socket, saveCreds);

    const phoneNumber = String(body?.phoneNumber || process.env.WHATSAPP_CALL_BRIDGE_PAIRING_PHONE || "").replace(/\D/g, "");
    if (phoneNumber && typeof socket.requestPairingCode === "function") {
        session.pairingCode = await socket.requestPairingCode(phoneNumber).catch(() => null);
    }

    return {
        success: true,
        status: session.status,
        sessionId: session.sessionId,
        pairingCode: session.pairingCode,
        qr: session.qr,
        authPath,
        capabilities: session.capabilities,
    };
}

async function startSession(session: BridgeSession, body: any = {}) {
    session.status = "pairing";
    session.startedAt = new Date().toISOString();
    session.lastHeartbeatAt = new Date().toISOString();
    session.error = null;

    if (SIMULATE) {
        session.status = "ready";
        return {
            success: true,
            status: session.status,
            sessionId: session.sessionId,
            simulated: true,
            message: "Simulated Baileys call bridge session is ready. No real WhatsApp signaling is active.",
        };
    }

    const baileys = await loadBaileysRuntime();
    if (!baileys) {
        session.status = "unhealthy";
        session.error = "Baileys package is not installed. Install a NOWEB/Baileys fork with call signaling support to use offerCall().";
        return {
            success: false,
            status: session.status,
            sessionId: session.sessionId,
            errorCode: "baileys_package_missing",
            error: session.error,
        };
    }

    const socketResult = await createBaileysSocket(session, baileys, body);
    if (!socketResult.success) {
        session.status = "unhealthy";
        session.error = socketResult.error;
        return {
            success: false,
            status: session.status,
            sessionId: session.sessionId,
            ...socketResult,
            availableExports: Object.keys(baileys).slice(0, 20),
        };
    }

    return socketResult;
}

async function offerCall(session: BridgeSession, body: any) {
    const now = new Date().toISOString();
    const callId = String(body?.callId || randomUUID());
    const to = String(body?.to || "").replace(/\D/g, "");
    if (!to) {
        return {
            success: false,
            event: "call_failed",
            errorCode: "missing_recipient",
            errorMessage: "Recipient phone is required.",
        };
    }

    if (session.status !== "ready") {
        return {
            success: false,
            event: "call_failed",
            callId,
            errorCode: "bridge_not_ready",
            errorMessage: "Baileys call bridge session is not ready.",
        };
    }

    const call: BridgeCall = {
        callId,
        attemptId: body?.attemptId ? String(body.attemptId) : null,
        locationId: body?.locationId ? String(body.locationId) : null,
        to,
        conversationId: body?.conversationId ? String(body.conversationId) : null,
        contactId: body?.contactId ? String(body.contactId) : null,
        status: "call_attempted",
        event: "call_offer_sent",
        mediaStatus: session.mediaStatus,
        createdAt: now,
        updatedAt: now,
    };

    if (SIMULATE) {
        session.calls.set(callId, call);
        const response = {
            success: true,
            event: "call_offer_sent",
            callId,
            bridgeCallId: callId,
            whatsappCallId: null,
            attemptId: call.attemptId,
            locationId: call.locationId,
            conversationId: call.conversationId,
            contactId: call.contactId,
            status: call.status,
            mediaStatus: call.mediaStatus,
            simulated: true,
            warning: "Simulated signaling only. Customer phone will not ring.",
        };
        void emitEvent(response);
        return response;
    }

    const socket = session.socket;
    if (!socket || typeof socket.offerCall !== "function") {
        call.status = "failed";
        call.event = "call_failed";
        call.error = "Baileys socket with offerCall() is not available.";
        session.calls.set(callId, call);
        const response = {
            success: false,
            event: "call_failed",
            callId,
            bridgeCallId: callId,
            whatsappCallId: null,
            attemptId: call.attemptId,
            locationId: call.locationId,
            conversationId: call.conversationId,
            contactId: call.contactId,
            status: call.status,
            mediaStatus: call.mediaStatus,
            errorCode: "offer_call_unavailable",
            errorMessage: call.error,
        };
        void emitEvent(response);
        return response;
    }

    try {
        const result = await socket.offerCall(`${to}@s.whatsapp.net`, false);
        const whatsappCallId = extractWhatsAppCallId(result);
        call.whatsappCallId = whatsappCallId;
        call.raw = result;
        session.calls.set(callId, call);
        const response = {
            success: true,
            event: "call_offer_sent",
            callId,
            bridgeCallId: callId,
            whatsappCallId,
            attemptId: call.attemptId,
            locationId: call.locationId,
            conversationId: call.conversationId,
            contactId: call.contactId,
            status: call.status,
            mediaStatus: call.mediaStatus,
            raw: result,
        };
        void emitEvent(response);
        return response;
    } catch (error: any) {
        call.status = "failed";
        call.event = "call_failed";
        call.error = error?.message || "offerCall failed.";
        session.calls.set(callId, call);
        const response = {
            success: false,
            event: "call_failed",
            callId,
            bridgeCallId: callId,
            whatsappCallId: call.whatsappCallId || null,
            attemptId: call.attemptId,
            locationId: call.locationId,
            conversationId: call.conversationId,
            contactId: call.contactId,
            status: call.status,
            mediaStatus: call.mediaStatus,
            errorCode: "offer_call_failed",
            errorMessage: call.error,
        };
        void emitEvent(response);
        return response;
    }
}

async function handle(req: http.IncomingMessage, res: http.ServerResponse) {
    if (!isAuthorized(req)) return json(res, 401, { error: "Unauthorized" });
    const method = String(req.method || "GET").toUpperCase();
    const url = new URL(req.url || "/", `http://${req.headers.host || "127.0.0.1"}`);
    const parts = url.pathname.split("/").filter(Boolean);

    try {
        if (method === "GET" && url.pathname === "/health") {
            const firstReady = Array.from(sessions.values()).find((session) => session.status === "ready");
            const firstSession = firstReady || Array.from(sessions.values())[0] || null;
            return json(res, 200, {
                ok: Boolean(firstReady) || SIMULATE,
                status: firstSession?.status || (SIMULATE ? "ready" : "offline"),
                sessionId: firstSession?.sessionId || null,
                mediaStatus: firstSession?.mediaStatus || "signaling_only",
                sessionCount: sessions.size,
                simulated: SIMULATE,
                simulation: SIMULATE ? "signaling_only_no_customer_ring" : null,
                pairingCode: firstSession?.pairingCode || null,
                qr: firstSession?.qr || null,
                lastHeartbeatAt: firstSession?.lastHeartbeatAt || null,
                capabilities: firstSession?.capabilities || { offerCall: false },
            });
        }

        if (parts[0] !== "sessions" || !parts[1]) {
            return json(res, 404, { error: "Not found" });
        }

        const sessionId = decodeURIComponent(parts[1]);
        const session = getSession(sessionId);

        if (method === "POST" && parts[2] === "start") {
            return json(res, 200, await startSession(session, await readJson(req)));
        }

        if (method === "POST" && parts[2] === "offer-call") {
            return json(res, 200, await offerCall(session, await readJson(req)));
        }

        if (method === "POST" && parts[2] === "reject-call") {
            const body = await readJson(req);
            const callId = String(body?.callId || "");
            const call = callId ? session.calls.get(callId) : null;
            if (call) {
                call.status = "rejected";
                call.event = "call_rejected";
                call.updatedAt = new Date().toISOString();
            }
            const response = {
                success: Boolean(call),
                event: call ? "call_rejected" : "call_failed",
                callId,
                attemptId: call?.attemptId || null,
                locationId: call?.locationId || null,
                conversationId: call?.conversationId || null,
                contactId: call?.contactId || null,
                errorCode: call ? null : "call_not_found",
            };
            void emitEvent(response);
            return json(res, 200, response);
        }

        if (method === "GET" && parts[2] === "calls" && parts[3]) {
            const callId = decodeURIComponent(parts[3]);
            const call = session.calls.get(callId);
            if (!call) return json(res, 404, { success: false, error: "Call not found" });
            return json(res, 200, { success: true, ...call });
        }

        return json(res, 404, { error: "Not found" });
    } catch (error: any) {
        return json(res, 500, {
            success: false,
            event: "call_failed",
            errorCode: "bridge_exception",
            errorMessage: error?.message || "Bridge exception.",
        });
    }
}

http.createServer((req, res) => {
    void handle(req, res);
}).listen(PORT, "127.0.0.1", () => {
    console.log(`[WhatsApp Call Bridge] Listening on http://127.0.0.1:${PORT}`);
    console.log(`[WhatsApp Call Bridge] Mode: ${SIMULATE ? "simulated signaling" : "Baileys R&D stub"}`);
});
