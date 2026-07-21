import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";

import { syncWhatsAppHistory } from "@/app/(main)/admin/conversations/actions";
import { getLocationContext } from "@/lib/auth/location-context";

export const dynamic = "force-dynamic";
export const maxDuration = 180;

export async function POST(
    request: NextRequest,
    context: { params: Promise<{ conversationId: string }> },
) {
    const requestId = randomUUID();
    const startedAt = Date.now();

    try {
        const location = await getLocationContext();
        if (!location) {
            return NextResponse.json({ success: false, error: "Unauthorized", requestId }, { status: 401 });
        }

        const { conversationId } = await context.params;
        const body = await request.json().catch(() => ({}));
        const limit = Math.min(Math.max(Number(body?.limit || 100), 1), 100);
        const result = await syncWhatsAppHistory(String(conversationId || "").trim(), limit, true, 0);
        const response = {
            ...result,
            requestId,
            durationMs: Date.now() - startedAt,
        };

        return NextResponse.json(response, {
            status: result.success ? 200 : 502,
            headers: { "Cache-Control": "no-store" },
        });
    } catch (error: any) {
        console.error("POST WhatsApp history sync failed", {
            requestId,
            code: "WHATSAPP_HISTORY_SYNC_FAILED",
        });
        return NextResponse.json({
            success: false,
            error: "WhatsApp history sync failed unexpectedly.",
            requestId,
            durationMs: Date.now() - startedAt,
        }, { status: 500, headers: { "Cache-Control": "no-store" } });
    }
}
