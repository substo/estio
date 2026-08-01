import { NextRequest, NextResponse } from "next/server";
import { getLocationContext } from "@/lib/auth/location-context";
import { getConversationFeatureFlags } from "@/lib/feature-flags";
import { createTraceId } from "@/lib/observability/performance";
import { loadConversationMessageWindow } from "@/lib/conversations/message-window-loading";
import {
    getCachedConversationWorkspaceCoreMetadata,
    queryConversationWorkspaceCoreMetadata,
} from "@/lib/conversations/workspace-metadata-loading";
import { getActiveContactsAccess } from "@/lib/contacts/active-location-access";
import { buildConversationVisibilityWhere } from "@/lib/conversations/contact-assignment-access";
import { buildConversationReferenceWhere } from "@/lib/conversations/identity";
import db from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
    req: NextRequest,
    context: { params: Promise<{ conversationId: string }> | { conversationId: string } }
) {
    const traceId = createTraceId();
    const params = await context.params;
    const conversationId = String(params?.conversationId || "").trim();

    if (!conversationId) {
        return NextResponse.json({ success: false, traceId, error: "Missing conversation ID." }, { status: 400 });
    }

    try {
        const [location, access] = await Promise.all([getLocationContext(), getActiveContactsAccess()]);
        if (!location?.id || !access || access.locationId !== location.id) {
            return NextResponse.json({ success: false, traceId, error: "Unauthorized" }, { status: 401 });
        }
        const authorizedConversation = await db.conversation.findFirst({
            where: {
                AND: [
                    buildConversationReferenceWhere(location.id, conversationId),
                    buildConversationVisibilityWhere(access, "location"),
                ],
            },
            select: { id: true },
        });
        if (!authorizedConversation) {
            return NextResponse.json({ success: false, traceId, error: "Conversation not found." }, { status: 404 });
        }

        const url = new URL(req.url);
        const take = Number(url.searchParams.get("take") || "");
        const flags = getConversationFeatureFlags(location.id, { locationSmsRelayEnabled: !!(location as any).smsRelayEnabled });

        const result = await loadConversationMessageWindow({
            traceId,
            location,
            conversationId,
            take,
            loadMetadata: () => flags.workspaceV2
                ? getCachedConversationWorkspaceCoreMetadata(location.id, location.ghlLocationId || null, conversationId)
                : queryConversationWorkspaceCoreMetadata({
                    locationId: location.id,
                    locationGhlId: location.ghlLocationId || null,
                    conversationId,
                }),
            dependencies: {
                resolveTranscriptVisibilityAccess: async () => ({ restrictContent: false }),
                parseLegacyCrmLeadNotificationEmail: () => null,
            },
        });

        return NextResponse.json(result, { status: result.success ? 200 : 404 });
    } catch (error: any) {
        console.error("[message-window] Error:", error);
        return NextResponse.json({
            success: false,
            traceId,
            error: error?.message || "Failed to load message window.",
        }, { status: error?.message === "Unauthorized" ? 401 : 500 });
    }
}
