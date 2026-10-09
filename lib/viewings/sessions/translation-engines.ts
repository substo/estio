import { resolveLocationGoogleAiApiKey } from "@/lib/ai/location-google-key";
import { resolveLocationOpenAiApiKey } from "@/lib/ai/location-openai-key";

export const GOOGLE_TRANSLATE_MODEL = "gemini-3.5-live-translate-preview";
export const OPENAI_TRANSLATE_MODEL = "gpt-realtime-translate";

export type TranslationEngine = {
    provider: "google_gemini_live" | "openai_realtime_translation";
    model: string;
    configured: boolean;
    listed: boolean;
    checkedAt: string | null;
    error: string | null;
};

const cache = new Map<string, { expiresAt: number; engines: TranslationEngine[] }>();

async function listedModels(url: string, headers: HeadersInit, extract: (body: any) => string[]): Promise<string[]> {
    const response = await fetch(url, { headers, signal: AbortSignal.timeout(8_000), cache: "no-store" });
    if (!response.ok) throw new Error(`Model check failed (${response.status}).`);
    return extract(await response.json());
}

async function listedGoogleModels(apiKey: string): Promise<string[]> {
    const ids: string[] = [];
    let pageToken: string | undefined;
    do {
        const params = new URLSearchParams({ pageSize: "1000" });
        if (pageToken) params.set("pageToken", pageToken);
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?${params}`, {
            headers: { "x-goog-api-key": apiKey }, signal: AbortSignal.timeout(8_000), cache: "no-store",
        });
        if (!response.ok) throw new Error(`Model check failed (${response.status}).`);
        const body = await response.json();
        ids.push(...(body.models || []).map((model: any) => String(model.baseModelId || model.name || "").replace(/^models\//, "")));
        pageToken = typeof body.nextPageToken === "string" ? body.nextPageToken : undefined;
    } while (pageToken);
    return ids;
}

export async function getLocationTranslationEngines(locationId: string, refresh = false): Promise<TranslationEngine[]> {
    const cached = cache.get(locationId);
    if (!refresh && cached && cached.expiresAt > Date.now()) return cached.engines;
    const [googleKey, openaiKey] = await Promise.all([
        resolveLocationGoogleAiApiKey(locationId),
        resolveLocationOpenAiApiKey(locationId),
    ]);
    const checkedAt = new Date().toISOString();
    const engines = await Promise.all([
        (async (): Promise<TranslationEngine> => {
            const base = { provider: "google_gemini_live" as const, model: GOOGLE_TRANSLATE_MODEL, configured: !!googleKey, listed: false, checkedAt: googleKey ? checkedAt : null, error: googleKey ? null : "Add a Google AI key for this location." };
            if (!googleKey) return base;
            try {
                const ids = await listedGoogleModels(googleKey);
                return { ...base, listed: ids.includes(GOOGLE_TRANSLATE_MODEL), error: ids.includes(GOOGLE_TRANSLATE_MODEL) ? null : "This model was not listed for the location key." };
            } catch (error) {
                return { ...base, error: error instanceof Error ? error.message : "Model check failed." };
            }
        })(),
        (async (): Promise<TranslationEngine> => {
            const base = { provider: "openai_realtime_translation" as const, model: OPENAI_TRANSLATE_MODEL, configured: !!openaiKey, listed: false, checkedAt: openaiKey ? checkedAt : null, error: openaiKey ? null : "Add an OpenAI API key for this location. A ChatGPT subscription does not provide Realtime API access." };
            if (!openaiKey) return base;
            try {
                const ids = await listedModels("https://api.openai.com/v1/models", { Authorization: `Bearer ${openaiKey}` },
                    (body) => (body.data || []).map((model: any) => String(model.id || "")));
                return { ...base, listed: ids.includes(OPENAI_TRANSLATE_MODEL), error: ids.includes(OPENAI_TRANSLATE_MODEL) ? null : "This model was not listed for the location API key." };
            } catch (error) {
                return { ...base, error: error instanceof Error ? error.message : "Model check failed." };
            }
        })(),
    ]);
    cache.set(locationId, { expiresAt: Date.now() + 5 * 60_000, engines });
    return engines;
}

export function providerForTranslationModel(model: string): TranslationEngine["provider"] | null {
    if (model === GOOGLE_TRANSLATE_MODEL) return "google_gemini_live";
    if (model === OPENAI_TRANSLATE_MODEL) return "openai_realtime_translation";
    return null;
}

export function selectTranslationModel(args: {
    requestedModel?: string;
    savedModel?: string | null;
    engines: TranslationEngine[];
}): { model: string; provider: TranslationEngine["provider"] } | null {
    const model = args.requestedModel === "automatic"
        ? args.engines.find((engine) => engine.configured && engine.listed)?.model
        : args.requestedModel || args.savedModel;
    const engine = args.engines.find((item) => item.model === model && item.configured && item.listed);
    return engine ? { model: engine.model, provider: engine.provider } : null;
}
