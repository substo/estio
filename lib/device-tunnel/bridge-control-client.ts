import type { DeviceTunnelRuntimeOwnership } from "./runtime-ownership";

export type DeviceTunnelBridgeControlClient = {
    startSession(args: {
        sessionId: string;
        locationId: string;
        ownership: DeviceTunnelRuntimeOwnership | null;
    }): Promise<void>;
    fenceSession(args: {
        sessionId: string;
        ownership: DeviceTunnelRuntimeOwnership;
    }): Promise<boolean>;
};

export function createDeviceTunnelBridgeControlClient(args: {
    baseUrl: string;
    secret: string;
    fetchImpl?: typeof fetch;
    timeoutMs?: number;
}): DeviceTunnelBridgeControlClient {
    const baseUrl = String(args.baseUrl || "").replace(/\/+$/, "");
    const secret = String(args.secret || "").trim();
    const fetchImpl = args.fetchImpl || fetch;
    const timeoutMs = args.timeoutMs ?? 5_000;
    if (!baseUrl || !secret) throw new Error("bridge_control_configuration_invalid");
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 30_000) {
        throw new Error("bridge_control_timeout_invalid");
    }

    async function post(sessionId: string, action: string, body: unknown) {
        const normalizedSessionId = String(sessionId || "").trim();
        if (!normalizedSessionId) throw new Error("bridge_control_session_invalid");
        return fetchImpl(`${baseUrl}/sessions/${encodeURIComponent(normalizedSessionId)}/${action}`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "x-whatsapp-web-bridge-secret": secret,
            },
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(timeoutMs),
        });
    }

    return {
        async startSession({ sessionId, locationId, ownership }) {
            const response = await post(sessionId, "start", {
                locationId,
                ...(ownership ? { ownership } : {}),
            });
            if (!response.ok) throw new Error(`bridge_control_start_rejected_${response.status}`);
        },
        async fenceSession({ sessionId, ownership }) {
            const response = await post(sessionId, "fence", { ownership });
            return response.ok;
        },
    };
}
