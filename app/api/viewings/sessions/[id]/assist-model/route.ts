import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import db from "@/lib/db";
import { resolveViewingSessionRequestContext } from "@/lib/viewings/sessions/auth";

export const runtime = "nodejs";

const bodySchema = z.object({
    kind: z.enum(["answer", "transcribe", "translate"]),
    model: z.string().min(1).max(120),
});

const allowedModels = {
    answer: new Set(["automatic", "gemini-2.5-flash-lite", "gemini-2.5-flash", "openai:gpt-4o-mini", "chatgpt_subscription:gpt-5.4-mini", "chatgpt_subscription:gpt-5.4", "chatgpt_subscription:gpt-5.5"]),
    transcribe: new Set(["automatic", "gemini-2.5-flash-lite", "gemini-2.5-flash", "gpt-4o-mini-transcribe", "gpt-4o-transcribe"]),
    translate: new Set(["automatic", "gemini-3.5-live-translate-preview", "gpt-realtime-translate"]),
};

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const sessionId = (await params).id;
    const context = await resolveViewingSessionRequestContext({ request: req, sessionId, allowClientToken: false, allowAgentToken: true });
    if (!context || context.role === "client") return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const parsed = bodySchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success || !allowedModels[parsed.data.kind].has(parsed.data.model)) return NextResponse.json({ error: "Invalid model selection." }, { status: 400 });
    const session = await db.viewingSession.findFirst({ where: { id: sessionId, locationId: context.locationId, deletedAt: null }, select: { id: true } });
    if (!session) return NextResponse.json({ error: "Session not found." }, { status: 404 });
    const model = parsed.data.model === "automatic" ? null : parsed.data.model;
    const data = parsed.data.kind === "answer" ? { assistAnswerModel: model }
        : parsed.data.kind === "transcribe" ? { assistTranscribeModel: model } : { liveModel: model };
    await db.viewingSession.update({ where: { id: sessionId }, data });
    return NextResponse.json({ ok: true });
}
