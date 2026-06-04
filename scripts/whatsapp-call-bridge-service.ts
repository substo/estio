import http from "node:http";
import { randomBytes, randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";

type BridgeSession = {
    sessionId: string;
    status: "offline" | "pairing" | "ready" | "unhealthy";
    startedAt: string | null;
    lastHeartbeatAt: string | null;
    pairingCode: string | null;
    qr: string | null;
    mediaStatus: "signaling_only" | "media_probe_started" | "audio_connected" | "failed";
    calls: Map<string, BridgeCall>;
    recentCallEvents: any[];
    error?: string | null;
    socket?: any;
    reconnectAttempts: number;
    reconnectTimer?: ReturnType<typeof setTimeout> | null;
    capabilities: {
        offerCall: boolean;
        createCallLink: boolean;
        rejectCall: boolean;
        getUSyncDevices: boolean;
        createParticipantNodes: boolean;
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
    fallbackCallLink?: string | null;
    diagnostics?: any;
    timeoutTimer?: ReturnType<typeof setTimeout> | null;
};

const PORT = Number(process.env.WHATSAPP_CALL_BRIDGE_PORT || 3037);
const SECRET = String(process.env.WHATSAPP_CALL_BRIDGE_SECRET || "");
const APP_WEBHOOK_URL = String(process.env.WHATSAPP_CALL_BRIDGE_APP_WEBHOOK_URL || "").trim();
const SIMULATE = process.env.WHATSAPP_CALL_BRIDGE_SIMULATE === "1";
const AUTH_ROOT = String(process.env.WHATSAPP_CALL_BRIDGE_AUTH_DIR || ".data/whatsapp-call-bridge").trim();
const OFFER_RINGING_TIMEOUT_MS = Math.max(3000, Number(process.env.WHATSAPP_CALL_BRIDGE_OFFER_RINGING_TIMEOUT_MS || 15000));
const RECENT_CALL_EVENT_LIMIT = 25;
const sessions = new Map<string, BridgeSession>();

function closeSocket(socket: any) {
    if (!socket) return;
    try {
        if (typeof socket.end === "function") {
            socket.end(undefined);
            return;
        }
        if (typeof socket.ws?.close === "function") {
            socket.ws.close();
            return;
        }
        if (typeof socket.logout === "function") {
            void socket.logout().catch(() => undefined);
        }
    } catch {
        // Best-effort cleanup. A new socket will replace the stale one.
    }
}

function clearCallTimer(call: BridgeCall | null | undefined) {
    if (call?.timeoutTimer) {
        clearTimeout(call.timeoutTimer);
        call.timeoutTimer = null;
    }
}

function pushRecentCallEvent(session: BridgeSession, event: any) {
    session.recentCallEvents.push({
        receivedAt: new Date().toISOString(),
        event: sanitizeForJson(event),
    });
    if (session.recentCallEvents.length > RECENT_CALL_EVENT_LIMIT) {
        session.recentCallEvents.splice(0, session.recentCallEvents.length - RECENT_CALL_EVENT_LIMIT);
    }
}

function sanitizeForJson(value: any, depth = 0): any {
    if (value == null) return value;
    if (depth > 5) return "[depth_limit]";
    if (value instanceof Uint8Array || Buffer.isBuffer(value)) {
        return {
            type: "bytes",
            length: value.length,
            previewHex: Buffer.from(value).subarray(0, 16).toString("hex"),
        };
    }
    if (Array.isArray(value)) return value.map((item) => sanitizeForJson(item, depth + 1));
    if (typeof value === "object") {
        return Object.fromEntries(
            Object.entries(value).map(([key, entry]) => [key, sanitizeForJson(entry, depth + 1)])
        );
    }
    return value;
}

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

async function createAudioCallLink(socket: any) {
    if (!socket || typeof socket.createCallLink !== "function") return null;
    try {
        const link = await socket.createCallLink("audio", undefined, 2500);
        return typeof link === "string" && link.trim() ? link.trim() : null;
    } catch (error: any) {
        console.warn("[WhatsApp Call Bridge] Failed to create audio call link:", error?.message || error);
        return null;
    }
}

function scheduleOfferUnconfirmedTimeout(session: BridgeSession, call: BridgeCall) {
    clearCallTimer(call);
    call.timeoutTimer = setTimeout(() => {
        void (async () => {
            const current = session.calls.get(call.callId);
            if (!current) return;
            if (current.event !== "call_offer_sent" || current.status !== "call_attempted") return;

            const fallbackCallLink = await createAudioCallLink(session.socket);
            current.status = "failed";
            current.event = "call_media_unknown";
            current.mediaStatus = "failed";
            current.updatedAt = new Date().toISOString();
            current.error = "WhatsApp accepted the Baileys call offer, but no ringing, answer, reject, or timeout event arrived.";
            current.fallbackCallLink = fallbackCallLink;
            current.raw = {
                ...(current.raw || {}),
                offerUnconfirmedAfterMs: OFFER_RINGING_TIMEOUT_MS,
                fallbackCallLink,
                diagnostics: current.diagnostics || null,
            };

            console.warn("[WhatsApp Call Bridge] offerCall unconfirmed", JSON.stringify({
                sessionId: session.sessionId,
                callId: current.callId,
                attemptId: current.attemptId || null,
                conversationId: current.conversationId || null,
                contactId: current.contactId || null,
                to: maskCallTarget(current.to),
                whatsappCallId: current.whatsappCallId || null,
                fallbackCallLink: Boolean(fallbackCallLink),
            }));

            void emitEvent({
                success: false,
                event: "call_media_unknown",
                callId: current.callId,
                bridgeCallId: current.callId,
                whatsappCallId: current.whatsappCallId,
                attemptId: current.attemptId,
                locationId: current.locationId,
                conversationId: current.conversationId,
                contactId: current.contactId,
                status: current.status,
                mediaStatus: current.mediaStatus,
                errorCode: "baileys_offer_unconfirmed",
                errorMessage: current.error,
                fallbackCallLink,
                raw: current.raw,
            });
        })();
    }, OFFER_RINGING_TIMEOUT_MS);
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
        reconnectAttempts: 0,
        reconnectTimer: null,
        recentCallEvents: [],
        capabilities: {
            offerCall: false,
            createCallLink: false,
            rejectCall: false,
            getUSyncDevices: false,
            createParticipantNodes: false,
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

function getAuthPath(sessionId: string) {
    return `${AUTH_ROOT}/${sanitizeSessionId(sessionId)}`;
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

function normalizeCallTarget(value: unknown) {
    const raw = String(value || "").trim();
    const lower = raw.toLowerCase();
    if (/^[0-9]+@(s\.whatsapp\.net|lid)$/.test(lower)) return lower;
    return raw.replace(/\D/g, "");
}

function toCallJid(value: string) {
    if (/@(s\.whatsapp\.net|lid)$/.test(value)) return value;
    return `${value}@s.whatsapp.net`;
}

function maskCallTarget(value: string) {
    if (!value) return null;
    const [left, domain] = value.split("@");
    const masked = left.length > 8 ? `${left.slice(0, 4)}...${left.slice(-4)}` : left;
    return domain ? `${masked}@${domain}` : masked;
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

function findRecentActiveCallForEvent(session: BridgeSession, event: any) {
    const eventJids = [
        event?.chatId,
        event?.from,
        event?.attrs?.from,
        event?.node?.attrs?.from,
    ].map((value) => String(value || "").toLowerCase()).filter(Boolean);
    const activeCalls = Array.from(session.calls.values())
        .filter((call) => call.status === "call_attempted" || call.status === "accepted")
        .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
    const recentThreshold = Date.now() - 5 * 60 * 1000;
    return activeCalls.find((call) => {
        if (Date.parse(call.createdAt) < recentThreshold) return false;
        const callTargets = [
            call.to,
            toCallJid(call.to),
            call.raw?.to,
        ].map((value) => String(value || "").toLowerCase()).filter(Boolean);
        return eventJids.some((jid) => callTargets.includes(jid));
    }) || (activeCalls.length === 1 ? activeCalls[0] : null);
}

function getDisconnectStatusCode(update: any) {
    return Number(
        update?.lastDisconnect?.error?.output?.statusCode
        || update?.lastDisconnect?.error?.statusCode
        || update?.lastDisconnect?.error?.data?.attrs?.code
        || update?.lastDisconnect?.error?.data?.code
        || 0
    );
}

function getDisconnectErrorMessage(update: any) {
    return String(
        update?.lastDisconnect?.error?.message
        || update?.lastDisconnect?.error?.output?.payload?.message
        || update?.lastDisconnect?.error?.data?.message
        || ""
    ).trim();
}

function summarizeDisconnect(update: any) {
    const error = update?.lastDisconnect?.error;
    return {
        connection: update?.connection || null,
        statusCode: getDisconnectStatusCode(update) || null,
        message: getDisconnectErrorMessage(update) || null,
        outputStatusCode: error?.output?.statusCode || null,
        outputPayload: error?.output?.payload || null,
        data: error?.data || null,
    };
}

function shouldReconnectAfterClose(update: any) {
    const statusCode = getDisconnectStatusCode(update);
    const message = getDisconnectErrorMessage(update).toLowerCase();
    return statusCode === 515 || message.includes("restart required");
}

function scheduleBaileysReconnect(session: BridgeSession, baileys: any) {
    if (session.reconnectTimer) return;
    if (session.reconnectAttempts >= 3) {
        session.status = "unhealthy";
        session.error = "Baileys requested restart repeatedly after pairing.";
        return;
    }

    session.reconnectAttempts += 1;
    session.status = "pairing";
    session.qr = null;
    session.pairingCode = null;
    session.error = "WhatsApp accepted pairing; reconnecting with saved credentials.";
    session.reconnectTimer = setTimeout(() => {
        session.reconnectTimer = null;
        closeSocket(session.socket);
        session.socket = null;
        void createBaileysSocket(session, baileys, { skipPairing: true }).then((result) => {
            if (!result.success) {
                session.status = "unhealthy";
                session.error = result.error || "Baileys reconnect failed.";
            }
        }).catch((error: any) => {
            session.status = "unhealthy";
            session.error = error?.message || "Baileys reconnect failed.";
        });
    }, 1500);
}

async function inspectOfferCallPath(socket: any, targetJid: string, isVideo: boolean) {
    const diagnostics: Record<string, any> = {
        targetJid,
        isVideo,
        capabilities: {
            getUSyncDevices: typeof socket?.getUSyncDevices === "function",
            assertSessions: typeof socket?.assertSessions === "function",
            createParticipantNodes: typeof socket?.createParticipantNodes === "function",
        },
        sourceDerivedOfferChildren: [
            { tag: "audio", attrs: { enc: "opus", rate: "16000" } },
            { tag: "audio", attrs: { enc: "opus", rate: "8000" } },
            ...(isVideo ? [{ tag: "video", attrs: { enc: "vp8", dec: "vp8" } }] : []),
            { tag: "net", attrs: { medium: "3" } },
            { tag: "capability", attrs: { ver: "1" }, contentLength: 6 },
            { tag: "encopt", attrs: { keygen: "2" } },
            { tag: "destination", attrs: {} },
            { tag: "device-identity", attrs: {}, conditional: true },
        ],
    };

    if (typeof socket?.getUSyncDevices === "function") {
        try {
            const devices = await socket.getUSyncDevices([targetJid], true, false);
            diagnostics.usyncDevices = sanitizeForJson(devices);
            diagnostics.usyncDeviceCount = Array.isArray(devices) ? devices.length : null;
            diagnostics.deviceFanout = Array.isArray(devices)
                ? devices.map((device: any) => ({
                    user: device?.user || null,
                    device: device?.device ?? null,
                    approximateJid: device?.user
                        ? `${device.user}${device.device ? `:${device.device}` : ""}@s.whatsapp.net`
                        : null,
                }))
                : [];
        } catch (error: any) {
            diagnostics.usyncError = error?.message || String(error);
        }
    }

    if (
        typeof socket?.createParticipantNodes === "function"
        && Array.isArray(diagnostics.deviceFanout)
        && diagnostics.deviceFanout.length > 0
    ) {
        try {
            const jids = diagnostics.deviceFanout
                .map((device: any) => device.approximateJid)
                .filter(Boolean);
            const result = await socket.createParticipantNodes(jids, {
                call: { callKey: randomBytes(32) },
            }, { count: "0" });
            diagnostics.participantNodeCount = Array.isArray(result?.nodes) ? result.nodes.length : null;
            diagnostics.shouldIncludeDeviceIdentity = result?.shouldIncludeDeviceIdentity ?? null;
            diagnostics.participantNodePreview = sanitizeForJson(result?.nodes?.slice?.(0, 2) || []);
        } catch (error: any) {
            diagnostics.participantNodeError = error?.message || String(error);
        }
    }

    return diagnostics;
}

function bindBaileysEvents(session: BridgeSession, socket: any, saveCreds: (() => Promise<void>) | undefined, baileys: any) {
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
            session.pairingCode = null;
            session.error = null;
            session.reconnectAttempts = 0;
        }
        if (update?.connection === "close") {
            const disconnect = summarizeDisconnect(update);
            console.warn("[WhatsApp Call Bridge] Baileys connection closed:", JSON.stringify(disconnect));
            if (shouldReconnectAfterClose(update)) {
                scheduleBaileysReconnect(session, baileys);
                return;
            }
            session.status = "unhealthy";
            session.error = disconnect.message || disconnect.outputPayload?.error || "Baileys connection closed.";
        }
    });

    socket.ev.on("call", (events: any) => {
        const list = Array.isArray(events) ? events : [events];
        for (const event of list) {
            pushRecentCallEvent(session, event);
            const whatsappCallId = extractWhatsAppCallId(event);
            const call = findCallByWhatsAppCallId(session, whatsappCallId) || findRecentActiveCallForEvent(session, event);
            console.log("[WhatsApp Call Bridge] Baileys call event", JSON.stringify({
                sessionId: session.sessionId,
                whatsappCallId,
                status: event?.status || event?.event || event?.tag || event?.type || null,
                chatId: event?.chatId || null,
                from: event?.from || null,
                matchedCallId: call?.callId || null,
                attemptId: call?.attemptId || null,
            }));

            const mappedEvent = mapBaileysCallEvent(event);
            if (!call && whatsappCallId) {
                const now = new Date().toISOString();
                const inboundCall: BridgeCall = {
                    callId: whatsappCallId,
                    whatsappCallId,
                    to: String(event?.chatId || event?.from || ""),
                    status: mappedEvent === "call_offer" ? "call_attempted" : mappedEvent.replace(/^call_/, ""),
                    event: mappedEvent,
                    mediaStatus: session.mediaStatus,
                    createdAt: now,
                    updatedAt: now,
                    raw: event,
                };
                session.calls.set(inboundCall.callId, inboundCall);
                continue;
            }
            if (!call) continue;

            if (mappedEvent !== "call_offer_sent") clearCallTimer(call);
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

    const authPath = getAuthPath(session.sessionId);
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
    session.capabilities.createCallLink = typeof socket.createCallLink === "function";
    session.capabilities.rejectCall = typeof socket.rejectCall === "function";
    session.capabilities.getUSyncDevices = typeof socket.getUSyncDevices === "function";
    session.capabilities.createParticipantNodes = typeof socket.createParticipantNodes === "function";
    bindBaileysEvents(session, socket, saveCreds, baileys);

    const phoneNumber = String(body?.phoneNumber || process.env.WHATSAPP_CALL_BRIDGE_PAIRING_PHONE || "").replace(/\D/g, "");
    const usePairingCode = body?.usePairingCode === true;
    if (!body?.skipPairing && usePairingCode && phoneNumber && typeof socket.requestPairingCode === "function") {
        const pairingCode = await socket.requestPairingCode(phoneNumber).catch(() => null);
        session.pairingCode = pairingCode && String(pairingCode) !== "ABCD1234" ? String(pairingCode) : null;
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
    closeSocket(session.socket);
    if (session.reconnectTimer) {
        clearTimeout(session.reconnectTimer);
        session.reconnectTimer = null;
    }
    session.socket = null;
    session.status = "pairing";
    session.startedAt = new Date().toISOString();
    session.lastHeartbeatAt = new Date().toISOString();
    session.error = null;
    session.pairingCode = null;
    session.qr = null;
    session.reconnectAttempts = 0;

    if (body?.resetAuth === true) {
        await rm(getAuthPath(session.sessionId), { recursive: true, force: true }).catch(() => undefined);
    }

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
    const to = normalizeCallTarget(body?.to);
    const logContext = {
        sessionId: session.sessionId,
        callId,
        attemptId: body?.attemptId ? String(body.attemptId) : null,
        conversationId: body?.conversationId ? String(body.conversationId) : null,
        contactId: body?.contactId ? String(body.contactId) : null,
        to: maskCallTarget(to),
    };
    console.log("[WhatsApp Call Bridge] offerCall request", JSON.stringify(logContext));
    if (!to) {
        console.warn("[WhatsApp Call Bridge] offerCall rejected", JSON.stringify({
            ...logContext,
            errorCode: "missing_recipient",
        }));
        return {
            success: false,
            event: "call_failed",
            errorCode: "missing_recipient",
            errorMessage: "Recipient phone is required.",
        };
    }

    if (session.status !== "ready") {
        console.warn("[WhatsApp Call Bridge] offerCall rejected", JSON.stringify({
            ...logContext,
            sessionStatus: session.status,
            errorCode: "bridge_not_ready",
        }));
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
        console.log("[WhatsApp Call Bridge] offerCall simulated", JSON.stringify(logContext));
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
        console.warn("[WhatsApp Call Bridge] offerCall unavailable", JSON.stringify({
            ...logContext,
            errorCode: response.errorCode,
            errorMessage: response.errorMessage,
        }));
        void emitEvent(response);
        return response;
    }

    try {
        const targetJid = toCallJid(to);
        const isVideo = body?.isVideo === true || body?.video === true;
        const diagnostics = body?.diagnostics === true
            ? await inspectOfferCallPath(socket, targetJid, isVideo)
            : null;
        const result = await socket.offerCall(targetJid, isVideo);
        const whatsappCallId = extractWhatsAppCallId(result);
        call.whatsappCallId = whatsappCallId;
        call.diagnostics = diagnostics;
        call.raw = { result, diagnostics };
        session.calls.set(callId, call);
        scheduleOfferUnconfirmedTimeout(session, call);
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
            targetJid,
            diagnostics,
            raw: result,
        };
        console.log("[WhatsApp Call Bridge] offerCall sent", JSON.stringify({
            ...logContext,
            whatsappCallId,
            isVideo,
            usyncDeviceCount: diagnostics?.usyncDeviceCount ?? null,
            resultKeys: result && typeof result === "object" ? Object.keys(result).slice(0, 12) : [],
        }));
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
        console.warn("[WhatsApp Call Bridge] offerCall failed", JSON.stringify({
            ...logContext,
            errorCode: response.errorCode,
            errorMessage: response.errorMessage,
        }));
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
                error: firstSession?.error || null,
                lastHeartbeatAt: firstSession?.lastHeartbeatAt || null,
                capabilities: firstSession?.capabilities || {
                    offerCall: false,
                    createCallLink: false,
                    rejectCall: false,
                    getUSyncDevices: false,
                    createParticipantNodes: false,
                },
                recentCallEvents: firstSession?.recentCallEvents?.slice(-5) || [],
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
            const whatsappCallId = String(body?.whatsappCallId || call?.whatsappCallId || callId || "").trim();
            const callFrom = String(body?.from || call?.raw?.from || call?.raw?.chatId || call?.to || "").trim();
            let bridgeReject: any = null;
            let bridgeRejectError: string | null = null;
            if (session.socket && typeof session.socket.rejectCall === "function" && whatsappCallId && callFrom) {
                try {
                    bridgeReject = await session.socket.rejectCall(whatsappCallId, callFrom);
                } catch (error: any) {
                    bridgeRejectError = error?.message || String(error);
                }
            }
            if (call) {
                call.status = "rejected";
                call.event = "call_rejected";
                call.updatedAt = new Date().toISOString();
                call.raw = {
                    ...(call.raw || {}),
                    bridgeReject,
                    bridgeRejectError,
                };
            }
            const response = {
                success: Boolean(call),
                event: call ? "call_rejected" : "call_failed",
                callId,
                whatsappCallId: whatsappCallId || null,
                from: callFrom || null,
                attemptId: call?.attemptId || null,
                locationId: call?.locationId || null,
                conversationId: call?.conversationId || null,
                contactId: call?.contactId || null,
                errorCode: call ? null : "call_not_found",
                bridgeRejectError,
                raw: bridgeReject || null,
            };
            void emitEvent(response);
            return json(res, 200, response);
        }

        if (method === "GET" && parts[2] === "calls" && parts[3]) {
            const callId = decodeURIComponent(parts[3]);
            const call = session.calls.get(callId);
            if (!call) return json(res, 404, { success: false, error: "Call not found" });
            const { timeoutTimer: _timeoutTimer, ...serializableCall } = call;
            return json(res, 200, { success: true, ...serializableCall });
        }

        if (method === "GET" && parts[2] === "calls") {
            const calls = Array.from(session.calls.values()).map((call) => {
                const { timeoutTimer: _timeoutTimer, ...serializableCall } = call;
                return serializableCall;
            });
            return json(res, 200, {
                success: true,
                calls,
                recentCallEvents: session.recentCallEvents,
            });
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
