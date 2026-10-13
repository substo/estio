import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import db from "@/lib/db";
import { resolveLocationGoogleAiApiKey } from "@/lib/ai/location-google-key";
import { resolveViewingSessionRequestContext } from "@/lib/viewings/sessions/auth";
import { recordViewingSessionUsage } from "@/lib/viewings/sessions/usage";
import { REPLAY_SPEECH_MODELS, REPLAY_SPEECH_VOICES } from "@/lib/viewings/sessions/replay-speech-options";
import { estimateReplaySpeechTokens, replaySpeechAudio, replaySpeechCost, replaySpeechUsage } from "@/lib/viewings/sessions/replay-speech";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const requestSchema = z.object({
    messageId: z.string().min(1).max(120),
    field: z.enum(["original", "translation"]),
    model: z.enum(REPLAY_SPEECH_MODELS),
    voice: z.enum(REPLAY_SPEECH_VOICES),
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const sessionId = (await params).id;
    const context = await resolveViewingSessionRequestContext({ request: req, sessionId, allowClientToken: false, allowAgentToken: true });
    if (!context || context.role === "client") return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const parsed = requestSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "Invalid speech request." }, { status: 400 });
    const session = await db.viewingSession.findFirst({ where: { id: sessionId, locationId: context.locationId, deletedAt: null }, select: { id: true } });
    if (!session) return NextResponse.json({ error: "Session not found." }, { status: 404 });
    const message = await db.viewingSessionMessage.findFirst({
        where: { id: parsed.data.messageId, sessionId },
        select: { originalText: true, translatedText: true, speaker: true, origin: true },
    });
    if (!message) return NextResponse.json({ error: "Message not found." }, { status: 404 });
    const { field, model, voice } = parsed.data;
    const text = (field === "original" ? message.originalText : message.speaker === "system" && message.origin === "relay_live_transcript" ? message.originalText : message.translatedText)?.trim();
    if (!text || text.length > 2000) return NextResponse.json({ error: "Select a message of up to 2,000 characters to read aloud." }, { status: 400 });
    const apiKey = await resolveLocationGoogleAiApiKey(context.locationId);
    if (!apiKey) return NextResponse.json({ error: "Connect Google AI for this location to use AI voice." }, { status: 409 });

    try {
        const response = await fetch("https://generativelanguage.googleapis.com/v1beta/interactions", {
            method: "POST",
            headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
            body: JSON.stringify({
                model,
                input: [{ type: "user_input", content: [{ type: "text", text }] }],
                response_format: { type: "audio" },
                generation_config: { speech_config: [{ voice }] },
            }),
            signal: AbortSignal.timeout(45_000),
        });
        if (!response.ok) {
            console.error("[viewing-session-speech] Google TTS failed", response.status);
            return NextResponse.json({ error: "AI voice is temporarily unavailable." }, { status: 502 });
        }
        const payload = await response.json();
        const audio = replaySpeechAudio(payload);
        if (!audio) return NextResponse.json({ error: "AI voice returned no playable audio." }, { status: 502 });
        const usage = replaySpeechUsage(payload);
        const derived = estimateReplaySpeechTokens(text, audio);
        const inputTokens = usage.inputTokens || derived.inputTokens;
        const outputTokens = usage.outputTokens || derived.outputTokens;
        const cost = replaySpeechCost(model, inputTokens, outputTokens);
        await recordViewingSessionUsage({
            sessionId, locationId: context.locationId, phase: "tooling", provider: "google_gemini", model,
            usageAuthority: usage.providerReported ? "provider_reported" : "derived",
            inputTokens, outputTokens, outputAudioSeconds: derived.seconds,
            estimatedCostUsd: cost, actualCostUsd: cost,
            metadata: { stage: "speech_replay", messageId: parsed.data.messageId, field, voice,
                pricingSource: "https://ai.google.dev/gemini-api/docs/pricing", pricingVerifiedAt: "2026-10-13" },
        });
        return new NextResponse(new Uint8Array(audio), { headers: { "Content-Type": "audio/wav", "Cache-Control": "no-store" } });
    } catch (error) {
        console.error("[viewing-session-speech] Google TTS request failed", error instanceof Error ? error.name : "unknown");
        return NextResponse.json({ error: "AI voice is temporarily unavailable." }, { status: 502 });
    }
}
