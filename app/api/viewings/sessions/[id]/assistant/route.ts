import { NextRequest, NextResponse } from "next/server";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { z } from "zod";
import db from "@/lib/db";
import { resolveLocationGoogleAiApiKey } from "@/lib/ai/location-google-key";
import { resolveLocationOpenAiApiKey } from "@/lib/ai/location-openai-key";
import { callLLMWithMetadata } from "@/lib/ai/llm";
import { callChatGptSubscriptionWithMetadata, isChatGptSubscriptionTransportEnabled, resolveChatGptSubscriptionCredential } from "@/lib/ai/chatgpt-subscription";
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
    const [apiKey, openaiKey] = await Promise.all([
        resolveLocationGoogleAiApiKey(session.locationId),
        resolveLocationOpenAiApiKey(session.locationId),
    ]);
    const user = context.clerkUserId
        ? await db.user.findUnique({ where: { clerkId: context.clerkUserId }, select: { id: true } })
        : null;
    const codexContext = { executionMode: "interactive" as const, locationId: session.locationId, userId: user?.id };
    const codexAvailable = !apiKey && !openaiKey && isChatGptSubscriptionTransportEnabled()
        && Boolean(await resolveChatGptSubscriptionCredential(codexContext));
    if (!apiKey && !openaiKey && !codexAvailable) return NextResponse.json({ error: "Connect a Google, OpenAI API, or ChatGPT/Codex text provider for this location in Settings → Integrations." }, { status: 503 });
    try {
        const recent = session.messages.reverse().map((message) => `${message.speaker}: ${message.originalText}`).join("\n");
        const prompt = [
            "You assist a real estate agent during a live conversation. Answer the agent's latest request clearly and briefly. Do not invent property or contact facts. Reply in the agent's language.",
            `Agent language: ${session.agentLanguage || "en"}; customer language: ${session.clientLanguage || "unknown"}.`,
            `Contact: ${session.contact?.name || "not attached"}. Property: ${session.primaryProperty?.title || "not attached"} (${session.primaryProperty?.reference || "no reference"}).`,
            `Recent conversation:\n${recent}`,
            `Latest agent request: ${parsed.data.prompt}`,
        ].join("\n\n");
        const result = apiKey
            ? await new GoogleGenerativeAI(apiKey).getGenerativeModel({ model: "gemini-2.5-flash" }).generateContent(prompt)
            : null;
        const openAiResult = !result && openaiKey
            ? await callLLMWithMetadata("openai:gpt-4o-mini", prompt, undefined, { locationId: session.locationId, executionMode: "background" })
            : null;
        const codexResult = !result && !openAiResult && codexAvailable
            ? await callChatGptSubscriptionWithMetadata("chatgpt_subscription:gpt-5.4-mini", prompt, undefined, { executionContext: codexContext })
            : null;
        const answer = (result?.response.text() || openAiResult?.text || codexResult?.text || "").trim();
        if (!answer) throw new Error("Assistant returned an empty answer.");
        const usage = result?.response.usageMetadata;
        await securelyRecordAiUsage({
            locationId: session.locationId,
            resourceType: "viewing_session",
            resourceId: context.sessionId,
            featureArea: "viewing_session_assistant",
            action: "viewing_session_assistant_answer",
            provider: result ? "google_gemini" : openAiResult ? "openai" : "chatgpt_subscription",
            model: result ? "gemini-2.5-flash" : openAiResult ? "gpt-4o-mini" : (codexResult?.model || "gpt-5.4-mini"),
            inputTokens: result ? Number(usage?.promptTokenCount || 0) : Number(openAiResult?.usage.promptTokens || codexResult?.usage.promptTokens || 0),
            outputTokens: result ? Number(usage?.candidatesTokenCount || 0) : Number(openAiResult?.usage.completionTokens || codexResult?.usage.completionTokens || 0),
            metadata: { sessionId: context.sessionId },
        });
        return NextResponse.json({ answer });
    } catch (error) {
        return NextResponse.json({ error: error instanceof Error ? error.message : "Assistant failed." }, { status: 502 });
    }
}
