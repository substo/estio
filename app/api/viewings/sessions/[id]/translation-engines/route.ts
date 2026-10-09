import { NextRequest, NextResponse } from "next/server";
import db from "@/lib/db";
import { resolveViewingSessionRequestContext } from "@/lib/viewings/sessions/auth";
import { getLocationTranslationEngines } from "@/lib/viewings/sessions/translation-engines";
import { resolveLocationGoogleAiApiKey } from "@/lib/ai/location-google-key";
import { resolveLocationOpenAiApiKey } from "@/lib/ai/location-openai-key";
import { isChatGptSubscriptionTransportEnabled, resolveChatGptSubscriptionCredential } from "@/lib/ai/chatgpt-subscription";

import { quickAssistModelOptions } from "@/lib/viewings/sessions/quick-assist-models";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function respond(req: NextRequest, id: string, refresh: boolean) {
    const context = await resolveViewingSessionRequestContext({ request: req, sessionId: id, allowClientToken: false, allowAgentToken: true });
    if (!context || context.role === "client") return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const session = await db.viewingSession.findUnique({ where: { id: context.sessionId }, select: { locationId: true, liveModel: true } });
    if (!session || session.locationId !== context.locationId) return NextResponse.json({ error: "Session not found." }, { status: 404 });
    const user = context.clerkUserId
        ? await db.user.findUnique({ where: { clerkId: context.clerkUserId }, select: { id: true } })
        : null;
    const [engines, googleKey, openaiKey, codexCredential] = await Promise.all([
        getLocationTranslationEngines(session.locationId, refresh),
        resolveLocationGoogleAiApiKey(session.locationId),
        resolveLocationOpenAiApiKey(session.locationId),
        isChatGptSubscriptionTransportEnabled()
            ? resolveChatGptSubscriptionCredential({ executionMode: "interactive", locationId: session.locationId, userId: user?.id })
            : Promise.resolve(null),
    ]);
    return NextResponse.json({ modelOptions: quickAssistModelOptions({ google: !!googleKey, openai: !!openaiKey, codex: !!codexCredential }), engines, providers: { google: !!googleKey, openai: !!openaiKey, codex: !!codexCredential }, selectedModel: session.liveModel, checkedAt: engines.find((engine) => engine.checkedAt)?.checkedAt || null });
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    return respond(req, (await params).id, false);
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    return respond(req, (await params).id, true);
}
