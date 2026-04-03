import { NextRequest, NextResponse } from "next/server";
import { GoogleGenerativeAI } from "@google/generative-ai";
import db from "@/lib/db";
import { resolveLocationGoogleAiApiKey } from "@/lib/ai/location-google-key";
import { resolveViewingSessionRequestContext } from "@/lib/viewings/sessions/auth";

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

    const apiKey = await resolveLocationGoogleAiApiKey(session.locationId);
    if (!apiKey) {
        return NextResponse.json({ success: false, error: "No Google AI API key configured for this location." }, { status: 503 });
    }

    const bytes = Buffer.from(await file.arrayBuffer());
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({
        model: asString(session.translationModel) || "gemini-2.5-flash",
        generationConfig: {
            temperature: 0,
            responseMimeType: "text/plain",
        },
    });

    try {
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

        return NextResponse.json({
            success: true,
            transcript,
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
