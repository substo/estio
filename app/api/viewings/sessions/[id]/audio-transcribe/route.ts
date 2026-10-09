import { NextRequest, NextResponse } from "next/server";
import { GoogleGenerativeAI } from "@google/generative-ai";
import db from "@/lib/db";
import { resolveLocationGoogleAiApiKey } from "@/lib/ai/location-google-key";
import { resolveLocationOpenAiApiKey } from "@/lib/ai/location-openai-key";
import { securelyRecordAiUsage } from "@/lib/ai/usage-metering";
import { resolveViewingSessionRequestContext } from "@/lib/viewings/sessions/auth";

import { quickAssistModelOptions, selectQuickAssistModel } from "@/lib/viewings/sessions/quick-assist-models";
import { estimateQuickAssistCost, googleUsageCounts } from "@/lib/viewings/sessions/quick-assist-cost";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TRANSCRIBE_PROMPT =
    "Transcribe this audio verbatim in the spoken language. Return plain text only. Do not summarize or translate.";

function asString(value: unknown): string {
    return String(value || "").trim();
}

export async function POST(
    req: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const { id } = await params;
    const sessionId = asString(id);
    if (!sessionId) {
        return NextResponse.json({ success: false, error: "Missing session id." }, { status: 400 });
    }

    const tokenOverride = asString(req.nextUrl.searchParams.get("accessToken")) || null;
    const context = await resolveViewingSessionRequestContext({
        request: req,
        sessionId,
        allowClientToken: true,
        allowAgentToken: true,
        tokenOverride,
    });
    if (!context) {
        return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    }

    const session = await db.viewingSession.findUnique({
        where: { id: context.sessionId },
        select: {
            id: true,
            locationId: true,
            translationModel: true,
        },
    });
    if (!session) {
        return NextResponse.json({ success: false, error: "Viewing session not found." }, { status: 404 });
    }

    const formData = await req.formData().catch(() => null);
    const file = formData?.get("file");
    if (!(file instanceof File)) {
        return NextResponse.json({ success: false, error: "Missing audio file." }, { status: 400 });
    }
    if (file.size <= 0) {
        return NextResponse.json({ success: false, error: "Audio file is empty." }, { status: 400 });
    }

    const [apiKey, openaiKey] = await Promise.all([
        resolveLocationGoogleAiApiKey(session.locationId),
        resolveLocationOpenAiApiKey(session.locationId),
    ]);
    if (!apiKey && !openaiKey) {
        return NextResponse.json({ success: false, error: "Connect a Google or OpenAI API key for this location in Settings → Integrations." }, { status: 503 });
    }

    try {
        const selected = selectQuickAssistModel(quickAssistModelOptions({ google: !!apiKey, openai: !!openaiKey, codex: false }).transcribe, asString(formData?.get("model")) || "automatic");
        if (selected.provider === "OpenAI API" && openaiKey) {
            const body = new FormData();
            body.set("file", file);
            body.set("model", selected.model);
            const response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
                method: "POST",
                headers: { Authorization: `Bearer ${openaiKey}` },
                body,
                signal: AbortSignal.timeout(30_000),
            });
            if (!response.ok) throw new Error(`OpenAI transcription failed (${response.status}). Check the connection in Settings → Integrations.`);
            const payload = await response.json();
            const transcript = asString(payload?.text);
            if (!transcript) return NextResponse.json({ success: false, error: "Transcript was empty." }, { status: 422 });
            const counts = { inputTokens: Number(payload.usage?.input_tokens || 0), outputTokens: Number(payload.usage?.output_tokens || 0), usageAvailable: payload.usage?.type === "tokens" };
            const cost = estimateQuickAssistCost({ model: selected.model, ...counts });
            await securelyRecordAiUsage({
                locationId: session.locationId,
                resourceType: "viewing_session",
                resourceId: session.id,
                featureArea: "audio_transcription",
                action: "viewing_session_audio_transcribe",
                provider: "openai",
                model: selected.model,
                inputTokens: counts.inputTokens,
                outputTokens: counts.outputTokens,
                estimatedCostUsd: cost.amount,
                metadata: { costStatus: cost.status, calculation: cost.calculation, pricingSource: cost.rate?.sourceUrl, pricingVerifiedAt: cost.rate?.verifiedAt, mode: "Transcribe", source: "viewing-session-audio-transcribe", sessionId: session.id, mimeType: asString(file.type) || "audio/webm", size: file.size },
            });
            return NextResponse.json({ success: true, transcript, model: selected.model, provider: selected.provider, cost, mimeType: asString(file.type) || "audio/webm", size: file.size });
        }

        const bytes = Buffer.from(await file.arrayBuffer());
        const modelName = selected.model;
        const model = new GoogleGenerativeAI(apiKey!).getGenerativeModel({
            model: modelName,
            generationConfig: { temperature: 0, responseMimeType: "text/plain" },
        });
        const result = await model.generateContent([
            { text: TRANSCRIBE_PROMPT },
            {
                inlineData: {
                    mimeType: asString(file.type) || "audio/webm",
                    data: bytes.toString("base64"),
                },
            },
        ] as any);

        const transcript = asString(result.response.text());
        if (!transcript) {
            return NextResponse.json({ success: false, error: "Transcript was empty." }, { status: 422 });
        }

        const counts = googleUsageCounts(result.response.usageMetadata, true);
        const cost = estimateQuickAssistCost({ model: modelName, ...counts });

        await securelyRecordAiUsage({
            locationId: session.locationId,
            resourceType: "viewing_session",
            resourceId: session.id,
            featureArea: "audio_transcription",
            action: "viewing_session_audio_transcribe",
            provider: "google_gemini",
            model: modelName,
            inputTokens: counts.inputTokens,
            outputTokens: counts.outputTokens,
            estimatedCostUsd: cost.amount,
            metadata: {
                costStatus: cost.status, calculation: cost.calculation, pricingSource: cost.rate?.sourceUrl, pricingVerifiedAt: cost.rate?.verifiedAt, mode: "Transcribe",
                source: "viewing-session-audio-transcribe",
                sessionId: session.id,
                mimeType: asString(file.type) || "audio/webm",
                size: file.size,
            },
        });

        return NextResponse.json({
            success: true,
            transcript,
            model: modelName, provider: selected.provider, cost,
            mimeType: asString(file.type) || "audio/webm",
            size: file.size,
        });
    } catch (error: any) {
        return NextResponse.json(
            { success: false, error: String(error?.message || "Audio transcription failed.") },
            { status: 500 }
        );
    }
}
