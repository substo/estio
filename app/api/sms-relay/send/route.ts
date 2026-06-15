import { NextRequest, NextResponse } from "next/server";

import { getLocationContext } from "@/lib/auth/location-context";
import db from "@/lib/db";
import { recordAgentFeedback } from "@/lib/ai/agent-feedback";
import { buildConversationReferenceWhere } from "@/lib/conversations/identity";
import { sendSmsRelayMessage } from "@/lib/sms-relay/send";

export const dynamic = "force-dynamic";

async function recordSmsRelayAgentFeedback(args: {
    locationId: string;
    conversationId: string;
    contactId: string;
    messageBody: string;
    agentFeedback: any;
}) {
    const feedback = args.agentFeedback;
    if (!feedback?.aiOutput) return;
    try {
        const conversation = await db.conversation.findFirst({
            where: buildConversationReferenceWhere(args.locationId, args.conversationId),
            select: { id: true, contactId: true },
        });
        if (!conversation?.id) return;
        const contact = await db.contact.findFirst({
            where: {
                locationId: args.locationId,
                OR: [
                    { id: args.contactId },
                    { ghlContactId: args.contactId },
                    { id: conversation.contactId },
                ],
            },
            select: { id: true },
        });
        await recordAgentFeedback({
            locationId: args.locationId,
            conversationId: conversation.id,
            contactId: contact?.id || conversation.contactId || null,
            sourceFeature: feedback.sourceFeature || "ai_draft",
            sourceAction: feedback.sourceAction || "send",
            agentExecutionId: feedback.agentExecutionId || null,
            aiDecisionId: feedback.aiDecisionId || null,
            traceId: feedback.traceId || null,
            skillId: feedback.skillId || null,
            model: feedback.model || null,
            aiOutput: feedback.aiOutput,
            humanOutput: feedback.humanOutput || args.messageBody,
            outcome: "sent",
            metadata: {
                ...(feedback.metadata || {}),
                channel: "SMS_RELAY",
                sentBody: args.messageBody,
            },
        });
    } catch (error: any) {
        console.warn("[SmsRelaySendAPI] Failed to record agent feedback:", error?.message || error);
    }
}

export async function POST(req: NextRequest) {
    const location = await getLocationContext();
    if (!location) {
        return NextResponse.json(
            { success: false, error: "Unauthorized", errorCode: "unauthorized" },
            { status: 401 }
        );
    }

    let body: any;
    try {
        body = await req.json();
    } catch {
        return NextResponse.json(
            { success: false, error: "Invalid JSON body.", errorCode: "invalid_json" },
            { status: 400 }
        );
    }

    try {
        const result = await sendSmsRelayMessage({
            locationId: location.id,
            conversationId: String(body?.conversationId || ""),
            contactId: String(body?.contactId || ""),
            messageBody: String(body?.messageBody || ""),
            clientMessageId: body?.clientMessageId ? String(body.clientMessageId) : null,
            translationSourceText: body?.translationSourceText ? String(body.translationSourceText) : null,
            translationTargetLanguage: body?.translationTargetLanguage ? String(body.translationTargetLanguage) : null,
            translationDetectedSourceLanguage: body?.translationDetectedSourceLanguage
                ? String(body.translationDetectedSourceLanguage)
                : null,
        });

        if (result.success) {
            await recordSmsRelayAgentFeedback({
                locationId: location.id,
                conversationId: String(body?.conversationId || ""),
                contactId: String(body?.contactId || ""),
                messageBody: String(body?.messageBody || ""),
                agentFeedback: body?.agentFeedback && typeof body.agentFeedback === "object" ? body.agentFeedback : null,
            });
        }

        return NextResponse.json(result, { status: result.success ? 200 : 400 });
    } catch (error: any) {
        console.error("[SmsRelaySendAPI] unexpected failure", {
            locationId: location.id,
            conversationId: body?.conversationId,
            contactId: body?.contactId,
            error: error?.message || String(error),
        });
        return NextResponse.json(
            {
                success: false,
                error: "SIM Relay send failed unexpectedly.",
                errorCode: "unexpected_error",
            },
            { status: 500 }
        );
    }
}
