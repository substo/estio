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

import { quickAssistModelOptions, selectQuickAssistModel } from "@/lib/viewings/sessions/quick-assist-models";
import { estimateQuickAssistCost, googleUsageCounts } from "@/lib/viewings/sessions/quick-assist-cost";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({ prompt: z.string().trim().min(1).max(4000), model: z.string().max(120).default("automatic") });

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
    const codexAvailable = isChatGptSubscriptionTransportEnabled()
        && Boolean(await resolveChatGptSubscriptionCredential(codexContext));
    if (!apiKey && !openaiKey && !codexAvailable) return NextResponse.json({ error: "Connect a Google, OpenAI API, or ChatGPT/Codex text provider for this location in Settings → Integrations." }, { status: 503 });
    try {
        const selected = selectQuickAssistModel(quickAssistModelOptions({ google: !!apiKey, openai: !!openaiKey, codex: codexAvailable }).assistant, parsed.data.model);
        const recent = session.messages.reverse().map((message) => `${message.speaker}: ${message.originalText}`).join("\n");
        const prompt = [
            "You assist a real estate agent during a live conversation. Answer the agent's latest request clearly and briefly. Do not invent property or contact facts. Reply in the agent's language.",
            `Agent language: ${session.agentLanguage || "en"}; customer language: ${session.clientLanguage || "unknown"}.`,
            `Contact: ${session.contact?.name || "not attached"}. Property: ${session.primaryProperty?.title || "not attached"} (${session.primaryProperty?.reference || "no reference"}).`,
            `Recent conversation:\n${recent}`,
            `Latest agent request: ${parsed.data.prompt}`,
        ].join("\n\n");
        const result = selected.provider === "Google" && apiKey
            ? await new GoogleGenerativeAI(apiKey).getGenerativeModel({ model: selected.model }).generateContent(prompt)
            : null;
        const openAiResult = selected.provider === "OpenAI API" && openaiKey
            ? await callLLMWithMetadata(selected.value, prompt, undefined, { locationId: session.locationId, executionMode: "background" })
            : null;
        const codexResult = selected.provider === "ChatGPT/Codex" && codexAvailable
            ? await callChatGptSubscriptionWithMetadata(selected.value, prompt, undefined, { executionContext: codexContext })
            : null;
        const answer = (result?.response.text() || openAiResult?.text || codexResult?.text || "").trim();
        if (!answer) throw new Error("Assistant returned an empty answer.");
        const usage = result?.response.usageMetadata;
        const counts = result ? googleUsageCounts(usage) : { inputTokens: Number(openAiResult?.usage.promptTokens || codexResult?.usage.promptTokens || 0), outputTokens: Number(openAiResult?.usage.completionTokens || codexResult?.usage.completionTokens || 0), cachedInputTokens: Number(openAiResult?.usage.cachedContentTokens || 0), usageAvailable: Number(openAiResult?.usage.totalTokens || codexResult?.usage.totalTokens || 0) > 0 };
        const usedModel = codexResult?.model || openAiResult?.model || selected.model;
        const cost = estimateQuickAssistCost({ ...counts, model: codexResult ? `chatgpt_subscription:${usedModel.replace(/^chatgpt_subscription:/, "")}` : usedModel });
        await securelyRecordAiUsage({
            locationId: session.locationId,
            resourceType: "viewing_session",
            resourceId: context.sessionId,
            featureArea: "viewing_session_assistant",
            action: "viewing_session_assistant_answer",
            provider: result ? "google_gemini" : openAiResult ? "openai" : "chatgpt_subscription",
            model: usedModel,
            inputTokens: counts.inputTokens,
            outputTokens: counts.outputTokens,
            estimatedCostUsd: cost.amount,
            fundingScope: codexResult?.fundingScope,
            userId: user?.id,
            executionMode: "interactive",
            metadata: { sessionId: context.sessionId, costStatus: cost.status, calculation: cost.calculation, pricingSource: cost.rate?.sourceUrl, pricingVerifiedAt: cost.rate?.verifiedAt, mode: "Assistant" },
        });
        return NextResponse.json({ answer, model: usedModel, provider: selected.provider, cost });
    } catch (error) {
        return NextResponse.json({ error: error instanceof Error ? error.message : "Assistant failed." }, { status: 502 });
    }
}
