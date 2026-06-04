import { NextResponse } from "next/server";
import { getLocationContext } from "@/lib/auth/location-context";
import db from "@/lib/db";

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
                provider: true,
            },
        });

        if (!attempt) {
            return NextResponse.json({ success: false, error: "Call attempt not found." }, { status: 404 });
        }

        const metadata = asRecord(attempt.metadata);
        const providerEvent = asRecord(metadata.providerEvent);
        const providerResult = asRecord(metadata.providerResult);

        return NextResponse.json({
            success: true,
            call: {
                id: attempt.id,
                createdAt: attempt.createdAt?.toISOString?.() || attempt.createdAt,
                updatedAt: attempt.updatedAt?.toISOString?.() || attempt.updatedAt,
                status: attempt.status,
                provider: attempt.provider,
                providerCallId: attempt.providerCallId,
                bridgeCallId: attempt.bridgeCallId,
                whatsappCallId: attempt.whatsappCallId,
                attemptedAt: attempt.attemptedAt?.toISOString?.() || attempt.attemptedAt,
                endedAt: attempt.endedAt?.toISOString?.() || attempt.endedAt,
                providerEvent: providerEvent.event || providerEvent.type || providerResult.event || null,
                mediaStatus: metadata.mediaStatus || providerEvent.mediaStatus || providerResult.mediaStatus || null,
                recordingPath: metadata.recordingPath || providerEvent.recordingPath || providerResult.recordingPath || null,
                recordingDurationSeconds: metadata.recordingDurationSeconds || providerEvent.recordingDurationSeconds || providerResult.recordingDurationSeconds || null,
                errorCode: attempt.errorCode || providerEvent.errorCode || providerResult.errorCode || null,
                errorMessage: attempt.errorMessage || providerEvent.errorMessage || providerResult.errorMessage || null,
            },
            providerCall: null,
        });
    } catch (error) {
        console.error("GET /api/admin/conversations/whatsapp-call/status error:", error);
        return NextResponse.json({ success: false, error: serializeError(error) }, { status: 500 });
    }
}
