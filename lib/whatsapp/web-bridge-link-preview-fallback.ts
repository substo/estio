import sharp from "sharp";

import {
    extractPropertyUrlContext,
    fetchPublicHttpResponse,
} from "../conversations/property-url-context";

type FetchLike = typeof fetch;

const DEFAULT_TIMEOUT_MS = 2_500;
const MAX_IMAGE_BYTES = 1024 * 1024;
const MAX_THUMBNAIL_BYTES = 128 * 1024;
const SUPPORTED_IMAGE_TYPES = new Set([
    "image/avif",
    "image/jpeg",
    "image/png",
    "image/webp",
]);

async function readImageWithLimit(response: Response) {
    const declaredSize = Number(response.headers.get("content-length") || 0);
    if (declaredSize > MAX_IMAGE_BYTES) return null;
    const buffer = Buffer.from(await response.arrayBuffer());
    return buffer.length <= MAX_IMAGE_BYTES ? buffer : null;
}

function remainingMs(startedAt: number, timeoutMs: number) {
    return Math.max(timeoutMs - (Date.now() - startedAt), 1);
}

export async function fetchWhatsAppWebBridgeOpenGraphPreview(
    url: string,
    options: {
        fetchImpl?: FetchLike;
        timeoutMs?: number;
        skipPublicUrlValidation?: boolean;
    } = {},
): Promise<Record<string, unknown> | null> {
    try {
        const timeoutMs = Math.min(
            Math.max(Number(options.timeoutMs || DEFAULT_TIMEOUT_MS), 500),
            DEFAULT_TIMEOUT_MS,
        );
        const startedAt = Date.now();
        const context = await extractPropertyUrlContext(url, {
            fetchImpl: options.fetchImpl,
            timeoutMs: remainingMs(startedAt, timeoutMs),
            skipPublicUrlValidation: options.skipPublicUrlValidation,
        });
        if (!context.success || !context.imageUrl) return null;

        const { response } = await fetchPublicHttpResponse(context.imageUrl, {
            fetchImpl: options.fetchImpl,
            timeoutMs: remainingMs(startedAt, timeoutMs),
            skipPublicUrlValidation: options.skipPublicUrlValidation,
            accept: "image/avif,image/webp,image/png,image/jpeg",
            maxRedirects: 3,
        });
        if (!response.ok) return null;
        const contentType = String(response.headers.get("content-type") || "")
            .split(";")[0]
            .trim()
            .toLowerCase();
        if (!SUPPORTED_IMAGE_TYPES.has(contentType)) return null;
        const image = await readImageWithLimit(response);
        if (!image) return null;

        const thumbnail = await sharp(image, {
            failOn: "warning",
            limitInputPixels: 20_000_000,
        })
            .rotate()
            .resize({
                width: 200,
                height: 200,
                fit: "inside",
                withoutEnlargement: true,
            })
            .jpeg({ quality: 72, progressive: false })
            .toBuffer();
        if (!thumbnail.length || thumbnail.length > MAX_THUMBNAIL_BYTES) return null;

        let fallbackTitle = "";
        try {
            fallbackTitle = new URL(context.url || url).hostname;
        } catch {
            fallbackTitle = "";
        }
        const title = String(context.title || fallbackTitle).trim().slice(0, 512);
        const description = String(context.description || "").trim().slice(0, 2_048);
        if (!title) return null;

        return {
            title,
            ...(description ? { description } : {}),
            thumbnail: thumbnail.toString("base64"),
        };
    } catch {
        return null;
    }
}
