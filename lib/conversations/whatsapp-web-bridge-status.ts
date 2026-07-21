import db from "@/lib/db";
import { SETTINGS_DOMAINS } from "@/lib/settings/constants";
import { settingsService } from "@/lib/settings/service";
import {
    buildWhatsAppWebBridgeSessionId,
    getWhatsAppWebBridgeHealth,
    getWhatsAppWebBridgeSession,
    restartWhatsAppWebBridgeSession,
    startWhatsAppWebBridgeSession,
    upsertWhatsAppWebBridgeSession,
} from "@/lib/whatsapp/web-bridge";
import { getStaleWhatsAppWebBridgeNonReadyReason } from "@/lib/whatsapp/web-bridge-readiness";
import { findMatchingWhatsAppWebBridgeHealthSession } from "@/lib/whatsapp/web-bridge-diagnostics";

type LocationContext = {
    id: string;
};

export async function resolveLocationWhatsAppProviderMode(locationId: string) {
    const [doc, row] = await Promise.all([
        settingsService.getDocument<any>({
            scopeType: "LOCATION",
            scopeId: locationId,
            domain: SETTINGS_DOMAINS.LOCATION_INTEGRATIONS,
        }).catch(() => null),
        db.location.findUnique({
            where: { id: locationId },
            select: { whatsappProviderMode: true } as any,
        }).catch(() => null),
    ]);
    const mode = String(doc?.payload?.whatsappProviderMode || (row as any)?.whatsappProviderMode || "web_bridge");
    return mode === "evolution_linked" ? "web_bridge" : mode;
}

export function isStaleWebBridgeQrStatus(status: unknown, lastEventAt?: string | Date | null, lastSeenAt?: Date | null) {
    const normalized = String(status || "").toLowerCase();
    if (normalized !== "qr" && normalized !== "qrcode") return false;
    const value = lastEventAt || lastSeenAt;
    if (!value) return false;
    const timestamp = new Date(value).getTime();
    if (!Number.isFinite(timestamp)) return false;
    return Date.now() - timestamp > 90_000;
}

export function getStaleWebBridgeNonReadyReason(workerSession: any, lastSeenAt?: Date | null) {
    return getStaleWhatsAppWebBridgeNonReadyReason({
        status: workerSession?.status,
        ready: workerSession?.ready,
        lastEventAt: workerSession?.lastEventAt || lastSeenAt || null,
        startedAt: workerSession?.startedAt || null,
    });
}

export async function getWhatsAppWebBridgeStatusForLocation(location: LocationContext) {
    const mode = await resolveLocationWhatsAppProviderMode(location.id);

    const [session, health] = await Promise.all([
        getWhatsAppWebBridgeSession(location.id),
        getWhatsAppWebBridgeHealth().catch((error: any) => ({
            reachable: false,
            ok: false,
            baseUrl: "",
            error: error?.message || "WhatsApp Web Bridge is not reachable.",
            sessions: [],
        })),
    ]);
    const expectedSessionId = session?.sessionId || buildWhatsAppWebBridgeSessionId(location.id);
    const workerSession = findMatchingWhatsAppWebBridgeHealthSession({
        sessions: health.sessions,
        sessionId: expectedSessionId,
        locationId: location.id,
    });

    if (health.reachable && workerSession?.ready) {
        const now = new Date();
        const lastReadyAt = workerSession.lastReadyAt ? new Date(workerSession.lastReadyAt) : now;
        await upsertWhatsAppWebBridgeSession(location.id, {
            sessionId: workerSession.sessionId || expectedSessionId,
            status: "ready",
            qrCode: null,
            phone: workerSession.phone || session?.phone || null,
            lastReadyAt,
            lastSeenAt: now,
            lastError: null,
            isDefaultOutbound: true,
        }).catch((error: any) => {
            console.warn("[WhatsApp Web Bridge] Failed to repair ready DB session from worker health:", error?.message || error);
        });
        return {
            provider: "web_bridge" as const,
            mode,
            status: "ready",
            qrcode: null,
            phone: workerSession.phone || session?.phone || null,
            sessionId: workerSession.sessionId || expectedSessionId,
            lastSeenAt: workerSession.lastEventAt || session?.lastSeenAt?.toISOString?.() || null,
            lastReadyAt: workerSession.lastReadyAt || session?.lastReadyAt?.toISOString?.() || null,
            error: null as string | null,
        };
    }

    if (health.reachable && workerSession) {
        const workerStatus = String(workerSession.status || "starting");
        const staleQr = isStaleWebBridgeQrStatus(workerStatus, workerSession.lastEventAt, session?.lastSeenAt || null);
        const staleNonReadyReason = getStaleWebBridgeNonReadyReason(workerSession, session?.lastSeenAt || null);
        if (staleQr || staleNonReadyReason) {
            void restartWhatsAppWebBridgeSession(location.id).catch((error: any) => {
                console.warn("[WhatsApp Web Bridge] Background stale session refresh failed:", error?.message || error);
            });
            return {
                provider: "web_bridge" as const,
                mode,
                status: "reconnecting",
                qrcode: null,
                phone: workerSession.phone || session?.phone || null,
                sessionId: workerSession.sessionId || expectedSessionId,
                lastSeenAt: workerSession.lastEventAt || session?.lastSeenAt?.toISOString?.() || null,
                lastReadyAt: workerSession.lastReadyAt || session?.lastReadyAt?.toISOString?.() || null,
                error: staleNonReadyReason || "The previous QR expired. Generating a fresh code...",
            };
        }
        return {
            provider: "web_bridge" as const,
            mode,
            status: workerStatus,
            qrcode: workerStatus === "qr" ? (session?.qrCode || null) : null,
            phone: workerSession.phone || session?.phone || null,
            sessionId: workerSession.sessionId || expectedSessionId,
            lastSeenAt: workerSession.lastEventAt || session?.lastSeenAt?.toISOString?.() || null,
            lastReadyAt: workerSession.lastReadyAt || session?.lastReadyAt?.toISOString?.() || null,
            error: workerSession.lastError || null,
        };
    }

    if (session?.status === "ready" || session?.status === "authenticated" || session?.status === "starting") {
        void startWhatsAppWebBridgeSession(location.id).catch((error: any) => {
            console.warn("[WhatsApp Web Bridge] Background reconnect from status check failed:", error?.message || error);
        });
        return {
            provider: "web_bridge" as const,
            mode,
            status: "reconnecting",
            qrcode: null,
            phone: session?.phone || null,
            sessionId: session?.sessionId || expectedSessionId,
            lastSeenAt: session?.lastSeenAt?.toISOString?.() || null,
            lastReadyAt: session?.lastReadyAt?.toISOString?.() || null,
            error: health.error || null,
        };
    }

    return {
        provider: "web_bridge" as const,
        mode,
        status: session?.status || "disconnected",
        qrcode: session?.qrCode || null,
        phone: session?.phone || null,
        sessionId: session?.sessionId || null,
        lastSeenAt: session?.lastSeenAt?.toISOString?.() || null,
        lastReadyAt: session?.lastReadyAt?.toISOString?.() || null,
        error: session?.lastError || null,
    };
}
