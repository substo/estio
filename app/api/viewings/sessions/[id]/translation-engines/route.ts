import { NextRequest, NextResponse } from "next/server";
import db from "@/lib/db";
import { resolveViewingSessionRequestContext } from "@/lib/viewings/sessions/auth";
import { getLocationTranslationEngines } from "@/lib/viewings/sessions/translation-engines";
import { resolveLocationGoogleAiApiKey } from "@/lib/ai/location-google-key";
import { resolveLocationOpenAiApiKey } from "@/lib/ai/location-openai-key";
import { isChatGptSubscriptionTransportEnabled, resolveChatGptSubscriptionCredential } from "@/lib/ai/chatgpt-subscription";

import { quickAssistModelOptions } from "@/lib/viewings/sessions/quick-assist-models";
import { getStoredProviderModels } from "@/lib/ai/provider-model-catalog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function respond(req: NextRequest, id: string, refresh: boolean) {
    const context = await resolveViewingSessionRequestContext({ request: req, sessionId: id, allowClientToken: false, allowAgentToken: true });
    if (!context || context.role === "client") return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const session = await db.viewingSession.findUnique({ where: { id: context.sessionId }, select: { locationId: true, liveModel: true, assistAnswerModel: true, assistTranscribeModel: true } });
    if (!session || session.locationId !== context.locationId) return NextResponse.json({ error: "Session not found." }, { status: 404 });
    const user = context.clerkUserId
        ? await db.user.findUnique({ where: { clerkId: context.clerkUserId }, select: { id: true } })
        : null;
    const [engines, googleKey, openaiKey, codexCredential, openaiCatalog] = await Promise.all([
        getLocationTranslationEngines(session.locationId, refresh),
        resolveLocationGoogleAiApiKey(session.locationId),
        resolveLocationOpenAiApiKey(session.locationId),
        isChatGptSubscriptionTransportEnabled()
            ? resolveChatGptSubscriptionCredential({ executionMode: "interactive", locationId: session.locationId, userId: user?.id })
            : Promise.resolve(null),
        getStoredProviderModels({ provider: "openai_api", scopeType: "LOCATION", scopeId: session.locationId }),
    ]);
    const openaiPrices = Object.fromEntries(openaiCatalog.flatMap((entry) => {
        const price = entry.pricing as { inputPer1MTokens?: number; outputPer1MTokens?: number; cachedInputPer1MTokens?: number; perMinuteUsd?: number; fetchedAt?: string; sourceUrl?: string } | null;
        if (!price || (!Number.isFinite(price.inputPer1MTokens) && !Number.isFinite(price.perMinuteUsd))) return [];
        return [[entry.modelId.replace(/^openai:/, ""), price]];
    }));
    return NextResponse.json({ modelOptions: quickAssistModelOptions({ google: !!googleKey, openai: !!openaiKey, codex: !!codexCredential }), engines, providers: { google: !!googleKey, openai: !!openaiKey, codex: !!codexCredential }, selectedModel: session.liveModel, answerModel: session.assistAnswerModel, transcribeModel: session.assistTranscribeModel, openaiPrices, checkedAt: engines.find((engine) => engine.checkedAt)?.checkedAt || null });
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    return respond(req, (await params).id, false);
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    return respond(req, (await params).id, true);
}
