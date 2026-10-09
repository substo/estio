import { NextRequest, NextResponse } from "next/server";
import db from "@/lib/db";
import { resolveViewingSessionRequestContext } from "@/lib/viewings/sessions/auth";
import { getLocationTranslationEngines } from "@/lib/viewings/sessions/translation-engines";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function respond(req: NextRequest, id: string, refresh: boolean) {
    const context = await resolveViewingSessionRequestContext({ request: req, sessionId: id, allowClientToken: false, allowAgentToken: true });
    if (!context || context.role === "client") return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const session = await db.viewingSession.findUnique({ where: { id: context.sessionId }, select: { locationId: true, liveModel: true } });
    if (!session || session.locationId !== context.locationId) return NextResponse.json({ error: "Session not found." }, { status: 404 });
    const engines = await getLocationTranslationEngines(session.locationId, refresh);
    return NextResponse.json({ engines, selectedModel: session.liveModel, checkedAt: engines.find((engine) => engine.checkedAt)?.checkedAt || null });
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    return respond(req, (await params).id, false);
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    return respond(req, (await params).id, true);
}
