import { NextRequest, NextResponse } from "next/server";

import { refetchWhatsAppMediaAttachment } from "@/app/(main)/admin/conversations/actions";
import { getLocationContext } from "@/lib/auth/location-context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
    request: NextRequest,
    context: {
        params: Promise<{ conversationId: string; messageId: string }>;
    },
) {
    try {
        const location = await getLocationContext();
        if (!location?.id) {
            return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
        }

        const { conversationId, messageId } = await context.params;
        const body = await request.json().catch(() => ({}));
        const result = await refetchWhatsAppMediaAttachment(
            String(conversationId || "").trim(),
            String(messageId || "").trim(),
            {
                deleteStoredObject: body?.deleteStoredObject !== false,
                maxScan: body?.maxScan,
            },
        );

        return NextResponse.json(result, {
            status: result.success ? 202 : 400,
            headers: { "Cache-Control": "no-store" },
        });
    } catch (error: any) {
        console.error("[WhatsApp Media Refetch API] Request failed", {
            code: "WHATSAPP_MEDIA_REFETCH_REQUEST_FAILED",
        });
        return NextResponse.json({
            success: false,
            error: error?.message || "Media re-fetch failed unexpectedly.",
        }, {
            status: 500,
            headers: { "Cache-Control": "no-store" },
        });
    }
}
