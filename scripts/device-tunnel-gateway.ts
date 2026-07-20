import { createServer as createHttpServer, IncomingMessage, ServerResponse } from "node:http";
import { createServer as createTcpServer, Socket } from "node:net";
import { createHash, randomUUID } from "node:crypto";
import { WebSocket, WebSocketServer } from "ws";
import db from "../lib/db";
import { maskIpAddress, verifyDeviceTunnelToken } from "../lib/device-tunnel/auth";
import { authorizeDeviceTunnelGatewayConnection } from "../lib/device-tunnel/gateway-authorization";
import { BoundedJtiReplayCache } from "../lib/device-tunnel/jti-replay-cache";
import { isAllowedTunnelTarget, parseAllowedTunnelSuffixes } from "../lib/device-tunnel/policy";
import { calculateTunnelSendProof, type TunnelSendSnapshot } from "../lib/device-tunnel/send-proof";
import { Socks5ConnectionState } from "../lib/device-tunnel/socks5-state";
import { registerDeviceTunnelGatewayNode, heartbeatDeviceTunnelGatewayNode } from "../lib/device-tunnel/gateway-node-registry";
import { isDistributedDeviceTunnelPlacementEnabled } from "../lib/device-tunnel/distributed-placement";
import {
    acquireDeviceTunnelSessionLease,
    createPrismaDeviceTunnelLeaseStore,
    expireDeviceTunnelSessionLease,
    renewDeviceTunnelSessionLease,
} from "../lib/device-tunnel/session-lease";
import {
    isDeviceTunnelRuntimeLeaseEnforcementActive,
    RuntimeLeaseRenewalFence,
    validateDeviceTunnelRuntimeOwnership,
    type DeviceTunnelRuntimeOwnership,
} from "../lib/device-tunnel/runtime-ownership";

const PORT = Math.max(Number(process.env.DEVICE_TUNNEL_GATEWAY_PORT || 3220), 1);
const INTERNAL_SECRET = String(process.env.DEVICE_TUNNEL_INTERNAL_SECRET || "").trim();
const DISTRIBUTED_PLACEMENT = isDistributedDeviceTunnelPlacementEnabled();
const CONFIGURED_GATEWAY_NODE_ID = String(process.env.DEVICE_TUNNEL_GATEWAY_NODE_ID || "").trim();
if (DISTRIBUTED_PLACEMENT && !CONFIGURED_GATEWAY_NODE_ID) {
    throw new Error("DEVICE_TUNNEL_GATEWAY_NODE_ID is required when distributed placement is enabled");
}
const GATEWAY_NODE_ID = CONFIGURED_GATEWAY_NODE_ID || "device-tunnel-gateway-single";
const RUNTIME_LEASE_ENFORCEMENT = isDeviceTunnelRuntimeLeaseEnforcementActive();
const RUNTIME_OWNER_INSTANCE_ID = String(process.env.DEVICE_TUNNEL_RUNTIME_OWNER_INSTANCE_ID || "").trim();
if (RUNTIME_LEASE_ENFORCEMENT && !RUNTIME_OWNER_INSTANCE_ID) {
    throw new Error("DEVICE_TUNNEL_RUNTIME_OWNER_INSTANCE_ID is required when runtime lease enforcement is enabled");
}
const RUNTIME_LEASE_TTL_MS = Math.max(Number(process.env.DEVICE_TUNNEL_RUNTIME_LEASE_TTL_MS || 30_000), 10_000);
const RUNTIME_LEASE_RENEW_INTERVAL_MS = Math.min(
    Math.max(Number(process.env.DEVICE_TUNNEL_RUNTIME_LEASE_RENEW_INTERVAL_MS || 10_000), 1_000),
    Math.floor(RUNTIME_LEASE_TTL_MS / 2),
);
const GATEWAY_STARTED_AT = new Date();
const GATEWAY_GENERATION = randomUUID();
const GATEWAY_REGION = String(process.env.DEVICE_TUNNEL_GATEWAY_REGION || "default").trim() || "default";
const GATEWAY_PUBLIC_URL = String(process.env.DEVICE_TUNNEL_PUBLIC_URL || "").trim() || null;
const GATEWAY_INTERNAL_URL = String(process.env.DEVICE_TUNNEL_GATEWAY_INTERNAL_URL || `http://127.0.0.1:${PORT}`).trim();
const GATEWAY_CAPACITY_SESSIONS = Math.max(Number(process.env.DEVICE_TUNNEL_GATEWAY_CAPACITY_SESSIONS || 100), 1);
const GATEWAY_VERSION = String(process.env.RELEASE_VERSION || process.env.npm_package_version || "").trim() || null;
const WHATSAPP_BRIDGE_URL = String(process.env.WHATSAPP_WEB_BRIDGE_URL || "http://127.0.0.1:3218").replace(/\/+$/, "");
const WHATSAPP_BRIDGE_SECRET = String(process.env.WHATSAPP_WEB_BRIDGE_SECRET || process.env.CRON_SECRET || "").trim();
const MAX_STREAMS_PER_DEVICE = Math.max(Number(process.env.DEVICE_TUNNEL_MAX_STREAMS || 64), 1);
const MAX_FRAME_BYTES = Math.max(Number(process.env.DEVICE_TUNNEL_MAX_FRAME_BYTES || 512 * 1024), 64 * 1024);
const ALLOWED_SUFFIXES = parseAllowedTunnelSuffixes(process.env.DEVICE_TUNNEL_ALLOWED_HOST_SUFFIXES);

type TunnelFrame = {
    type: string;
    streamId?: string;
    host?: string;
    port?: number;
    data?: string;
    ok?: boolean;
    error?: string;
    networkType?: string;
};

type ConnectedDevice = {
    bindingId: string;
    deviceId: string;
    locationId: string;
    assignmentEpoch: number;
    bridgeSessionId: string;
    ws: WebSocket;
    proxyServer: ReturnType<typeof createTcpServer>;
    proxyPort: number;
    streams: Map<string, Socket>;
    pendingOpen: Map<string, NodeJS.Timeout>;
    bytesToDevice: bigint;
    bytesFromDevice: bigint;
    lastBrowserTrafficAt: Date | null;
    proofStarts: Map<string, TunnelSendSnapshot>;
    ownership: DeviceTunnelRuntimeOwnership | null;
    leaseExpiresAt: Date | null;
    renewalFence: RuntimeLeaseRenewalFence;
    renewalInFlight: boolean;
};

const devicesByBridgeSession = new Map<string, ConnectedDevice>();
const leaseStore = createPrismaDeviceTunnelLeaseStore(db as any);
const configuredJtiCacheEntries = Number(process.env.DEVICE_TUNNEL_JTI_CACHE_MAX_ENTRIES || 10_000);
const consumedTunnelJtis = new BoundedJtiReplayCache(
    Number.isSafeInteger(configuredJtiCacheEntries) && configuredJtiCacheEntries > 0 ? configuredJtiCacheEntries : 10_000,
);

function isInternalAuthorized(req: IncomingMessage) {
    return Boolean(INTERNAL_SECRET) && req.headers["x-device-tunnel-secret"] === INTERNAL_SECRET;
}

function json(res: ServerResponse, status: number, payload: unknown) {
    res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
    res.end(JSON.stringify(payload));
}

function extractBearer(req: IncomingMessage) {
    return String(req.headers.authorization || "").replace(/^Bearer\s+/i, "").trim();
}

async function ensureWhatsAppBrowserStarted(sessionId: string, locationId: string, ownership: DeviceTunnelRuntimeOwnership | null) {
    if (!WHATSAPP_BRIDGE_SECRET) {
        throw new Error("WHATSAPP_WEB_BRIDGE_SECRET is not configured");
    }
    const response = await fetch(`${WHATSAPP_BRIDGE_URL}/sessions/${encodeURIComponent(sessionId)}/start`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "x-whatsapp-web-bridge-secret": WHATSAPP_BRIDGE_SECRET,
        },
        body: JSON.stringify({ locationId, ...(ownership ? { ownership } : {}) }),
        signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) {
        throw new Error(`WhatsApp bridge rejected tunnel session start (${response.status})`);
    }
    console.info(`[Device Tunnel] Requested WhatsApp browser start for ${sessionId}`);
}

async function stopFencedWhatsAppBrowser(device: ConnectedDevice) {
    if (!WHATSAPP_BRIDGE_SECRET || !device.ownership) return;
    await fetch(`${WHATSAPP_BRIDGE_URL}/sessions/${encodeURIComponent(device.bridgeSessionId)}/fence`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "x-whatsapp-web-bridge-secret": WHATSAPP_BRIDGE_SECRET,
        },
        body: JSON.stringify({ ownership: device.ownership }),
        signal: AbortSignal.timeout(5_000),
    }).catch(() => null);
}

async function readSmallJson(req: IncomingMessage) {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of req) {
        const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        size += value.length;
        if (size > 16 * 1024) throw new Error("Request body too large");
        chunks.push(value);
    }
    if (!chunks.length) return {};
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function sendFrame(device: ConnectedDevice, frame: TunnelFrame) {
    if (
        RUNTIME_LEASE_ENFORCEMENT
        && (!device.renewalFence.canAcceptWork || !device.leaseExpiresAt || device.leaseExpiresAt <= new Date())
    ) {
        throw new Error("Device tunnel runtime ownership was fenced");
    }
    if (device.ws.readyState !== WebSocket.OPEN) throw new Error("Device tunnel is disconnected");
    const serialized = JSON.stringify(frame);
    if (Buffer.byteLength(serialized) > MAX_FRAME_BYTES) throw new Error("Tunnel frame exceeds configured limit");
    device.ws.send(serialized);
}

async function hasCurrentRuntimeOwnership(device: ConnectedDevice) {
    if (!RUNTIME_LEASE_ENFORCEMENT) return true;
    if (!device.ownership || !device.renewalFence.canAcceptWork || !device.leaseExpiresAt || device.leaseExpiresAt <= new Date()) {
        return false;
    }
    return validateDeviceTunnelRuntimeOwnership({ db: db as any, ownership: device.ownership }).catch(() => false);
}

function runtimeLeaseFilter(device: ConnectedDevice) {
    return device.ownership ? {
        sessionLease: {
            is: {
                gatewayNodeId: device.ownership.gatewayNodeId,
                ownerInstanceId: device.ownership.ownerInstanceId,
                epoch: device.ownership.leaseEpoch,
                state: "active",
                expiresAt: { gt: new Date() },
            },
        },
    } : {};
}

function closeStream(device: ConnectedDevice, streamId: string, notifyDevice = true) {
    const stream = device.streams.get(streamId);
    device.streams.delete(streamId);
    const pending = device.pendingOpen.get(streamId);
    if (pending) clearTimeout(pending);
    device.pendingOpen.delete(streamId);
    stream?.destroy();
    if (notifyDevice && (stream || pending) && device.ws.readyState === WebSocket.OPEN) {
        device.ws.send(JSON.stringify({ type: "close", streamId }));
    }
}

function createSocksProxy(deviceBase: Omit<ConnectedDevice, "proxyServer" | "proxyPort">) {
    const proxyServer = createTcpServer((socket) => {
        socket.pause();
        void hasCurrentRuntimeOwnership(deviceBase as ConnectedDevice).then((owned) => {
            if (!owned) return socket.destroy();
            const state = new Socks5ConnectionState();
            let buffer = Buffer.alloc(0);
            let streamId = "";

            const fail = (replyCode = 0x01) => {
                if (state.shouldWriteFailure(Boolean(streamId && deviceBase.pendingOpen.has(streamId)))) {
                    socket.write(Buffer.from([0x05, replyCode, 0x00, 0x01, 0, 0, 0, 0, 0, 0]));
                }
                socket.destroy();
                if (streamId) closeStream(deviceBase as ConnectedDevice, streamId);
            };

            socket.on("data", (chunk) => {
                const chunkBuffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
                if (state.isStreaming) {
                    try {
                        deviceBase.bytesToDevice += BigInt(chunkBuffer.length);
                        deviceBase.lastBrowserTrafficAt = new Date();
                        sendFrame(deviceBase as ConnectedDevice, { type: "data", streamId, data: chunkBuffer.toString("base64") });
                    } catch {
                        fail();
                    }
                    return;
                }

                buffer = Buffer.concat([buffer, chunkBuffer]);
                while (buffer.length) {
                    if (state.phase === "greeting") {
                        if (buffer.length < 2) return;
                        const methodsLength = buffer[1];
                        if (buffer.length < 2 + methodsLength) return;
                        const supportsNoAuth = buffer.subarray(2, 2 + methodsLength).includes(0x00);
                        buffer = buffer.subarray(2 + methodsLength);
                        socket.write(Buffer.from([0x05, supportsNoAuth ? 0x00 : 0xff]));
                        if (!supportsNoAuth) return socket.destroy();
                        state.acceptGreeting();
                        continue;
                    }

                    if (buffer.length < 5) return;
                    if (buffer[0] !== 0x05 || buffer[1] !== 0x01 || buffer[2] !== 0x00) return fail(0x07);
                    const addressType = buffer[3];
                    if (addressType !== 0x03) return fail(0x08);
                    const hostLength = buffer[4];
                    const requestLength = 5 + hostLength + 2;
                    if (buffer.length < requestLength) return;
                    const host = buffer.subarray(5, 5 + hostLength).toString("utf8");
                    const port = buffer.readUInt16BE(5 + hostLength);
                    buffer = buffer.subarray(requestLength);
                    if (!isAllowedTunnelTarget({ host, port, allowedSuffixes: ALLOWED_SUFFIXES })) return fail(0x02);
                    if (deviceBase.streams.size >= MAX_STREAMS_PER_DEVICE) return fail(0x01);

                    streamId = randomUUID();
                    deviceBase.streams.set(streamId, socket);
                    // SOCKS clients wait for the success response before sending TLS.
                    // Mark the request as a byte stream before resuming the socket so
                    // encrypted application data is never parsed as a second handshake.
                    state.acceptConnectRequest();
                    socket.pause();
                    const timeout = setTimeout(() => fail(0x04), 20_000);
                    deviceBase.pendingOpen.set(streamId, timeout);
                    try {
                        sendFrame(deviceBase as ConnectedDevice, { type: "open", streamId, host, port });
                    } catch {
                        return fail(0x01);
                    }
                    return;
                }
            });

            socket.on("close", () => {
                if (streamId) closeStream(deviceBase as ConnectedDevice, streamId);
            });
            socket.on("error", () => undefined);
            socket.resume();
        }).catch(() => socket.destroy());
    });
    return proxyServer;
}

async function disconnectDevice(device: ConnectedDevice, reason: string) {
    const isCurrentConnection = devicesByBridgeSession.get(device.bridgeSessionId) === device;
    if (isCurrentConnection) devicesByBridgeSession.delete(device.bridgeSessionId);
    device.renewalFence.fence();
    for (const streamId of Array.from(device.streams.keys())) closeStream(device, streamId, false);
    device.proxyServer.close();
    if (RUNTIME_LEASE_ENFORCEMENT && device.ws.readyState === WebSocket.OPEN) {
        device.ws.close(4002, "Runtime ownership ended");
    }
    if (!isCurrentConnection) return;
    if (RUNTIME_LEASE_ENFORCEMENT) await stopFencedWhatsAppBrowser(device);
    await (db as any).deviceTunnelBinding.updateMany({
        where: {
            id: device.bindingId,
            ...(DISTRIBUTED_PLACEMENT ? {
                gatewayNodeId: GATEWAY_NODE_ID,
                assignmentEpoch: device.assignmentEpoch,
            } : {}),
            ...(device.ownership ? {
                sessionLease: {
                    is: {
                        ownerInstanceId: device.ownership.ownerInstanceId,
                        epoch: device.ownership.leaseEpoch,
                    },
                },
            } : {}),
        },
        data: {
            status: "offline",
            lastError: reason,
            ...(!DISTRIBUTED_PLACEMENT ? { gatewayNodeId: null } : {}),
        },
    }).catch(() => undefined);
    if (device.ownership) {
        await expireDeviceTunnelSessionLease({
            store: leaseStore,
            locationId: device.locationId,
            sessionId: device.ownership.sessionId,
            bindingId: device.bindingId,
            gatewayNodeId: GATEWAY_NODE_ID,
            assignmentEpoch: device.assignmentEpoch,
            ownerInstanceId: device.ownership.ownerInstanceId,
            epoch: device.ownership.leaseEpoch,
        }).catch(() => false);
    }
}

async function acceptDevice(ws: WebSocket, req: IncomingMessage) {
    const token = extractBearer(req);
    const tokenPayload = verifyDeviceTunnelToken(token, GATEWAY_NODE_ID);
    const binding = await authorizeDeviceTunnelGatewayConnection({
        db: db as any,
        token: tokenPayload,
        gatewayNodeId: GATEWAY_NODE_ID,
        distributedPlacement: DISTRIBUTED_PLACEMENT,
    });
    if (!consumedTunnelJtis.consume(tokenPayload.jti, tokenPayload.exp)) {
        throw new Error("Tunnel token was already used");
    }

    const existing = devicesByBridgeSession.get(binding.session.sessionId);
    if (existing) {
        existing.ws.close(4001, "Replaced by a newer device connection");
        await disconnectDevice(existing, "Tunnel connection replaced");
    }

    const acquiredLease = RUNTIME_LEASE_ENFORCEMENT
        ? await acquireDeviceTunnelSessionLease({
            store: leaseStore,
            locationId: binding.locationId,
            sessionId: tokenPayload.sessionId,
            bindingId: binding.id,
            gatewayNodeId: GATEWAY_NODE_ID,
            assignmentEpoch: tokenPayload.assignmentEpoch,
            ownerInstanceId: RUNTIME_OWNER_INSTANCE_ID,
            ttlMs: RUNTIME_LEASE_TTL_MS,
        })
        : null;
    if (RUNTIME_LEASE_ENFORCEMENT && !acquiredLease) {
        throw new Error("Device tunnel runtime ownership is unavailable");
    }
    const ownership: DeviceTunnelRuntimeOwnership | null = acquiredLease ? {
        locationId: binding.locationId,
        sessionId: tokenPayload.sessionId,
        bindingId: binding.id,
        gatewayNodeId: GATEWAY_NODE_ID,
        assignmentEpoch: tokenPayload.assignmentEpoch,
        ownerInstanceId: acquiredLease.ownerInstanceId,
        leaseEpoch: acquiredLease.epoch,
    } : null;

    const streams = new Map<string, Socket>();
    const pendingOpen = new Map<string, NodeJS.Timeout>();
    let device: ConnectedDevice;
    const renewalFence = new RuntimeLeaseRenewalFence(2, () => {
        void disconnectDevice(device, "Two consecutive runtime lease renewals were missed");
    });
    const base = {
        bindingId: binding.id,
        deviceId: binding.deviceId,
        locationId: binding.locationId,
        assignmentEpoch: tokenPayload.assignmentEpoch,
        bridgeSessionId: binding.session.sessionId,
        ws,
        streams,
        pendingOpen,
        bytesToDevice: 0n,
        bytesFromDevice: 0n,
        lastBrowserTrafficAt: null,
        proofStarts: new Map(),
        ownership,
        leaseExpiresAt: acquiredLease?.expiresAt || null,
        renewalFence,
        renewalInFlight: false,
    };
    const proxyServer = createSocksProxy(base);
    proxyServer.listen(0, "127.0.0.1");
    await new Promise<void>((resolve, reject) => {
        proxyServer.once("listening", resolve);
        proxyServer.once("error", reject);
    });
    const address = proxyServer.address();
    if (!address || typeof address === "string") throw new Error("Failed to bind tunnel proxy");
    device = { ...base, proxyServer, proxyPort: address.port };

    devicesByBridgeSession.set(device.bridgeSessionId, device);
    const forwardedFor = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim();
    const egressIpMasked = maskIpAddress(forwardedFor || String(req.socket.remoteAddress || ""));
    const connected = await (db as any).deviceTunnelBinding.updateMany({
        where: {
            id: binding.id,
            deviceId: tokenPayload.deviceId,
            sessionId: tokenPayload.sessionId,
            locationId: tokenPayload.locationId,
            assignmentEpoch: tokenPayload.assignmentEpoch,
            ...(DISTRIBUTED_PLACEMENT ? { gatewayNodeId: GATEWAY_NODE_ID } : {}),
            ...runtimeLeaseFilter(device),
        },
        data: {
            status: "online",
            ...(!DISTRIBUTED_PLACEMENT ? { gatewayNodeId: GATEWAY_NODE_ID } : {}),
            egressIpMasked,
            lastConnectedAt: new Date(),
            lastSeenAt: new Date(),
            lastError: null,
        },
    });
    if (Number(connected?.count || 0) !== 1) {
        await disconnectDevice(device, "Tunnel assignment changed during connection");
        throw new Error("Tunnel assignment changed during connection");
    }
    console.info("[Device Tunnel] Android relay connected", {
        bindingId: binding.id,
        deviceId: binding.deviceId,
        sessionId: device.bridgeSessionId,
        gatewayNodeId: GATEWAY_NODE_ID,
        egressIpMasked,
    });
    void ensureWhatsAppBrowserStarted(device.bridgeSessionId, binding.locationId, device.ownership).catch((error) => {
        console.warn(
            `[Device Tunnel] Failed to start WhatsApp browser for ${device.bridgeSessionId}:`,
            (error as any)?.message || error,
        );
        if (RUNTIME_LEASE_ENFORCEMENT) void disconnectDevice(device, "WhatsApp browser ownership start failed");
    });

    ws.on("message", async (raw) => {
        if (
            RUNTIME_LEASE_ENFORCEMENT
            && (!device.renewalFence.canAcceptWork || !device.leaseExpiresAt || device.leaseExpiresAt <= new Date())
        ) {
            void disconnectDevice(device, "Runtime lease expired or was fenced");
            return;
        }
        if (raw instanceof Buffer && raw.length > MAX_FRAME_BYTES) return ws.close(1009, "Frame too large");
        let frame: TunnelFrame;
        try {
            frame = JSON.parse(raw.toString());
        } catch {
            return ws.close(1003, "Invalid frame");
        }
        const streamId = String(frame.streamId || "");
        if (frame.type === "hello" || frame.type === "pong") {
            const observed = await (db as any).deviceTunnelBinding.updateMany({
                where: {
                    id: binding.id,
                    assignmentEpoch: device.assignmentEpoch,
                    ...(DISTRIBUTED_PLACEMENT ? { gatewayNodeId: GATEWAY_NODE_ID } : {}),
                    ...runtimeLeaseFilter(device),
                },
                data: {
                    status: "online",
                    lastSeenAt: new Date(),
                    ...(frame.networkType ? { networkType: String(frame.networkType).slice(0, 32) } : {}),
                },
            }).catch(() => null);
            if (RUNTIME_LEASE_ENFORCEMENT && Number(observed?.count || 0) !== 1) {
                void disconnectDevice(device, "Runtime ownership was fenced");
            }
            return;
        }
        if (!streamId || !device.streams.has(streamId)) return;
        const socket = device.streams.get(streamId)!;
        if (frame.type === "open_result") {
            const pending = device.pendingOpen.get(streamId);
            if (pending) clearTimeout(pending);
            device.pendingOpen.delete(streamId);
            if (!frame.ok) {
                device.streams.delete(streamId);
                socket.end(Buffer.from([0x05, 0x04, 0x00, 0x01, 0, 0, 0, 0, 0, 0]));
                return;
            }
            socket.write(Buffer.from([0x05, 0x00, 0x00, 0x01, 0, 0, 0, 0, 0, 0]));
            socket.resume();
            return;
        }
        if (frame.type === "data" && frame.data) {
            const data = Buffer.from(frame.data, "base64");
            if (data.length > MAX_FRAME_BYTES) return closeStream(device, streamId);
            device.bytesFromDevice += BigInt(data.length);
            socket.write(data);
            return;
        }
        if (frame.type === "close") closeStream(device, streamId, false);
    });

    ws.on("close", () => void disconnectDevice(device, "Device tunnel disconnected"));
    ws.on("error", () => void disconnectDevice(device, "Device tunnel websocket failed"));
    ws.send(JSON.stringify({ type: "ready", bindingId: binding.id, gatewayNodeId: GATEWAY_NODE_ID }));
}

const server = createHttpServer(async (req, res) => {
    const url = new URL(req.url || "/", `http://${req.headers.host || "127.0.0.1"}`);
    if (url.pathname === "/health") {
        if (!isInternalAuthorized(req)) return json(res, 401, { error: "Unauthorized" });
        return json(res, 200, {
            ok: true,
            gatewayNodeId: GATEWAY_NODE_ID,
            gatewayGeneration: GATEWAY_GENERATION,
            connectedDevices: devicesByBridgeSession.size,
        });
    }
    const proofStartMatch = url.pathname.match(/^\/sessions\/([^/]+)\/send-proof-start$/);
    if (proofStartMatch && req.method === "POST") {
        if (!isInternalAuthorized(req)) return json(res, 401, { error: "Unauthorized" });
        const bridgeSessionId = decodeURIComponent(proofStartMatch[1]);
        const device = devicesByBridgeSession.get(bridgeSessionId);
        if (!device || device.ws.readyState !== WebSocket.OPEN) {
            return json(res, 503, { error: "Assigned Android tunnel is offline" });
        }
        if (!await hasCurrentRuntimeOwnership(device)) {
            void disconnectDevice(device, "Runtime ownership was fenced");
            return json(res, 503, { error: "Device tunnel runtime ownership is unavailable" });
        }
        const now = new Date();
        for (const [nonce, snapshot] of device.proofStarts) {
            if (now.getTime() - snapshot.startedAt.getTime() > 120_000) device.proofStarts.delete(nonce);
        }
        const proofNonce = randomUUID();
        device.proofStarts.set(proofNonce, {
            startedAt: now,
            bytesToDevice: device.bytesToDevice,
            bytesFromDevice: device.bytesFromDevice,
        });
        return json(res, 200, { proofNonce });
    }
    const proofMatch = url.pathname.match(/^\/sessions\/([^/]+)\/verify-send$/);
    if (proofMatch && req.method === "POST") {
        if (!isInternalAuthorized(req)) return json(res, 401, { error: "Unauthorized" });
        const bridgeSessionId = decodeURIComponent(proofMatch[1]);
        const device = devicesByBridgeSession.get(bridgeSessionId);
        if (!device || device.ws.readyState !== WebSocket.OPEN) {
            return json(res, 503, { error: "Assigned Android tunnel is offline" });
        }
        if (!await hasCurrentRuntimeOwnership(device)) {
            void disconnectDevice(device, "Runtime ownership was fenced");
            return json(res, 503, { error: "Device tunnel runtime ownership is unavailable" });
        }
        const body = await readSmallJson(req).catch(() => null);
        const messageId = String(body?.messageId || "").trim();
        const proofNonce = String(body?.proofNonce || "").trim();
        if (!messageId || !proofNonce) return json(res, 400, { error: "Missing messageId or proofNonce" });
        const snapshot = device.proofStarts.get(proofNonce);
        device.proofStarts.delete(proofNonce);
        if (!snapshot) {
            return json(res, 409, { error: "Send proof window expired" });
        }
        const trafficAt = device.lastBrowserTrafficAt;
        const traffic = calculateTunnelSendProof({
            snapshot,
            now: new Date(),
            lastBrowserTrafficAt: trafficAt,
            bytesToDevice: device.bytesToDevice,
            bytesFromDevice: device.bytesFromDevice,
        });
        if (!traffic || !trafficAt) {
            return json(res, 409, { error: "No browser traffic crossed the Android tunnel during this send" });
        }
        const { bytesToDevice, bytesFromDevice } = traffic;
        const verifiedAt = new Date();
        const messageHash = createHash("sha256").update(messageId).digest("hex").slice(0, 16);
        const persisted = await (db as any).deviceTunnelBinding.updateMany({
            where: {
                id: device.bindingId,
                locationId: device.locationId,
                ...(device.ownership ? { sessionId: device.ownership.sessionId } : {}),
                gatewayNodeId: GATEWAY_NODE_ID,
                assignmentEpoch: device.assignmentEpoch,
                ...runtimeLeaseFilter(device),
            },
            data: {
                lastTrafficAt: trafficAt,
                lastVerifiedAt: verifiedAt,
                lastProofMessageHash: messageHash,
                lastProofBytesToDevice: bytesToDevice,
                lastProofBytesFromDevice: bytesFromDevice,
            },
        }).catch(() => null);
        if (Number(persisted?.count || 0) !== 1) return json(res, 409, { error: "Tunnel ownership changed before proof persistence" });
        const binding = await (db as any).deviceTunnelBinding.findUnique({
            where: { id: device.bindingId },
            select: { egressIpMasked: true, networkType: true, gatewayNodeId: true },
        }).catch(() => null);
        if (!binding) return json(res, 500, { error: "Could not read tunnel send proof" });
        return json(res, 200, {
            verified: true,
            verifiedAt: verifiedAt.toISOString(),
            trafficAt: trafficAt.toISOString(),
            messageHash,
            bytesToDevice: bytesToDevice.toString(),
            bytesFromDevice: bytesFromDevice.toString(),
            egressIpMasked: binding.egressIpMasked,
            networkType: binding.networkType,
            gatewayNodeId: binding.gatewayNodeId,
        });
    }
    const sessionMatch = url.pathname.match(/^\/sessions\/([^/]+)$/);
    if (sessionMatch && req.method === "GET") {
        if (!isInternalAuthorized(req)) return json(res, 401, { error: "Unauthorized" });
        const bridgeSessionId = decodeURIComponent(sessionMatch[1]);
        const device = devicesByBridgeSession.get(bridgeSessionId);
        if (!device || device.ws.readyState !== WebSocket.OPEN) {
            return json(res, 503, { error: "Assigned Android tunnel is offline" });
        }
        if (!await hasCurrentRuntimeOwnership(device)) {
            void disconnectDevice(device, "Runtime ownership was fenced");
            return json(res, 503, { error: "Device tunnel runtime ownership is unavailable" });
        }
        return json(res, 200, {
            ready: true,
            proxyHost: "127.0.0.1",
            proxyPort: device.proxyPort,
            bindingId: device.bindingId,
            gatewayGeneration: GATEWAY_GENERATION,
            ...(device.ownership ? { ownership: device.ownership } : {}),
        });
    }
    return json(res, 404, { error: "Not found" });
});

const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_FRAME_BYTES });
server.on("upgrade", (req, socket, head) => {
    const url = new URL(req.url || "/", `http://${req.headers.host || "127.0.0.1"}`);
    if (url.pathname !== "/v1/device") return socket.destroy();
    wss.handleUpgrade(req, socket, head, (ws) => {
        void acceptDevice(ws, req).catch((error) => {
            console.warn("[Device Tunnel] Rejected device connection:", error?.message || error);
            ws.close(4003, "Unauthorized tunnel connection");
        });
    });
});

async function startGateway() {
    await registerDeviceTunnelGatewayNode(db as any, {
        id: GATEWAY_NODE_ID,
        region: GATEWAY_REGION,
        publicUrl: GATEWAY_PUBLIC_URL,
        internalUrl: GATEWAY_INTERNAL_URL,
        capacitySessions: GATEWAY_CAPACITY_SESSIONS,
        version: GATEWAY_VERSION,
        startedAt: GATEWAY_STARTED_AT,
        metadata: { runtime: "device-tunnel-gateway" },
    });
    server.listen(PORT, "127.0.0.1", () => {
        console.log(`[Device Tunnel] Gateway ${GATEWAY_NODE_ID} listening on 127.0.0.1:${PORT}`);
    });
}

void startGateway().catch((error) => {
    console.error("[Device Tunnel] Gateway node registration failed:", error?.message || error);
    process.exitCode = 1;
});

setInterval(() => {
    if (!RUNTIME_LEASE_ENFORCEMENT) return;
    for (const device of devicesByBridgeSession.values()) {
        if (!device.ownership || device.renewalInFlight || !device.renewalFence.canAcceptWork) continue;
        if (!device.leaseExpiresAt || device.leaseExpiresAt <= new Date()) {
            void disconnectDevice(device, "Runtime lease expired");
            continue;
        }
        device.renewalInFlight = true;
        void renewDeviceTunnelSessionLease({
            store: leaseStore,
            locationId: device.locationId,
            sessionId: device.ownership.sessionId,
            bindingId: device.bindingId,
            gatewayNodeId: GATEWAY_NODE_ID,
            assignmentEpoch: device.assignmentEpoch,
            ownerInstanceId: device.ownership.ownerInstanceId,
            epoch: device.ownership.leaseEpoch,
            ttlMs: RUNTIME_LEASE_TTL_MS,
        }).then((renewed) => {
            if (renewed) {
                device.leaseExpiresAt = renewed.expiresAt;
                device.renewalFence.recordSuccess();
                return;
            }
            device.renewalFence.recordFailure();
        }).catch(() => {
            device.renewalFence.recordFailure();
        }).finally(() => {
            device.renewalInFlight = false;
        });
    }
}, RUNTIME_LEASE_RENEW_INTERVAL_MS).unref?.();

setInterval(() => {
    void heartbeatDeviceTunnelGatewayNode({
        db: db as any,
        nodeId: GATEWAY_NODE_ID,
        startedAt: GATEWAY_STARTED_AT,
        activeSessions: devicesByBridgeSession.size,
    }).then((updated) => {
        if (!updated) {
            console.warn(`[Device Tunnel] Gateway node ${GATEWAY_NODE_ID} heartbeat was fenced`);
            if (RUNTIME_LEASE_ENFORCEMENT) {
                for (const device of devicesByBridgeSession.values()) void disconnectDevice(device, "Gateway node heartbeat was fenced");
            }
        }
    }).catch((error) => {
        console.warn("[Device Tunnel] Gateway node heartbeat failed:", error?.message || error);
    });
}, 15_000).unref?.();

setInterval(() => {
    for (const device of devicesByBridgeSession.values()) {
        if (device.ws.readyState === WebSocket.OPEN) {
            device.ws.send(JSON.stringify({ type: "ping" }));
        }
    }
}, 20_000).unref?.();

let draining = false;
async function drainGateway() {
    if (draining) return;
    draining = true;
    await (db as any).deviceTunnelGatewayNode.updateMany({
        where: { id: GATEWAY_NODE_ID, startedAt: GATEWAY_STARTED_AT, status: "online" },
        data: { status: "draining", lastHeartbeatAt: new Date() },
    }).catch(() => null);
    await Promise.all(Array.from(devicesByBridgeSession.values()).map((device) => disconnectDevice(device, "Gateway node is draining")));
    server.close();
}

process.once("SIGTERM", () => void drainGateway());
process.once("SIGINT", () => void drainGateway());
