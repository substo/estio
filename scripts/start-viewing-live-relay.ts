#!/usr/bin/env tsx
import { randomUUID } from "crypto";
import { createServer } from "http";
import { URL } from "url";
import { GoogleGenAI, Modality } from "@google/genai";
import { resolveLocationGoogleAiApiKey } from "@/lib/ai/location-google-key";
import db from "@/lib/db";
import { assembleViewingSessionContext } from "@/lib/viewings/sessions/context-assembler";
import { sanitizeLiveToolOutputValue } from "@/lib/viewings/sessions/redaction";
import { verifyViewingSessionAccessToken } from "@/lib/viewings/sessions/security";
import { isViewingLiveToolAllowed } from "@/lib/viewings/sessions/tool-policy";

const WebSocketLib = require("ws");
const WebSocketServer = WebSocketLib.WebSocketServer;

type RelayConnectionState = {
    sessionId: string;
    locationId: string;
    role: "client" | "agent";
    relaySessionToken: string;
    lastPongAt: number;
};

type RelayDraftPointer = {
    sourceMessageId: string;
    messageId: string | null;
};

type RelayContext = {
    sessionId: string;
    locationId: string;
    role: "client" | "agent";
    relaySessionToken: string;
    modelName: string;
    sockets: Set<any>;
    vendorSession: any | null;
    vendorState: "idle" | "connecting" | "connected" | "reconnecting" | "degraded" | "failed" | "disconnected";
    reconnectAttempts: number;
    reconnectTimer: NodeJS.Timeout | null;
    idleCloseTimer: NodeJS.Timeout | null;
    sequence: number;
    inputDraft: RelayDraftPointer | null;
    outputDraft: RelayDraftPointer | null;
    sessionResumptionHandle: string | null;
    reconnectCycleStartedAt: number | null;
    toolCallTimestamps: number[];
    activeToolCalls: number;
    toolCache: Map<string, { expiresAt: number; result: Record<string, unknown> }>;
    queue: Promise<void>;
};

const RELAY_CONTEXTS = new Map<string, RelayContext>();

const RELAY_HOST = String(process.env.VIEWING_SESSION_RELAY_HOST || "0.0.0.0").trim();
const RELAY_PORT = Math.max(1, Math.min(65535, Number(process.env.VIEWING_SESSION_RELAY_PORT || 8788)));
const RELAY_PATH = String(process.env.VIEWING_SESSION_RELAY_WS_PATH || "/ws").trim() || "/ws";
const APP_BASE_URL = String(
    process.env.VIEWING_SESSION_RELAY_APP_BASE_URL
    || process.env.APP_BASE_URL
    || process.env.NEXT_PUBLIC_APP_URL
    || "http://127.0.0.1:3000"
).trim().replace(/\/$/, "");
const HEARTBEAT_INTERVAL_MS = 20_000;
const HEARTBEAT_TIMEOUT_MS = 45_000;
const RECONNECT_BASE_DELAY_MS = 1_000;
const RECONNECT_MAX_DELAY_MS = 15_000;
const RECONNECT_MAX_ATTEMPTS = 5;
const RECONNECT_MAX_TOTAL_MS = 60_000;
const IDLE_CLOSE_DELAY_MS = 30_000;
const TOOL_CALLS_PER_MINUTE = 6;
const TOOL_MAX_CONCURRENCY = 2;
const TOOL_TIMEOUT_MS = 4_000;
const TOOL_CACHE_TTL_MS = {
    resolve_viewing_property_context: 60_000,
    fetch_company_playbook: 60_000,
    search_related_properties: 30_000,
} as const;

function asString(value: unknown): string {
    return String(value || "").trim();
}

function clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
}

function sendJson(ws: any, payload: Record<string, unknown>) {
    if (!ws || ws.readyState !== ws.OPEN) return;
    ws.send(JSON.stringify(payload));
}

function broadcast(context: RelayContext, payload: Record<string, unknown>) {
    for (const ws of context.sockets) {
        sendJson(ws, payload);
    }
}

function normalizeEventPayload(raw: unknown) {
    if (!raw || typeof raw !== "object") return null;
    const payload = raw as Record<string, unknown>;
    if (typeof payload.eventType === "string") return payload;
    if (typeof payload.type === "string") {
        return {
            ...payload,
            eventType: payload.type,
        };
    }
    return null;
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, errorMessage: string): Promise<T> {
    let timer: NodeJS.Timeout | null = null;
    return new Promise<T>((resolve, reject) => {
        timer = setTimeout(() => {
            timer = null;
            reject(new Error(errorMessage));
        }, timeoutMs);

        promise
            .then((value) => {
                if (timer) clearTimeout(timer);
                resolve(value);
            })
            .catch((error) => {
                if (timer) clearTimeout(timer);
                reject(error);
            });
    });
}

function pruneToolCallWindow(context: RelayContext, now: number) {
    context.toolCallTimestamps = context.toolCallTimestamps.filter((ts) => now - ts < 60_000);
}

function getToolCacheKey(toolName: string, args: Record<string, unknown>): string {
    return `${toolName}:${JSON.stringify(args || {})}`;
}

async function forwardRelayEvent(args: {
    sessionId: string;
    relaySessionToken: string;
    payload: Record<string, unknown>;
}) {
    const url = `${APP_BASE_URL}/api/viewings/sessions/${encodeURIComponent(args.sessionId)}/relay?accessToken=${encodeURIComponent(args.relaySessionToken)}`;
    const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(args.payload),
    });
    const json = await response.json().catch(() => null);
    if (!response.ok) {
        throw new Error(asString((json as any)?.error) || `Relay ingestion failed (${response.status})`);
    }
    return json as Record<string, any>;
}

async function forwardTransportStatus(
    context: RelayContext,
    status: "connecting" | "connected" | "reconnecting" | "degraded" | "failed" | "disconnected",
    metadata?: Record<string, unknown>
) {
    const payload = status === "disconnected"
        ? {
            eventType: "disconnect",
            reason: asString(metadata?.reason) || "relay_disconnect",
            metadata: {
                source: "dedicated_relay_ws",
                ...(metadata || {}),
            },
        }
        : {
            eventType: "connect",
            transportStatus: status,
            metadata: {
                source: "dedicated_relay_ws",
                ...(metadata || {}),
            },
        };

    try {
        await forwardRelayEvent({
            sessionId: context.sessionId,
            relaySessionToken: context.relaySessionToken,
            payload,
        });
    } catch (error) {
        console.warn("[ViewingLiveRelay] Failed to forward transport status:", error);
    }
}

function extractRelayToken(req: any, requestUrl: URL): string | null {
    const authHeader = asString(req.headers?.authorization);
    if (authHeader.toLowerCase().startsWith("bearer ")) {
        const token = authHeader.slice("bearer ".length).trim();
        if (token) return token;
    }
    return asString(
        requestUrl.searchParams.get("relaySessionToken")
        || requestUrl.searchParams.get("accessToken")
        || requestUrl.searchParams.get("token")
    ) || null;
}

async function resolveSessionModelName(sessionId: string) {
    const session = await db.viewingSession.findUnique({
        where: { id: sessionId },
        select: {
            id: true,
            liveModel: true,
            mode: true,
        },
    });
    if (!session) {
        throw new Error("Viewing session not found for relay connection.");
    }
    return asString(session.liveModel) || "gemini-2.5-flash-native-audio-preview-12-2025";
}

function nextSourceMessageId(context: RelayContext, prefix: string): string {
    context.sequence += 1;
    return `${prefix}:${Date.now()}:${context.sequence}`;
}

async function persistTranscript(args: {
    context: RelayContext;
    channel: "input" | "output";
    speaker: "client" | "agent" | "system";
    text: string;
    isFinal: boolean;
    metadata?: Record<string, unknown>;
}) {
    const text = asString(args.text);
    if (!text) return;

    const context = args.context;
    const draftKey = args.channel === "input" ? "inputDraft" : "outputDraft";
    const previousDraft = context[draftKey];
    const sourceMessageId = nextSourceMessageId(
        context,
        `${args.channel}.${args.isFinal ? "final" : "provisional"}`
    );

    try {
        const result = await forwardRelayEvent({
            sessionId: context.sessionId,
            relaySessionToken: context.relaySessionToken,
            payload: {
                eventType: "transcript",
                speaker: args.speaker,
                sourceMessageId,
                text,
                origin: "relay_live_transcript",
                provider: "google",
                model: context.modelName,
                modelVersion: context.modelName,
                transcriptStatus: args.isFinal ? "final" : "provisional",
                supersedesMessageId: previousDraft?.messageId || null,
                metadata: {
                    channel: args.channel,
                    source: "gemini_live",
                    ...(args.metadata || {}),
                },
            },
        });

        const persistedMessageId = asString(result?.message?.id) || null;
        if (args.isFinal) {
            context[draftKey] = null;
        } else {
            context[draftKey] = {
                sourceMessageId,
                messageId: persistedMessageId,
            };
        }
    } catch (error) {
        console.warn("[ViewingLiveRelay] Failed to persist transcript chunk:", error);
    }
}

async function persistToolResult(args: {
    context: RelayContext;
    toolName: string;
    toolCallId: string;
    result: Record<string, unknown>;
    error?: string | null;
}) {
    try {
        await forwardRelayEvent({
            sessionId: args.context.sessionId,
            relaySessionToken: args.context.relaySessionToken,
            payload: {
                eventType: "tool_result",
                sourceMessageId: nextSourceMessageId(args.context, `tool.${args.toolName}`),
                text: JSON.stringify({
                    output: args.result,
                    error: args.error || null,
                }),
                provider: "google",
                model: args.context.modelName,
                modelVersion: args.context.modelName,
                metadata: {
                    toolName: args.toolName,
                    toolCallId: args.toolCallId,
                    source: "gemini_live",
                    error: args.error || null,
                },
            },
        });
    } catch (error) {
        console.warn("[ViewingLiveRelay] Failed to persist tool result:", error);
    }
}

async function persistUsage(context: RelayContext, usageMetadata: any) {
    const inputTokens = Math.max(0, Number(usageMetadata?.promptTokenCount || 0));
    const outputTokens = Math.max(0, Number(usageMetadata?.candidatesTokenCount || 0));
    const totalTokens = Math.max(0, Number(usageMetadata?.totalTokenCount || (inputTokens + outputTokens)));
    if (totalTokens <= 0 && inputTokens <= 0 && outputTokens <= 0) return;

    try {
        await forwardRelayEvent({
            sessionId: context.sessionId,
            relaySessionToken: context.relaySessionToken,
            payload: {
                eventType: "usage",
                phase: "live_audio",
                provider: "google",
                model: context.modelName,
                inputTokens,
                outputTokens,
                totalTokens,
                metadata: {
                    source: "gemini_live",
                },
            },
        });
    } catch (error) {
        console.warn("[ViewingLiveRelay] Failed to persist usage metadata:", error);
    }
}

function getLiveFunctionDeclarations() {
    return [
        {
            name: "resolve_viewing_property_context",
            description: "Fetch the current viewing session context including lead profile and properties.",
            parametersJsonSchema: {
                type: "object",
                additionalProperties: false,
            },
        },
        {
            name: "search_related_properties",
            description: "Search read-only related properties by short query text.",
            parametersJsonSchema: {
                type: "object",
                additionalProperties: false,
                properties: {
                    query: { type: "string" },
                    limit: { type: "number" },
                },
            },
        },
        {
            name: "fetch_company_playbook",
            description: "Fetch company brand voice and sales playbook snippets.",
            parametersJsonSchema: {
                type: "object",
                additionalProperties: false,
            },
        },
    ];
}

async function executeReadOnlyTool(context: RelayContext, toolName: string, rawArgs: Record<string, unknown>) {
    if (!isViewingLiveToolAllowed(toolName)) {
        throw new Error("tool_not_allowed_in_read_only_live_mode");
    }

    if (toolName === "resolve_viewing_property_context") {
        const sessionContext = await assembleViewingSessionContext(context.sessionId);
        return {
            sessionContext,
        };
    }

    if (toolName === "search_related_properties") {
        const query = asString(rawArgs.query || rawArgs.search || "");
        const limit = clamp(Math.floor(Number(rawArgs.limit || 3)), 1, 8);

        const session = await db.viewingSession.findUnique({
            where: { id: context.sessionId },
            select: {
                primaryPropertyId: true,
            },
        });

        const properties = await db.property.findMany({
            where: {
                locationId: context.locationId,
                ...(session?.primaryPropertyId ? { id: { not: session.primaryPropertyId } } : {}),
                ...(query
                    ? {
                        OR: [
                            { title: { contains: query, mode: "insensitive" } },
                            { reference: { contains: query, mode: "insensitive" } },
                            { city: { contains: query, mode: "insensitive" } },
                        ],
                    }
                    : {}),
            },
            select: {
                id: true,
                title: true,
                reference: true,
                city: true,
                price: true,
                bedrooms: true,
                bathrooms: true,
                areaSqm: true,
            },
            orderBy: [{ updatedAt: "desc" }],
            take: limit,
        });

        return {
            query: query || null,
            results: properties,
        };
    }

    if (toolName === "fetch_company_playbook") {
        const [siteConfig, playbookEntries] = await Promise.all([
            db.siteConfig.findUnique({
                where: { locationId: context.locationId },
                select: {
                    brandVoice: true,
                    outreachConfig: true,
                },
            }),
            db.playbookEntry.findMany({
                select: {
                    id: true,
                    category: true,
                    text: true,
                    createdAt: true,
                },
                orderBy: [{ createdAt: "desc" }],
                take: 20,
            }),
        ]);

        return {
            brandVoice: siteConfig?.brandVoice || null,
            outreachConfig: siteConfig?.outreachConfig || null,
            playbookEntries: playbookEntries.map((entry) => ({
                id: entry.id,
                category: entry.category,
                text: entry.text,
                createdAt: entry.createdAt.toISOString(),
            })),
        };
    }

    throw new Error("unsupported_tool");
}

async function executeBoundedReadOnlyTool(context: RelayContext, toolName: string, rawArgs: Record<string, unknown>) {
    const now = Date.now();
    pruneToolCallWindow(context, now);

    if (context.toolCallTimestamps.length >= TOOL_CALLS_PER_MINUTE) {
        throw new Error("tool_rate_limit_exceeded");
    }
    if (context.activeToolCalls >= TOOL_MAX_CONCURRENCY) {
        throw new Error("tool_concurrency_limit_exceeded");
    }

    const cacheTtl = TOOL_CACHE_TTL_MS[toolName as keyof typeof TOOL_CACHE_TTL_MS] || 0;
    const cacheKey = cacheTtl > 0 ? getToolCacheKey(toolName, rawArgs) : "";
    if (cacheKey) {
        const cached = context.toolCache.get(cacheKey);
        if (cached && cached.expiresAt > now) {
            return cached.result;
        }
    }

    context.toolCallTimestamps.push(now);
    context.activeToolCalls += 1;
    try {
        const result = await withTimeout(
            executeReadOnlyTool(context, toolName, rawArgs),
            TOOL_TIMEOUT_MS,
            "tool_timeout"
        );
        if (cacheKey && cacheTtl > 0) {
            context.toolCache.set(cacheKey, {
                expiresAt: Date.now() + cacheTtl,
                result,
            });
        }
        return result;
    } finally {
        context.activeToolCalls = Math.max(0, context.activeToolCalls - 1);
    }
}

async function handleToolCalls(context: RelayContext, functionCalls: any[]) {
    if (!context.vendorSession || functionCalls.length === 0) return;

    const functionResponses: Array<Record<string, unknown>> = [];
    for (const call of functionCalls) {
        const toolName = asString(call?.name);
        const toolCallId = asString(call?.id) || randomUUID();
        const args = call?.args && typeof call.args === "object" ? call.args as Record<string, unknown> : {};

        let output: Record<string, unknown> = {};
        let toolError: string | null = null;
        try {
            const result = await executeBoundedReadOnlyTool(context, toolName, args);
            const sanitizedResult = sanitizeLiveToolOutputValue(result);
            output = {
                ok: true,
                result: sanitizedResult,
            };
        } catch (error: any) {
            toolError = asString(error?.message) || "tool_execution_failed";
            output = {
                ok: false,
                error: toolError,
            };

            if (toolError === "tool_timeout") {
                context.vendorState = "degraded";
                void forwardTransportStatus(context, "degraded", {
                    reason: "tool_timeout",
                    toolName: toolName || "unknown_tool",
                });
            }
        }

        await persistToolResult({
            context,
            toolName: toolName || "unknown_tool",
            toolCallId,
            result: output,
            error: toolError,
        });

        functionResponses.push({
            id: toolCallId,
            name: toolName || "unknown_tool",
            response: toolError
                ? { error: toolError, output }
                : { output },
        });
    }

    try {
        context.vendorSession.sendToolResponse({
            functionResponses,
        } as any);
    } catch (error) {
        console.warn("[ViewingLiveRelay] Failed to send tool responses back to Gemini:", error);
    }
}

function queueContextTask(context: RelayContext, task: () => Promise<void>) {
    context.queue = context.queue
        .then(task)
        .catch((error) => {
            console.warn("[ViewingLiveRelay] Context task failed:", error);
        });
}

function extractModelTextAndAudio(message: any): {
    text: string;
    audioChunks: Array<{ mimeType: string; data: string }>;
} {
    const parts = Array.isArray(message?.serverContent?.modelTurn?.parts)
        ? message.serverContent.modelTurn.parts
        : [];

    const textParts: string[] = [];
    const audioChunks: Array<{ mimeType: string; data: string }> = [];
    for (const part of parts) {
        const text = asString(part?.text);
        if (text) {
            textParts.push(text);
        }

        const mimeType = asString(part?.inlineData?.mimeType);
        const data = asString(part?.inlineData?.data);
        if (mimeType.startsWith("audio/") && data) {
            audioChunks.push({ mimeType, data });
        }
    }

    return {
        text: textParts.join(" ").trim(),
        audioChunks,
    };
}

function scheduleReconnect(context: RelayContext) {
    if (context.reconnectTimer) return;
    if (context.sockets.size === 0) return;

    const now = Date.now();
    if (!context.reconnectCycleStartedAt) {
        context.reconnectCycleStartedAt = now;
    }

    const attempt = context.reconnectAttempts + 1;
    const reconnectElapsedMs = now - context.reconnectCycleStartedAt;
    if (attempt > RECONNECT_MAX_ATTEMPTS || reconnectElapsedMs > RECONNECT_MAX_TOTAL_MS) {
        context.vendorState = "failed";
        void forwardTransportStatus(context, "failed", {
            reason: attempt > RECONNECT_MAX_ATTEMPTS ? "reconnect_attempt_budget_exceeded" : "reconnect_time_budget_exceeded",
            reconnectAttempts: context.reconnectAttempts,
            reconnectElapsedMs,
        });
        broadcast(context, {
            type: "relay.vendor.failed",
            reason: attempt > RECONNECT_MAX_ATTEMPTS ? "reconnect_attempt_budget_exceeded" : "reconnect_time_budget_exceeded",
            reconnectAttempts: context.reconnectAttempts,
            reconnectElapsedMs,
            ts: new Date().toISOString(),
        });
        return;
    }

    context.reconnectAttempts = attempt;
    const delay = clamp(RECONNECT_BASE_DELAY_MS * (2 ** (attempt - 1)), RECONNECT_BASE_DELAY_MS, RECONNECT_MAX_DELAY_MS);

    context.reconnectTimer = setTimeout(() => {
        context.reconnectTimer = null;
        void connectVendorSession(context, true);
    }, delay);
}

function clearReconnectTimer(context: RelayContext) {
    if (!context.reconnectTimer) return;
    clearTimeout(context.reconnectTimer);
    context.reconnectTimer = null;
}

function clearIdleCloseTimer(context: RelayContext) {
    if (!context.idleCloseTimer) return;
    clearTimeout(context.idleCloseTimer);
    context.idleCloseTimer = null;
}

function scheduleIdleClose(context: RelayContext) {
    clearIdleCloseTimer(context);
    context.idleCloseTimer = setTimeout(() => {
        context.idleCloseTimer = null;
        if (context.sockets.size > 0) return;

        if (context.vendorSession) {
            try {
                context.vendorSession.close();
            } catch {
                // no-op
            }
            context.vendorSession = null;
        }

        context.vendorState = "disconnected";
        context.reconnectCycleStartedAt = null;
        void forwardTransportStatus(context, "disconnected", {
            reason: "no_active_clients",
        });
        RELAY_CONTEXTS.delete(context.sessionId);
    }, IDLE_CLOSE_DELAY_MS);
}

async function connectVendorSession(context: RelayContext, reconnecting: boolean) {
    if (context.vendorSession) return;

    clearReconnectTimer(context);
    context.vendorState = reconnecting ? "reconnecting" : "connecting";
    await forwardTransportStatus(
        context,
        reconnecting ? "reconnecting" : "connecting",
        { reconnecting }
    );

    try {
        const apiKey = await resolveLocationGoogleAiApiKey(context.locationId);
        if (!apiKey) {
            context.vendorState = "failed";
            await forwardTransportStatus(context, "failed", {
                reason: "missing_location_google_ai_key",
            });
            broadcast(context, {
                type: "relay.error",
                code: "MISSING_VENDOR_CREDENTIALS",
                error: "Google AI key is not configured for this location.",
            });
            return;
        }

        const ai = new GoogleGenAI({ apiKey });
        const session = await ai.live.connect({
            model: context.modelName,
            config: {
                responseModalities: [Modality.AUDIO, Modality.TEXT],
                inputAudioTranscription: {},
                outputAudioTranscription: {},
                temperature: 0.2,
                sessionResumption: context.sessionResumptionHandle
                    ? { handle: context.sessionResumptionHandle, transparent: true }
                    : { transparent: true },
                tools: [
                    {
                        functionDeclarations: getLiveFunctionDeclarations(),
                    },
                ],
            },
            callbacks: {
                onopen: () => {
                    context.vendorState = "connected";
                    context.reconnectAttempts = 0;
                    context.reconnectCycleStartedAt = null;
                    void forwardTransportStatus(context, "connected", {
                        reconnecting,
                        model: context.modelName,
                    });
                    broadcast(context, {
                        type: "relay.vendor.connected",
                        model: context.modelName,
                        reconnecting,
                        ts: new Date().toISOString(),
                    });
                },
                onmessage: (message: any) => {
                    queueContextTask(context, async () => {
                        const resumable = message?.sessionResumptionUpdate?.resumable;
                        const newHandle = asString(message?.sessionResumptionUpdate?.newHandle);
                        if (resumable !== false && newHandle) {
                            context.sessionResumptionHandle = newHandle;
                        }

                        const inputTranscriptionText = asString(message?.serverContent?.inputTranscription?.text);
                        if (inputTranscriptionText) {
                            await persistTranscript({
                                context,
                                channel: "input",
                                speaker: context.role === "agent" ? "agent" : "client",
                                text: inputTranscriptionText,
                                isFinal: !!message?.serverContent?.inputTranscription?.finished,
                                metadata: {
                                    transcriptionKind: "input",
                                },
                            });
                        }

                        const outputTranscriptionText = asString(message?.serverContent?.outputTranscription?.text);
                        if (outputTranscriptionText) {
                            await persistTranscript({
                                context,
                                channel: "output",
                                speaker: "system",
                                text: outputTranscriptionText,
                                isFinal: !!message?.serverContent?.outputTranscription?.finished,
                                metadata: {
                                    transcriptionKind: "output",
                                },
                            });
                        }

                        const { text: modelText, audioChunks } = extractModelTextAndAudio(message);
                        const turnComplete = !!message?.serverContent?.turnComplete || !!message?.serverContent?.generationComplete;

                        if (modelText && !outputTranscriptionText) {
                            await persistTranscript({
                                context,
                                channel: "output",
                                speaker: "system",
                                text: modelText,
                                isFinal: turnComplete,
                                metadata: {
                                    source: "model_turn",
                                },
                            });
                        }

                        for (const chunk of audioChunks) {
                            broadcast(context, {
                                type: "relay.audio.chunk",
                                mimeType: chunk.mimeType,
                                data: chunk.data,
                                ts: new Date().toISOString(),
                            });
                        }

                        const functionCalls = Array.isArray(message?.toolCall?.functionCalls)
                            ? message.toolCall.functionCalls
                            : [];
                        if (functionCalls.length > 0) {
                            await handleToolCalls(context, functionCalls);
                        }

                        if (message?.usageMetadata) {
                            await persistUsage(context, message.usageMetadata);
                        }

                        if (message?.goAway) {
                            broadcast(context, {
                                type: "relay.vendor.go_away",
                                payload: message.goAway,
                                ts: new Date().toISOString(),
                            });
                            await forwardTransportStatus(context, "reconnecting", {
                                reason: "vendor_go_away",
                                goAway: message.goAway,
                            });
                            try {
                                context.vendorSession?.close();
                            } catch {
                                // no-op
                            }
                        }
                    });
                },
                onerror: (error: any) => {
                    context.vendorState = "degraded";
                    broadcast(context, {
                        type: "relay.vendor.error",
                        error: asString(error?.message || error),
                        ts: new Date().toISOString(),
                    });
                    void forwardTransportStatus(context, "degraded", {
                        reason: "vendor_error",
                        error: asString(error?.message || error),
                    });
                },
                onclose: () => {
                    context.vendorSession = null;
                    if (context.sockets.size > 0) {
                        context.vendorState = "reconnecting";
                        void forwardTransportStatus(context, "reconnecting", {
                            reason: "vendor_socket_closed",
                        });
                        scheduleReconnect(context);
                        return;
                    }

                    context.vendorState = "disconnected";
                    context.reconnectCycleStartedAt = null;
                    void forwardTransportStatus(context, "disconnected", {
                        reason: "vendor_socket_closed",
                    });
                },
            },
        });

        context.vendorSession = session;
    } catch (error) {
        context.vendorSession = null;
        context.vendorState = "reconnecting";
        if (!context.reconnectCycleStartedAt) {
            context.reconnectCycleStartedAt = Date.now();
        }
        await forwardTransportStatus(context, "reconnecting", {
            reason: "vendor_connect_failed",
            error: asString((error as any)?.message || error),
        });
        broadcast(context, {
            type: "relay.vendor.connect_failed",
            error: asString((error as any)?.message || error),
            ts: new Date().toISOString(),
        });
        scheduleReconnect(context);
    }
}

async function ensureRelayContext(connectionState: RelayConnectionState): Promise<RelayContext> {
    const existing = RELAY_CONTEXTS.get(connectionState.sessionId);
    if (existing) {
        existing.relaySessionToken = connectionState.relaySessionToken;
        existing.role = connectionState.role;
        return existing;
    }

    const modelName = await resolveSessionModelName(connectionState.sessionId);
    const created: RelayContext = {
        sessionId: connectionState.sessionId,
        locationId: connectionState.locationId,
        role: connectionState.role,
        relaySessionToken: connectionState.relaySessionToken,
        modelName,
        sockets: new Set(),
        vendorSession: null,
        vendorState: "idle",
        reconnectAttempts: 0,
        reconnectTimer: null,
        idleCloseTimer: null,
        sequence: 0,
        inputDraft: null,
        outputDraft: null,
        sessionResumptionHandle: null,
        reconnectCycleStartedAt: null,
        toolCallTimestamps: [],
        activeToolCalls: 0,
        toolCache: new Map(),
        queue: Promise.resolve(),
    };

    RELAY_CONTEXTS.set(connectionState.sessionId, created);
    return created;
}

function maybeSendTranscriptToVendor(context: RelayContext, payload: Record<string, unknown>) {
    if (!context.vendorSession) return;
    if (asString(payload.eventType) !== "transcript") return;

    const text = asString(payload.text);
    if (!text) return;

    const speaker = asString(payload.speaker) || context.role;
    const liveInputText = speaker === "agent" ? `Agent says: ${text}` : text;
    try {
        context.vendorSession.sendClientContent({
            turns: [{ role: "user", parts: [{ text: liveInputText }] }],
            turnComplete: true,
        } as any);
    } catch (error) {
        console.warn("[ViewingLiveRelay] Failed to send transcript content to Gemini:", error);
    }
}

function maybeSendRealtimeAudioToVendor(context: RelayContext, payload: Record<string, unknown>) {
    if (!context.vendorSession) return;

    const eventType = asString(payload.eventType);
    if (eventType !== "realtime_audio" && eventType !== "audio_input") return;
    if (context.role !== "client") {
        throw new Error("Agent microphone streaming is out of scope for this rollout.");
    }

    const mimeType = asString(payload.mimeType) || "audio/pcm;rate=16000";
    const base64 = asString(payload.data || payload.base64 || "");
    const audioStreamEnd = payload.audioStreamEnd === true;

    try {
        context.vendorSession.sendRealtimeInput({
            ...(base64 ? { audio: { mimeType, data: base64 } } : {}),
            ...(audioStreamEnd ? { audioStreamEnd: true } : {}),
        } as any);
    } catch (error) {
        throw new Error(asString((error as any)?.message || error) || "Failed to forward realtime audio.");
    }
}

async function bootstrap() {
    const server = createServer((req, res) => {
        if (req.url === "/health") {
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ ok: true, role: "viewing-live-relay", contexts: RELAY_CONTEXTS.size }));
            return;
        }
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: false, error: "Not found" }));
    });

    const wss = new WebSocketServer({
        noServer: true,
        path: RELAY_PATH,
        perMessageDeflate: false,
    });

    wss.on("connection", async (ws: any, req: any, connectionState: RelayConnectionState) => {
        const context = await ensureRelayContext(connectionState);
        context.sockets.add(ws);
        context.relaySessionToken = connectionState.relaySessionToken;
        clearIdleCloseTimer(context);

        (ws as any).__relayState = connectionState;
        sendJson(ws, {
            type: "relay.connected",
            sessionId: connectionState.sessionId,
            locationId: connectionState.locationId,
            role: connectionState.role,
            model: context.modelName,
            ts: new Date().toISOString(),
        });

        if (context.vendorSession) {
            if (context.vendorState === "degraded" || context.vendorState === "connected") {
                context.vendorState = "connected";
                void forwardTransportStatus(context, "connected", {
                    reason: "client_rejoined",
                });
            }
        } else {
            void connectVendorSession(context, false);
        }

        ws.on("message", async (raw: Buffer) => {
            try {
                const parsed = JSON.parse(String(raw || ""));
                const payload = normalizeEventPayload(parsed);
                if (!payload) {
                    sendJson(ws, {
                        type: "relay.error",
                        error: "Invalid payload. Expected { eventType: ... }",
                    });
                    return;
                }

                // Internal/native audio relay events are handled in-process.
                const eventType = asString(payload.eventType);
                if (eventType === "realtime_audio" || eventType === "audio_input") {
                    if (!context.vendorSession) {
                        await connectVendorSession(context, context.vendorState === "reconnecting");
                    }
                    maybeSendRealtimeAudioToVendor(context, payload);
                    sendJson(ws, {
                        type: "relay.ack",
                        eventType,
                        accepted: true,
                        forwardedTo: "gemini_live",
                        ts: new Date().toISOString(),
                    });
                    return;
                }

                // For transcript events, we persist first (source of truth) and also send to live vendor.
                if (eventType === "transcript") {
                    if (!context.vendorSession) {
                        await connectVendorSession(context, context.vendorState === "reconnecting");
                    }
                    maybeSendTranscriptToVendor(context, payload);
                }

                const result = await forwardRelayEvent({
                    sessionId: context.sessionId,
                    relaySessionToken: context.relaySessionToken,
                    payload,
                });

                sendJson(ws, {
                    type: "relay.ack",
                    eventType,
                    result,
                    ts: new Date().toISOString(),
                });
            } catch (error) {
                sendJson(ws, {
                    type: "relay.error",
                    error: asString((error as any)?.message || error),
                });
            }
        });

        ws.on("pong", () => {
            connectionState.lastPongAt = Date.now();
        });

        ws.on("close", () => {
            context.sockets.delete(ws);
            if (context.sockets.size > 0) return;

            context.vendorState = "degraded";
            void forwardTransportStatus(context, "degraded", {
                reason: "all_clients_disconnected",
            });
            scheduleIdleClose(context);
        });
    });

    server.on("upgrade", async (req, socket, head) => {
        try {
            const url = new URL(String(req.url || "/"), `http://${req.headers.host || "localhost"}`);
            if (url.pathname !== RELAY_PATH) {
                socket.destroy();
                return;
            }

            const relaySessionToken = extractRelayToken(req, url);
            if (!relaySessionToken) {
                socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
                socket.destroy();
                return;
            }

            const payload = verifyViewingSessionAccessToken(relaySessionToken);
            if (!payload?.sessionId || !payload?.locationId || !payload?.role) {
                socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
                socket.destroy();
                return;
            }

            const state: RelayConnectionState = {
                sessionId: payload.sessionId,
                locationId: payload.locationId,
                role: payload.role,
                relaySessionToken,
                lastPongAt: Date.now(),
            };

            wss.handleUpgrade(req, socket, head, (ws: any) => {
                wss.emit("connection", ws, req, state);
            });
        } catch {
            socket.destroy();
        }
    });

    setInterval(() => {
        for (const ws of wss.clients) {
            const state = (ws as any).__relayState as RelayConnectionState | undefined;
            if (state && Date.now() - state.lastPongAt > HEARTBEAT_TIMEOUT_MS) {
                ws.terminate();
                continue;
            }
            try {
                ws.ping();
            } catch {
                ws.terminate();
            }
        }
    }, HEARTBEAT_INTERVAL_MS).unref();

    server.listen(RELAY_PORT, RELAY_HOST, () => {
        console.log(`[ViewingLiveRelay] Listening on ws://${RELAY_HOST}:${RELAY_PORT}${RELAY_PATH}`);
        console.log(`[ViewingLiveRelay] Forwarding persisted relay events to ${APP_BASE_URL}`);
        console.log("[ViewingLiveRelay] Vendor: Gemini Live (backend-owned)");
    });
}

bootstrap().catch((error) => {
    console.error("[ViewingLiveRelay] Failed to start:", error);
    process.exit(1);
});
