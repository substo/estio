import { NextRequest, NextResponse } from "next/server";

import { getLocationContext } from "@/lib/auth/location-context";
import { sendSmsRelayMessage } from "@/lib/sms-relay/send";

export const dynamic = "force-dynamic";

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
