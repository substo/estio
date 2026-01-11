
import { NextRequest, NextResponse } from "next/server";
import { runImportWorkflow, runPasteImportWorkflow } from "@/lib/crm/import-workflow";
import { currentUser } from "@clerk/nextjs/server";
import db from "@/lib/db";

export const dynamic = 'force-dynamic';
export const maxDuration = 300; // 5 minutes

export async function POST(req: NextRequest) {
    const user = await currentUser();
    if (!user) return new NextResponse("Unauthorized", { status: 401 });

    const body = await req.json();

    // Fetch default model from user config
    const userWithConfig = await db.user.findUnique({
        where: { id: user.id },
        include: { locations: { include: { siteConfig: true } } }
    });
    const config = userWithConfig?.locations?.[0]?.siteConfig as any;
    const defaultModel = config?.googleAiModel || "gemini-2.0-flash";

    const { text, analysisImages, galleryImages, model = defaultModel, hints, maxImages = 50 } = body;

    const encoder = new TextEncoder();

    const stream = new ReadableStream({
        async start(controller) {
            try {
                for await (const status of runPasteImportWorkflow(text, analysisImages || [], galleryImages || [], model, user.id, hints)) {
                    const data = JSON.stringify(status) + "\n";
                    controller.enqueue(encoder.encode(data));
                }
            } catch (error) {
                console.error("Stream error:", error);
                const errorData = JSON.stringify({ type: 'error', message: "Internal Stream Error" }) + "\n";
                controller.enqueue(encoder.encode(errorData));
            } finally {
                controller.close();
            }
        },
    });

    return new NextResponse(stream, {
        headers: {
            "Content-Type": "text/plain; charset=utf-8",
            "Transfer-Encoding": "chunked",
            "X-Content-Type-Options": "nosniff",
        },
    });
}

export async function GET(req: NextRequest) {
    const searchParams = req.nextUrl.searchParams;
    const notionUrl = searchParams.get("notionUrl");
    const model = searchParams.get("model") || "gemini-2.0-flash";
    const userHints = searchParams.get("hints") || undefined;

    const user = await currentUser();

    if (!user) {
        return new NextResponse("Unauthorized", { status: 401 });
    }

    if (!notionUrl) {
        return new NextResponse("Missing notionUrl param", { status: 400 });
    }

    const encoder = new TextEncoder();

    const maxImages = parseInt(searchParams.get("maxImages") || "50", 10);

    const stream = new ReadableStream({
        async start(controller) {
            try {
                for await (const status of runImportWorkflow(notionUrl, model, user.id, userHints, maxImages)) {
                    // We send each update as a JSON line
                    const data = JSON.stringify(status) + "\n";
                    controller.enqueue(encoder.encode(data));
                }
            } catch (error) {
                console.error("Stream error:", error);
                const errorData = JSON.stringify({ type: 'error', message: "Internal Stream Error" }) + "\n";
                controller.enqueue(encoder.encode(errorData));
            } finally {
                controller.close();
            }
        },
    });

    return new NextResponse(stream, {
        headers: {
            "Content-Type": "text/plain; charset=utf-8",
            "Transfer-Encoding": "chunked",
            "X-Content-Type-Options": "nosniff",
        },
    });
}
