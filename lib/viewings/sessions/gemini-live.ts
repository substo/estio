import { GoogleGenAI, Modality } from "@google/genai";
import { resolveLocationGoogleAiApiKey } from "@/lib/ai/location-google-key";
import { getLiveModeCapabilities, resolveLiveModelForMode } from "@/lib/viewings/sessions/live-models";
import type { ViewingSessionMode } from "@/lib/viewings/sessions/types";

export type ViewingLiveAuthPayload = {
    provider: "google_gemini_live";
    model: string;
    mode: ViewingSessionMode;
    capabilities: ReturnType<typeof getLiveModeCapabilities>;
    sessionLimits: {
        audioOnlyMinutes: number;
    };
    transport: {
        protocol: "websocket";
        inputAudioMimeType: "audio/pcm;rate=16000";
        outputAudioRateHz: number;
    };
    relay: {
        useBackendRelay: boolean;
        websocketUrl: string;
        connectionMode: "dedicated_process";
        requiresSessionToken: boolean;
        connectionOwner: "backend_relay_process";
        vendorCredentialsExposed: false;
    };
};

const DEFAULT_RELAY_WS_PATH = "/viewings-live-relay/ws";
const DEFAULT_RELAY_HEALTH_PATH = "/health";
const DEFAULT_RELAY_HOST = "127.0.0.1";
const DEFAULT_RELAY_PORT = 8788;
const DEFAULT_RELAY_HEALTH_TIMEOUT_MS = 2_500;
const LOOPBACK_HOSTS = new Set([
    "127.0.0.1",
    "localhost",
    "::1",
]);

export type ViewingLiveRelayConfig = {
    websocketUrl: string;
    healthcheckUrl: string;
    source: "env_explicit" | "app_base_url" | "request_origin" | "fallback_local";
};

function asString(value: unknown): string {
    return String(value || "").trim();
}

function ensureLeadingSlash(path: string): string {
    const normalized = asString(path);
    if (!normalized) return "/";
    return normalized.startsWith("/") ? normalized : `/${normalized}`;
}

function parseRelayPort(value: unknown): number {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return DEFAULT_RELAY_PORT;
    return Math.max(1, Math.min(65535, Math.floor(parsed)));
}

function normalizeOrigin(origin: string): string | null {
    const raw = asString(origin);
    if (!raw) return null;
    try {
        const parsed = new URL(raw);
        if (!parsed.protocol || !parsed.host) return null;
        return `${parsed.protocol}//${parsed.host}`;
    } catch {
        return null;
    }
}

function toWebsocketOrigin(origin: string): string {
    if (origin.startsWith("https://")) {
        return `wss://${origin.slice("https://".length)}`;
    }
    if (origin.startsWith("http://")) {
        return `ws://${origin.slice("http://".length)}`;
    }
    return origin;
}

function resolvePrimaryAppOrigin(): string | null {
    const fromAppBase = normalizeOrigin(process.env.APP_BASE_URL || "");
    if (fromAppBase) return fromAppBase;
    return normalizeOrigin(process.env.NEXT_PUBLIC_APP_URL || "");
}

function resolveRelayHealthcheckUrlFromEnv(): string {
    const explicit = asString(process.env.VIEWING_SESSION_BACKEND_RELAY_HEALTHCHECK_URL);
    if (explicit) return explicit;

    const host = asString(process.env.VIEWING_SESSION_RELAY_HEALTH_HOST)
        || asString(process.env.VIEWING_SESSION_RELAY_HOST)
        || DEFAULT_RELAY_HOST;
    const port = parseRelayPort(process.env.VIEWING_SESSION_RELAY_PORT);
    const path = ensureLeadingSlash(asString(process.env.VIEWING_SESSION_RELAY_HEALTH_PATH) || DEFAULT_RELAY_HEALTH_PATH);
    return `http://${host}:${port}${path}`;
}

function isLoopbackHost(hostname: string): boolean {
    return LOOPBACK_HOSTS.has(asString(hostname).toLowerCase());
}

export function relayWebsocketUrlTargetsLoopback(websocketUrl: string): boolean {
    const value = asString(websocketUrl);
    if (!value) return false;
    try {
        const parsed = new URL(value);
        return isLoopbackHost(parsed.hostname);
    } catch {
        return false;
    }
}

export function resolveViewingLiveRelayConfig(args?: {
    requestOrigin?: string | null;
}): ViewingLiveRelayConfig {
    const explicitRelayWs = asString(process.env.VIEWING_SESSION_BACKEND_RELAY_WS_URL);
    const relayPath = ensureLeadingSlash(asString(process.env.VIEWING_SESSION_BACKEND_RELAY_WS_PATH) || DEFAULT_RELAY_WS_PATH);
    const healthcheckUrl = resolveRelayHealthcheckUrlFromEnv();

    if (explicitRelayWs) {
        return {
            websocketUrl: explicitRelayWs,
            healthcheckUrl,
            source: "env_explicit",
        };
    }

    const appOrigin = resolvePrimaryAppOrigin();
    if (appOrigin) {
        return {
            websocketUrl: `${toWebsocketOrigin(appOrigin)}${relayPath}`,
            healthcheckUrl,
            source: "app_base_url",
        };
    }

    const requestOrigin = normalizeOrigin(args?.requestOrigin || "");
    if (requestOrigin) {
        return {
            websocketUrl: `${toWebsocketOrigin(requestOrigin)}${relayPath}`,
            healthcheckUrl,
            source: "request_origin",
        };
    }

    const port = parseRelayPort(process.env.VIEWING_SESSION_RELAY_PORT);
    return {
        websocketUrl: `ws://${DEFAULT_RELAY_HOST}:${port}/ws`,
        healthcheckUrl,
        source: "fallback_local",
    };
}

export async function validateViewingLiveRelayAvailability(args?: {
    requestOrigin?: string | null;
    timeoutMs?: number;
}): Promise<{
    ok: boolean;
    error?: string;
    relay: ViewingLiveRelayConfig & {
        httpStatus?: number;
    };
}> {
    const relay = resolveViewingLiveRelayConfig({
        requestOrigin: args?.requestOrigin || null,
    });
    const timeoutMs = Math.max(250, Number(args?.timeoutMs || DEFAULT_RELAY_HEALTH_TIMEOUT_MS));
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
        const response = await fetch(relay.healthcheckUrl, {
            method: "GET",
            cache: "no-store",
            signal: controller.signal,
        });
        const body = await response.json().catch(() => null);
        if (!response.ok) {
            return {
                ok: false,
                error: `Relay health check failed (${response.status}).`,
                relay: {
                    ...relay,
                    httpStatus: response.status,
                },
            };
        }
        if (body && body.ok === false) {
            return {
                ok: false,
                error: "Relay reported unhealthy status.",
                relay: {
                    ...relay,
                    httpStatus: response.status,
                },
            };
        }
        return {
            ok: true,
            relay: {
                ...relay,
                httpStatus: response.status,
            },
        };
    } catch (error: any) {
        const isTimeout = String(error?.name || "").toLowerCase() === "aborterror";
        return {
            ok: false,
            error: isTimeout
                ? `Relay health check timed out after ${timeoutMs}ms.`
                : String(error?.message || "Relay health check failed."),
            relay,
        };
    } finally {
        clearTimeout(timer);
    }
}

export async function buildViewingLiveAuthPayload(args: {
    locationId: string;
    mode: ViewingSessionMode;
    requestOrigin?: string | null;
}): Promise<ViewingLiveAuthPayload> {
    const relayConfig = resolveViewingLiveRelayConfig({
        requestOrigin: args.requestOrigin || null,
    });
    const model = resolveLiveModelForMode(args.mode);
    const capabilities = getLiveModeCapabilities(args.mode);

    return {
        provider: "google_gemini_live",
        model,
        mode: args.mode,
        capabilities,
        sessionLimits: {
            audioOnlyMinutes: 15,
        },
        transport: {
            protocol: "websocket",
            inputAudioMimeType: "audio/pcm;rate=16000",
            outputAudioRateHz: 24000,
        },
        relay: {
            useBackendRelay: true,
            websocketUrl: relayConfig.websocketUrl,
            connectionMode: "dedicated_process",
            requiresSessionToken: true,
            connectionOwner: "backend_relay_process",
            vendorCredentialsExposed: false,
        },
    };
}

// Small runtime health probe for backend credentials.
// This avoids exposing long-lived keys to the browser.
export async function validateGeminiLiveCredentialsForLocation(locationId: string): Promise<{
    ok: boolean;
    error?: string;
}> {
    const apiKey = await resolveLocationGoogleAiApiKey(locationId);
    if (!apiKey) {
        return { ok: false, error: "No Google AI API key configured for this location." };
    }

    try {
        const ai = new GoogleGenAI({ apiKey });
        // Lightweight no-op config sanity check (no network call).
        void ai;
        void Modality.AUDIO;
        return { ok: true };
    } catch (error: any) {
        return {
            ok: false,
            error: String(error?.message || "Failed to initialize Gemini Live client."),
        };
    }
}
