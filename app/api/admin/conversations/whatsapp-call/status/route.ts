import { NextResponse } from "next/server";
import { getLocationContext } from "@/lib/auth/location-context";
import db from "@/lib/db";
import { getWhatsAppCallBridgeBaseUrl } from "@/lib/whatsapp/calling";

function serializeError(error: unknown): string {
    if (error instanceof Error) return error.message;
    if (typeof error === "string") return error;
    return "WhatsApp call status failed.";
}

function asRecord(value: unknown): Record<string, any> {
    return value && typeof value === "object" && !Array.isArray(value)
        ? value as Record<string, any>
        : {};
}

async function bridgeFetchCall(input: {
    bridgeBaseUrl?: string | null;
    sessionId?: string | null;
    bridgeCallId?: string | null;
}) {
    if (!input.sessionId || !input.bridgeCallId) return null;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 900);
    try {
        const response = await fetch(
            `${getWhatsAppCallBridgeBaseUrl(input.bridgeBaseUrl)}/sessions/${encodeURIComponent(input.sessionId)}/calls/${encodeURIComponent(input.bridgeCallId)}`,
            {
                method: "GET",
                signal: controller.signal,
                headers: {
                    ...(process.env.WHATSAPP_CALL_BRIDGE_SECRET
                        ? { "x-whatsapp-call-bridge-secret": process.env.WHATSAPP_CALL_BRIDGE_SECRET }
                        : {}),
                },
            }
        );
        const payload = await response.json().catch(() => null);
        if (!response.ok || !payload?.success) return null;
        return payload;
    } catch {
        return null;
    } finally {
        clearTimeout(timeout);
    }
}

export async function GET(request: Request) {
    try {
        const location = await getLocationContext();
        if (!location) {
            return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
        }

        const url = new URL(request.url);
        const callAttemptId = String(url.searchParams.get("callAttemptId") || "").trim();
        const conversationId = String(url.searchParams.get("conversationId") || "").trim();
        const contactId = String(url.searchParams.get("contactId") || "").trim();

        if (!callAttemptId && (!conversationId || !contactId)) {
            return NextResponse.json(
                { success: false, error: "Missing callAttemptId or conversationId/contactId." },
                { status: 400 }
            );
        }

        const attempt = await (db as any).whatsAppCallAttempt.findFirst({
            where: {
                locationId: location.id,
                ...(callAttemptId
                    ? { id: callAttemptId }
                    : { conversationId, contactId }),
            },
            orderBy: { createdAt: "desc" },
            select: {
                id: true,
                createdAt: true,
                updatedAt: true,
                status: true,
                providerCallId: true,
                bridgeCallId: true,
                whatsappCallId: true,
                attemptedAt: true,
                endedAt: true,
                errorCode: true,
                errorMessage: true,
                metadata: true,
            },
        });

        if (!attempt) {
            return NextResponse.json({ success: false, error: "Call attempt not found." }, { status: 404 });
        }

        const config = await (db as any).whatsAppCallBridgeConfig.findUnique({
            where: { locationId: location.id },
            select: {
                bridgeBaseUrl: true,
                baileysSessionId: true,
            },
        }).catch(() => null);

        const metadata = asRecord(attempt.metadata);
        const bridgeEvent = asRecord(metadata.bridgeEvent);
        const bridgeResult = asRecord(metadata.bridgeResult);
        const bridgeCall = await bridgeFetchCall({
            bridgeBaseUrl: config?.bridgeBaseUrl,
            sessionId: config?.baileysSessionId || location.id,
            bridgeCallId: attempt.bridgeCallId,
        });

        return NextResponse.json({
            success: true,
            call: {
                id: attempt.id,
                createdAt: attempt.createdAt?.toISOString?.() || attempt.createdAt,
                updatedAt: attempt.updatedAt?.toISOString?.() || attempt.updatedAt,
                status: bridgeCall?.status || attempt.status,
                providerCallId: attempt.providerCallId,
                bridgeCallId: attempt.bridgeCallId,
                whatsappCallId: bridgeCall?.whatsappCallId || attempt.whatsappCallId,
                attemptedAt: attempt.attemptedAt?.toISOString?.() || attempt.attemptedAt,
                endedAt: attempt.endedAt?.toISOString?.() || attempt.endedAt,
                bridgeEvent: bridgeCall?.event || bridgeEvent.event || bridgeResult.event || null,
                mediaStatus: bridgeCall?.mediaStatus || metadata.mediaStatus || bridgeEvent.mediaStatus || bridgeResult.mediaStatus || null,
                spikeResult: metadata.spikeResult || null,
                errorCode: attempt.errorCode || bridgeCall?.errorCode || null,
                errorMessage: attempt.errorMessage || bridgeCall?.errorMessage || bridgeCall?.error || null,
                fallbackCallLink: bridgeCall?.fallbackCallLink || metadata.fallbackCallLink || bridgeEvent.fallbackCallLink || bridgeResult.fallbackCallLink || null,
            },
            bridgeCall: bridgeCall ? {
                callId: bridgeCall.callId || null,
                whatsappCallId: bridgeCall.whatsappCallId || null,
                status: bridgeCall.status || null,
                event: bridgeCall.event || null,
                updatedAt: bridgeCall.updatedAt || null,
                fallbackCallLink: bridgeCall.fallbackCallLink || null,
            } : null,
        });
    } catch (error) {
        console.error("GET /api/admin/conversations/whatsapp-call/status error:", error);
        return NextResponse.json({ success: false, error: serializeError(error) }, { status: 500 });
    }
}
