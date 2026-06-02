import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import db from "@/lib/db";
import { getLocationContext } from "@/lib/auth/location-context";
import { refreshGhlAccessToken } from "@/lib/location";
import { ensureLocalContactSynced } from "@/lib/crm/contact-sync";
import { generateDraft } from "@/lib/ai/coordinator";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type DraftStreamBody = {
    conversationId?: string;
    contactId?: string;
    instruction?: string;
    baseDraft?: string;
    model?: string;
    options?: {
        mode?: "chat" | "deal";
        dealId?: string;
        draftLanguage?: string | null;
    };
};

function sanitizeString(value: unknown): string | undefined {
    if (typeof value !== "string") return undefined;
    const trimmed = value.trim();
    return trimmed || undefined;
}

function logDraftStreamTiming(event: string, fields: Record<string, unknown> = {}) {
    console.info("[AI Draft Timing]", JSON.stringify({
        event,
        ts: new Date().toISOString(),
        ...fields,
    }));
}

export async function POST(req: NextRequest) {
    const requestStartedAt = Date.now();
    logDraftStreamTiming("route_stream_request_start");

    const authStartedAt = Date.now();
    const locationBase = await getLocationContext();
    if (!locationBase) {
        return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    }
    logDraftStreamTiming("route_stream_auth_end", {
        elapsedMs: Date.now() - authStartedAt,
    });

    let location = locationBase;
    const tokenRefreshStartedAt = Date.now();
    try {
        location = await refreshGhlAccessToken(locationBase);
    } catch (error) {
        console.warn("[AI Draft Stream] Failed to refresh token; using existing location token", error);
    }
    logDraftStreamTiming("route_stream_token_refresh_end", {
        elapsedMs: Date.now() - tokenRefreshStartedAt,
        hasToken: !!location.ghlAccessToken,
    });

    if (location.ghlAccessToken && !location.ghlLocationId) {
        return NextResponse.json({ success: false, error: "Misconfigured: Location has no GHL Location ID" }, { status: 400 });
    }

    const body = await req.json().catch(() => null) as DraftStreamBody | null;
    const conversationId = sanitizeString(body?.conversationId);
    const contactId = sanitizeString(body?.contactId);
    const instruction = sanitizeString(body?.instruction);
    const baseDraft = sanitizeString(body?.baseDraft);
    const model = sanitizeString(body?.model);
    const mode = body?.options?.mode === "deal" ? "deal" : "chat";
    const dealId = sanitizeString(body?.options?.dealId);
    const draftLanguage = body?.options?.draftLanguage ?? null;

    if (!conversationId || !contactId) {
        return NextResponse.json({ success: false, error: "conversationId and contactId are required" }, { status: 400 });
    }

    const contactSyncStartedAt = Date.now();
    const existingContact = await db.contact.findFirst({
        where: { OR: [{ id: contactId }, { ghlContactId: contactId }], locationId: location.id },
        select: { ghlContactId: true },
    });

    if (location.ghlAccessToken && existingContact?.ghlContactId) {
        await ensureLocalContactSynced(existingContact.ghlContactId, location.id, location.ghlAccessToken);
    } else if (location.ghlAccessToken && !existingContact) {
        await ensureLocalContactSynced(contactId, location.id, location.ghlAccessToken);
    }
    logDraftStreamTiming("route_stream_contact_sync_end", {
        conversationId,
        elapsedMs: Date.now() - contactSyncStartedAt,
        hadExistingContact: !!existingContact,
        synced: !!location.ghlAccessToken && (!!existingContact?.ghlContactId || !existingContact),
    });

    const userLookupStartedAt = Date.now();
    const { userId } = await auth();
    let agentName: string | undefined;
    if (userId) {
        const agentUser = await db.user.findUnique({
            where: { clerkId: userId },
            select: { name: true, firstName: true, lastName: true, email: true },
        });
        if (agentUser) {
            const fullName = [agentUser.firstName, agentUser.lastName].filter(Boolean).join(" ").trim();
            agentName = agentUser.name || fullName || agentUser.email || undefined;
        }
    }
    logDraftStreamTiming("route_stream_user_lookup_end", {
        conversationId,
        elapsedMs: Date.now() - userLookupStartedAt,
        hasAgentName: !!agentName,
    });

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
        async start(controller) {
            const generationStartedAt = Date.now();
            let firstChunkMs: number | null = null;
            let streamWritable = true;
            const push = (payload: Record<string, unknown>) => {
                if (!streamWritable) return false;
                try {
                    controller.enqueue(encoder.encode(`${JSON.stringify(payload)}\n`));
                    return true;
                } catch {
                    streamWritable = false;
                    return false;
                }
            };

            try {
                push({
                    type: "started",
                    conversationId,
                    ts: new Date().toISOString(),
                });

                const result = await generateDraft({
                    conversationId,
                    contactId,
                    locationId: location.id,
                    accessToken: location.ghlAccessToken || "",
                    agentName,
                    businessName: location.name || undefined,
                    instruction,
                    baseDraft,
                    model,
                    mode,
                    dealId,
                    draftLanguage,
                    stream: true,
                    latencyMode: "fast",
                    onToken: (chunk) => {
                        if (!chunk) return;
                        if (firstChunkMs === null) {
                            firstChunkMs = Date.now() - generationStartedAt;
                            logDraftStreamTiming("route_stream_first_chunk", {
                                conversationId,
                                firstChunkMs,
                                requestElapsedMs: Date.now() - requestStartedAt,
                            });
                        }
                        push({ type: "chunk", text: chunk });
                    },
                });

                logDraftStreamTiming("route_stream_complete", {
                    conversationId,
                    elapsedMs: Date.now() - generationStartedAt,
                    requestElapsedMs: Date.now() - requestStartedAt,
                    firstChunkMs,
                    hasDraft: !!result?.draft,
                    generateDraftTelemetry: result?.telemetry?.stageMs || null,
                });
                push({
                    type: "complete",
                    result,
                });
            } catch (error: any) {
                logDraftStreamTiming("route_stream_failure", {
                    conversationId,
                    elapsedMs: Date.now() - generationStartedAt,
                    requestElapsedMs: Date.now() - requestStartedAt,
                    firstChunkMs,
                    reason: error?.message || String(error),
                });
                console.error("[AI Draft Stream] Error:", error);
                push({
                    type: "error",
                    message: error?.message || "Failed to generate draft",
                });
            } finally {
                if (streamWritable) {
                    try {
                        controller.close();
                    } catch {
                        streamWritable = false;
                    }
                }
            }
        },
    });

    return new NextResponse(stream, {
        headers: {
            "Content-Type": "text/plain; charset=utf-8",
            "Cache-Control": "no-cache, no-transform",
            "Transfer-Encoding": "chunked",
            "X-Content-Type-Options": "nosniff",
        },
    });
}
