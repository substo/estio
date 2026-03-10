import { GoogleGenerativeAI } from "@google/generative-ai";
import {
    GoogleAICacheManager,
    type CachedContent,
} from "@google/generative-ai/server";

type CacheState = "hit" | "miss" | "disabled" | "error";

type DraftContextModelResult = {
    model: ReturnType<GoogleGenerativeAI["getGenerativeModel"]>;
    cacheState: CacheState;
    cacheName?: string;
};

type DraftContextModelInput = {
    apiKey: string;
    modelName: string;
    generationConfig: Record<string, unknown>;
    cacheKey: string;
    staticContextText: string;
    ttlSeconds?: number;
};

const DEFAULT_CACHE_TTL_SECONDS = 45 * 60;
const LOCAL_CACHE_MARGIN_MS = 30_000;

const inMemoryCache = new Map<string, { cachedContent: CachedContent; expiresAtMs: number }>();
const inFlightCreations = new Map<string, Promise<CachedContent | null>>();

function fastHash(value: string): string {
    let hash = 2166136261;
    for (let i = 0; i < value.length; i += 1) {
        hash ^= value.charCodeAt(i);
        hash +=
            (hash << 1) +
            (hash << 4) +
            (hash << 7) +
            (hash << 8) +
            (hash << 24);
    }
    return Math.abs(hash >>> 0).toString(36);
}

function getContentCacheKey(input: DraftContextModelInput): string {
    return [
        fastHash(input.apiKey),
        input.modelName,
        input.cacheKey,
        fastHash(input.staticContextText),
    ].join(":");
}

async function getOrCreateCachedContent(input: DraftContextModelInput): Promise<{ cachedContent: CachedContent | null; cacheState: CacheState }> {
    const now = Date.now();
    const ttlSeconds = Math.max(60, Math.floor(input.ttlSeconds || DEFAULT_CACHE_TTL_SECONDS));
    const cacheKey = getContentCacheKey(input);

    const existing = inMemoryCache.get(cacheKey);
    if (existing && existing.expiresAtMs > now) {
        return {
            cachedContent: existing.cachedContent,
            cacheState: "hit",
        };
    }

    const existingInflight = inFlightCreations.get(cacheKey);
    if (existingInflight) {
        const cachedContent = await existingInflight;
        return {
            cachedContent,
            cacheState: cachedContent ? "hit" : "error",
        };
    }

    const creationPromise = (async () => {
        try {
            const manager = new GoogleAICacheManager(input.apiKey);
            const created = await manager.create({
                model: input.modelName,
                ttlSeconds,
                displayName: `idx-draft-${fastHash(cacheKey)}`,
                contents: [{
                    role: "user",
                    parts: [{ text: input.staticContextText }],
                }],
            });
            if (created?.name) {
                inMemoryCache.set(cacheKey, {
                    cachedContent: created,
                    expiresAtMs: now + ttlSeconds * 1000 - LOCAL_CACHE_MARGIN_MS,
                });
            }
            return created || null;
        } catch {
            return null;
        } finally {
            inFlightCreations.delete(cacheKey);
        }
    })();

    inFlightCreations.set(cacheKey, creationPromise);
    const cachedContent = await creationPromise;

    return {
        cachedContent,
        cacheState: cachedContent ? "miss" : "error",
    };
}

export async function getDraftModelWithCachedContext(input: DraftContextModelInput): Promise<DraftContextModelResult> {
    const genAI = new GoogleGenerativeAI(input.apiKey);
    const staticText = String(input.staticContextText || "").trim();

    if (!staticText) {
        return {
            model: genAI.getGenerativeModel({
                model: input.modelName,
                generationConfig: input.generationConfig as any,
            }),
            cacheState: "disabled",
        };
    }

    const { cachedContent, cacheState } = await getOrCreateCachedContent(input);
    if (!cachedContent?.name) {
        return {
            model: genAI.getGenerativeModel({
                model: input.modelName,
                generationConfig: input.generationConfig as any,
            }),
            cacheState,
        };
    }

    return {
        model: genAI.getGenerativeModelFromCachedContent(cachedContent, {
            model: input.modelName,
            generationConfig: input.generationConfig as any,
        }),
        cacheState,
        cacheName: cachedContent.name,
    };
}

