import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import db from "@/lib/db";
import { resolveViewingSessionRequestContext } from "@/lib/viewings/sessions/auth";
import { appendViewingSessionEvent } from "@/lib/viewings/sessions/events";
import {
    selectEffectiveViewingTranscriptMessageForUtterance,
    selectViewingTranscriptUtteranceMessages,
} from "@/lib/viewings/sessions/transcript";
import {
    runViewingSessionMessageInsights,
    runViewingSessionMessageTranslation,
} from "@/lib/viewings/sessions/analysis";
import { runViewingSessionSynthesis } from "@/lib/queue/viewing-session-synthesis";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const reprocessSchema = z.discriminatedUnion("target", [
    z.object({
        target: z.literal("message_analysis"),
        messageId: z.string().trim().min(1).max(120),
    }),
    z.object({
        target: z.literal("summary"),
        summaryStatus: z.enum(["draft", "final"]).optional(),
    }),
]);

export async function POST(
    req: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const { id } = await params;
    const sessionId = String(id || "").trim();
    if (!sessionId) {
        return NextResponse.json({ success: false, error: "Missing session id." }, { status: 400 });
    }

    const tokenOverride = String(req.nextUrl.searchParams.get("accessToken") || "").trim() || null;
    const context = await resolveViewingSessionRequestContext({
        request: req,
        sessionId,
        allowClientToken: false,
        allowAgentToken: true,
        tokenOverride,
    });
    if (!context) {
        return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    }
    if (context.role === "client") {
        return NextResponse.json({ success: false, error: "Forbidden" }, { status: 403 });
    }

    const parsed = reprocessSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
        return NextResponse.json(
            { success: false, error: "Invalid payload.", details: parsed.error.flatten().fieldErrors },
            { status: 400 }
        );
    }

    if (parsed.data.target === "summary") {
        const summaryStatus = parsed.data.summaryStatus === "final" ? "final" : "draft";
        const summary = await runViewingSessionSynthesis({
            sessionId,
            status: summaryStatus,
            trigger: "manual",
        });

        await appendViewingSessionEvent({
            sessionId,
            locationId: context.locationId,
            type: "viewing_session.reprocess.summary",
            actorRole: context.role,
            actorUserId: context.clerkUserId,
            source: "api",
            payload: {
                summaryStatus,
                summaryId: summary.id,
            },
        });

        return NextResponse.json({
            success: true,
            target: "summary",
            summaryStatus,
            summaryId: summary.id,
        });
    }

    const requestedMessage = await db.viewingSessionMessage.findFirst({
        where: {
            id: parsed.data.messageId,
            sessionId,
        },
        select: {
            id: true,
            utteranceId: true,
        },
    });
    if (!requestedMessage) {
        return NextResponse.json({ success: false, error: "Message not found." }, { status: 404 });
    }

    const lineageMessages = await db.viewingSessionMessage.findMany({
        where: {
            sessionId,
            utteranceId: requestedMessage.utteranceId,
        },
        select: {
            id: true,
            utteranceId: true,
            supersedesMessageId: true,
            timestamp: true,
            createdAt: true,
        },
        orderBy: [{ timestamp: "asc" }, { createdAt: "asc" }],
    });

    const effectiveMessage = selectEffectiveViewingTranscriptMessageForUtterance(
        selectViewingTranscriptUtteranceMessages(lineageMessages, requestedMessage.utteranceId),
        requestedMessage.utteranceId
    ) || lineageMessages[lineageMessages.length - 1];

    if (!effectiveMessage?.id) {
        return NextResponse.json({ success: false, error: "No effective transcript row found." }, { status: 409 });
    }

    const translation = await runViewingSessionMessageTranslation({
        sessionId,
        messageId: effectiveMessage.id,
    });
    const insights = await runViewingSessionMessageInsights({
        sessionId,
        messageId: effectiveMessage.id,
    });

    await appendViewingSessionEvent({
        sessionId,
        locationId: context.locationId,
        type: "viewing_session.reprocess.message_analysis",
        actorRole: context.role,
        actorUserId: context.clerkUserId,
        source: "api",
        payload: {
            requestedMessageId: requestedMessage.id,
            effectiveMessageId: effectiveMessage.id,
            utteranceId: requestedMessage.utteranceId,
            insightsCreated: (insights as any)?.insightsCreated || 0,
            insightsSuperseded: (insights as any)?.insightsSuperseded || 0,
        },
    });

    return NextResponse.json({
        success: true,
        target: "message_analysis",
        requestedMessageId: requestedMessage.id,
        effectiveMessageId: effectiveMessage.id,
        utteranceId: requestedMessage.utteranceId,
        translation,
        insights,
    });
}
