import { z } from "zod";

import { normalizeUrlImportMaxImages } from "@/lib/properties/url-import-media";

const MAX_REQUEST_BYTES = 256 * 1024;

const urlImportSchema = z.object({
    type: z.literal("url"),
    notionUrl: z.string().trim().url().max(2_048),
    model: z.string().trim().min(1).max(200).optional(),
    hints: z.string().max(5_000).optional(),
    maxImages: z.unknown().optional(),
}).strict();

const pasteImportSchema = z.object({
    type: z.literal("paste"),
    text: z.string().max(200_000),
    analysisImages: z.array(z.string().trim().min(1).max(500)).max(50).default([]),
    galleryImages: z.array(z.string().trim().min(1).max(500)).max(50).default([]),
    model: z.string().trim().min(1).max(200).optional(),
    hints: z.string().max(5_000).optional(),
}).strict();

const importRequestSchema = z.discriminatedUnion("type", [urlImportSchema, pasteImportSchema]);

type ImportEvent = Record<string, unknown>;

export type ImportStreamHandlerDependencies = {
    getAuthenticatedUser: () => Promise<{ id: string } | null>;
    getActiveLocationId: () => Promise<string>;
    getDefaultModel: (locationId: string) => Promise<string>;
    runUrlImport: (input: {
        notionUrl: string;
        model: string;
        clerkUserId: string;
        hints?: string;
        maxImages: number;
    }) => AsyncIterable<ImportEvent>;
    runPasteImport: (input: {
        text: string;
        analysisImages: string[];
        galleryImages: string[];
        model: string;
        clerkUserId: string;
        hints?: string;
    }) => AsyncIterable<ImportEvent>;
    logStreamError?: (error: unknown) => void;
};

function errorResponse(message: string, status: number, headers?: HeadersInit) {
    return new Response(message, {
        status,
        headers: { "Content-Type": "text/plain; charset=utf-8", ...headers },
    });
}

function isSameOriginRequest(request: Request): boolean {
    const origin = request.headers.get("origin");
    const fetchSite = request.headers.get("sec-fetch-site");
    if (!origin || (fetchSite && fetchSite !== "same-origin")) return false;
    try {
        return new URL(origin).origin === new URL(request.url).origin;
    } catch {
        return false;
    }
}

async function readJsonBody(request: Request): Promise<unknown> {
    const contentType = request.headers.get("content-type") || "";
    if (!contentType.toLowerCase().startsWith("application/json")) {
        throw new Response("JSON request body required", { status: 415 });
    }
    const declaredLength = Number(request.headers.get("content-length"));
    if (Number.isFinite(declaredLength) && declaredLength > MAX_REQUEST_BYTES) {
        throw new Response("Request body too large", { status: 413 });
    }
    const body = await request.text();
    if (new TextEncoder().encode(body).byteLength > MAX_REQUEST_BYTES) {
        throw new Response("Request body too large", { status: 413 });
    }
    try {
        return JSON.parse(body);
    } catch {
        throw new Response("Invalid JSON request body", { status: 400 });
    }
}

function streamEvents(events: AsyncIterable<ImportEvent>, logError?: (error: unknown) => void) {
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
        async start(controller) {
            try {
                for await (const event of events) {
                    controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
                }
            } catch (error) {
                logError?.(error);
                controller.enqueue(encoder.encode(`${JSON.stringify({ type: "error", message: "Internal Stream Error" })}\n`));
            } finally {
                controller.close();
            }
        },
    });
    return new Response(stream, {
        headers: {
            "Cache-Control": "no-store",
            "Content-Type": "application/x-ndjson; charset=utf-8",
            "X-Content-Type-Options": "nosniff",
        },
    });
}

export function createImportStreamHandlers(dependencies: ImportStreamHandlerDependencies) {
    return {
        GET: async () => errorResponse("Method Not Allowed", 405, { Allow: "POST" }),
        POST: async (request: Request) => {
            if (!isSameOriginRequest(request)) return errorResponse("Forbidden", 403);

            const user = await dependencies.getAuthenticatedUser();
            if (!user) return errorResponse("Unauthorized", 401);

            let rawBody: unknown;
            try {
                rawBody = await readJsonBody(request);
            } catch (error) {
                if (error instanceof Response) return error;
                return errorResponse("Invalid request", 400);
            }
            const parsed = importRequestSchema.safeParse(rawBody);
            if (!parsed.success) return errorResponse("Invalid import request", 400);

            const locationId = await dependencies.getActiveLocationId();
            const defaultModel = await dependencies.getDefaultModel(locationId);
            const model = parsed.data.model || defaultModel;

            if (parsed.data.type === "url") {
                return streamEvents(dependencies.runUrlImport({
                    notionUrl: parsed.data.notionUrl,
                    model,
                    clerkUserId: user.id,
                    hints: parsed.data.hints,
                    maxImages: normalizeUrlImportMaxImages(parsed.data.maxImages),
                }), dependencies.logStreamError);
            }
            return streamEvents(dependencies.runPasteImport({
                text: parsed.data.text,
                analysisImages: parsed.data.analysisImages,
                galleryImages: parsed.data.galleryImages,
                model,
                clerkUserId: user.id,
                hints: parsed.data.hints,
            }), dependencies.logStreamError);
        },
    };
}
