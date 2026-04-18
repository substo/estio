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

export async function POST(req: NextRequest) {
    const locationBase = await getLocationContext();
    if (!locationBase) {
        return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    }

    let location = locationBase;
    try {
        location = await refreshGhlAccessToken(locationBase);
    } catch (error) {
        console.warn("[AI Draft Stream] Failed to refresh token; using existing location token", error);
    }

    if (!location.ghlAccessToken) {
        return NextResponse.json({ success: false, error: "Unauthorized or GHL not connected" }, { status: 401 });
    }

    if (!location.ghlLocationId) {
        return NextResponse.json({ success: false, error: "Misconfigured: Location has no GHL Location ID" }, { status: 400 });
    }

    const body = await req.json().catch(() => null) as DraftStreamBody | null;
    const conversationId = sanitizeString(body?.conversationId);
    const contactId = sanitizeString(body?.contactId);
    const instruction = sanitizeString(body?.instruction);
    const model = sanitizeString(body?.model);
    const mode = body?.options?.mode === "deal" ? "deal" : "chat";
    const dealId = sanitizeString(body?.options?.dealId);
    const draftLanguage = body?.options?.draftLanguage ?? null;

    if (!conversationId || !contactId) {
        return NextResponse.json({ success: false, error: "conversationId and contactId are required" }, { status: 400 });
    }

    const existingContact = await db.contact.findFirst({
        where: { OR: [{ id: contactId }, { ghlContactId: contactId }], locationId: location.id },
        select: { ghlContactId: true },
    });

    if (existingContact?.ghlContactId) {
        await ensureLocalContactSynced(existingContact.ghlContactId, location.id, location.ghlAccessToken);
    } else if (!existingContact) {
        await ensureLocalContactSynced(contactId, location.id, location.ghlAccessToken);
    }

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

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
        async start(controller) {
            const push = (payload: Record<string, unknown>) => {
                controller.enqueue(encoder.encode(`${JSON.stringify(payload)}\n`));
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
                    accessToken: location.ghlAccessToken!,
                    agentName,
                    businessName: location.name || undefined,
                    instruction,
                    model,
                    mode,
                    dealId,
                    draftLanguage,
                    stream: true,
                    onToken: (chunk) => {
                        if (!chunk) return;
                        push({ type: "chunk", text: chunk });
                    },
                });

                push({
                    type: "complete",
                    result,
                });
            } catch (error: any) {
                console.error("[AI Draft Stream] Error:", error);
                push({
                    type: "error",
                    message: error?.message || "Failed to generate draft",
                });
            } finally {
                controller.close();
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
