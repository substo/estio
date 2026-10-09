import { NextRequest, NextResponse } from "next/server";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { z } from "zod";
import db from "@/lib/db";
import { resolveLocationGoogleAiApiKey } from "@/lib/ai/location-google-key";
import { securelyRecordAiUsage } from "@/lib/ai/usage-metering";
import { resolveViewingSessionRequestContext } from "@/lib/viewings/sessions/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({ prompt: z.string().trim().min(1).max(4000) });

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    const context = await resolveViewingSessionRequestContext({
        request: req,
        sessionId: id,
        allowClientToken: false,
        allowAgentToken: true,
    });
    if (!context || context.role === "client") return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const parsed = schema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "Enter a question for the assistant." }, { status: 400 });
    const session = await db.viewingSession.findUnique({
        where: { id: context.sessionId },
        select: {
            locationId: true,
            sessionKind: true,
            agentLanguage: true,
            clientLanguage: true,
            contact: { select: { name: true } },
            primaryProperty: { select: { title: true, reference: true } },
            messages: { orderBy: { createdAt: "desc" }, take: 12, select: { speaker: true, originalText: true } },
        },
    });
    if (!session || session.sessionKind !== "quick_translate") return NextResponse.json({ error: "Select Assistant mode first." }, { status: 409 });
    const apiKey = await resolveLocationGoogleAiApiKey(session.locationId);
    if (!apiKey) return NextResponse.json({ error: "A Google AI key is required for Assistant mode." }, { status: 503 });
    try {
        const model = new GoogleGenerativeAI(apiKey).getGenerativeModel({ model: "gemini-2.5-flash" });
        const recent = session.messages.reverse().map((message) => `${message.speaker}: ${message.originalText}`).join("\n");
        const result = await model.generateContent([
            "You assist a real estate agent during a live conversation. Answer the agent's latest request clearly and briefly. Do not invent property or contact facts. Reply in the agent's language.",
            `Agent language: ${session.agentLanguage || "en"}; customer language: ${session.clientLanguage || "unknown"}.`,
            `Contact: ${session.contact?.name || "not attached"}. Property: ${session.primaryProperty?.title || "not attached"} (${session.primaryProperty?.reference || "no reference"}).`,
            `Recent conversation:\n${recent}`,
            `Latest agent request: ${parsed.data.prompt}`,
        ].join("\n\n"));
        const answer = result.response.text().trim();
        if (!answer) throw new Error("Assistant returned an empty answer.");
        const usage = result.response.usageMetadata;
        await securelyRecordAiUsage({
            locationId: session.locationId,
            resourceType: "viewing_session",
            resourceId: context.sessionId,
            featureArea: "viewing_session_assistant",
            action: "viewing_session_assistant_answer",
            provider: "google_gemini",
            model: "gemini-2.5-flash",
            inputTokens: Number(usage?.promptTokenCount || 0),
            outputTokens: Number(usage?.candidatesTokenCount || 0),
            metadata: { sessionId: context.sessionId },
        });
        return NextResponse.json({ answer });
    } catch (error) {
        return NextResponse.json({ error: error instanceof Error ? error.message : "Assistant failed." }, { status: 502 });
    }
}
