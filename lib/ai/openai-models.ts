import { unstable_cache } from "next/cache";
import { settingsService } from "@/lib/settings/service";
import { SETTINGS_DOMAINS, SETTINGS_SECRET_KEYS } from "@/lib/settings/constants";
import { AI_PROVIDER_CATALOG_CACHE_TAG } from "@/lib/ai/provider-cache";
import { resolveAuthenticatedDbUserId } from "@/lib/auth/current-user";
import { getStoredProviderModelOptions } from "@/lib/ai/provider-model-catalog";

export const OPENAI_MODEL_VALUE_PREFIX = "openai:";
export const OPENAI_DEFAULT_TEXT_MODEL = "gpt-4o-mini";
export const OPENAI_DEFAULT_IMAGE_MODEL = "gpt-image-2";

export type OpenAiModelOption = {
    value: string;
    label: string;
    description?: string;
};

type OpenAiModelsResponse = {
    data?: Array<{
        id?: string;
        object?: string;
        created?: number;
        owned_by?: string;
    }>;
};

const FALLBACK_OPENAI_TEXT_MODELS: OpenAiModelOption[] = [
    { value: `${OPENAI_MODEL_VALUE_PREFIX}gpt-4o-mini`, label: "OpenAI GPT-4o Mini" },
    { value: `${OPENAI_MODEL_VALUE_PREFIX}gpt-4o`, label: "OpenAI GPT-4o" },
    { value: `${OPENAI_MODEL_VALUE_PREFIX}gpt-4.1-mini`, label: "OpenAI GPT-4.1 Mini" },
    { value: `${OPENAI_MODEL_VALUE_PREFIX}gpt-4.1`, label: "OpenAI GPT-4.1" },
];

const FALLBACK_OPENAI_IMAGE_MODELS: OpenAiModelOption[] = [
    {
        value: `${OPENAI_MODEL_VALUE_PREFIX}${OPENAI_DEFAULT_IMAGE_MODEL}`,
        label: "OpenAI GPT Image 2",
        description: "OpenAI image generation and editing model",
    },
    {
        value: `${OPENAI_MODEL_VALUE_PREFIX}gpt-image-1.5`,
        label: "OpenAI GPT Image 1.5",
        description: "OpenAI image generation and editing model",
    },
    {
        value: `${OPENAI_MODEL_VALUE_PREFIX}gpt-image-1`,
        label: "OpenAI GPT Image 1",
        description: "OpenAI image generation and editing model",
    },
];

export function normalizeOpenAiModelValue(modelId: string): string {
    const trimmed = String(modelId || "").trim();
    if (!trimmed) return "";
    return trimmed.startsWith(OPENAI_MODEL_VALUE_PREFIX)
        ? trimmed
        : `${OPENAI_MODEL_VALUE_PREFIX}${trimmed}`;
}

export function stripOpenAiModelPrefix(modelId: string): string {
    const trimmed = String(modelId || "").trim();
    return trimmed.startsWith(OPENAI_MODEL_VALUE_PREFIX)
        ? trimmed.slice(OPENAI_MODEL_VALUE_PREFIX.length)
        : trimmed;
}

export function isLikelyOpenAiTextGenerationModel(modelId: string): boolean {
    const id = modelId.toLowerCase();
    if (!id) return false;
    if (id.includes("transcribe") || id.includes("tts") || id.includes("whisper")) return false;
    if (id.includes("audio") || id.includes("realtime")) return false;
    if (id.includes("embedding") || id.includes("moderation")) return false;
    if (id.includes("image") || id.includes("sora") || id.includes("dall-e")) return false;
    return id.startsWith("gpt-") || id.startsWith("chatgpt-") || id.startsWith("o");
}

export function isLikelyOpenAiImageGenerationModel(modelId: string): boolean {
    const id = modelId.toLowerCase();
    if (!id) return false;
    return id.includes("image") || id.includes("dall-e");
}

export function labelOpenAiModel(modelId: string): string {
    return `OpenAI ${modelId
        .split("-")
        .map((part) => {
            if (!part) return part;
            if (part.toLowerCase() === "gpt") return "GPT";
            if (/^o\d/i.test(part)) return part.toLowerCase();
            return part[0].toUpperCase() + part.slice(1);
        })
        .join(" ")}`;
}

function dedupeModelOptions(models: OpenAiModelOption[]): OpenAiModelOption[] {
    const seen = new Set<string>();
    const result: OpenAiModelOption[] = [];
    for (const model of models) {
        const value = normalizeOpenAiModelValue(model.value);
        if (!value || seen.has(value)) continue;
        seen.add(value);
        result.push({
            ...model,
            value,
            label: model.label || labelOpenAiModel(stripOpenAiModelPrefix(value)),
        });
    }
    return result;
}

function sortOpenAiModels(models: OpenAiModelOption[]): OpenAiModelOption[] {
    return [...models].sort((a, b) => b.value.localeCompare(a.value, undefined, { numeric: true }));
}

async function resolveLocationOpenAiDefaultModel(locationId?: string): Promise<string | null> {
    const normalizedLocationId = String(locationId || "").trim();
    if (!normalizedLocationId) return null;

    const doc = await settingsService.getDocument<any>({
        scopeType: "LOCATION",
        scopeId: normalizedLocationId,
        domain: SETTINGS_DOMAINS.LOCATION_AI,
    }).catch(() => null);

    return normalizeOpenAiModelValue(String(doc?.payload?.openAiTextModel || "").trim()) || null;
}

async function resolveUserOpenAiDefaultModel(userId: string): Promise<string | null> {
    const normalizedUserId = String(userId || "").trim();
    if (!normalizedUserId) return null;

    const doc = await settingsService.getDocument<any>({
        scopeType: "USER",
        scopeId: normalizedUserId,
        domain: SETTINGS_DOMAINS.USER_OPENAI_INTEGRATIONS,
    }).catch(() => null);

    return normalizeOpenAiModelValue(String(doc?.payload?.defaultTextModel || "").trim()) || null;
}

export function resolveOpenAiDefaultModelFromOptions(
    models: OpenAiModelOption[],
    preferredModel?: string | null
): string {
    const preferred = normalizeOpenAiModelValue(String(preferredModel || "").trim());
    if (preferred && models.some((model) => model.value === preferred)) {
        return preferred;
    }

    const fallbackDefault = `${OPENAI_MODEL_VALUE_PREFIX}${OPENAI_DEFAULT_TEXT_MODEL}`;
    return models.find((model) => model.value === fallbackDefault)?.value
        || models[0]?.value
        || fallbackDefault;
}

export function ensureOpenAiModelOption(
    models: OpenAiModelOption[],
    modelId?: string | null
): OpenAiModelOption[] {
    const value = normalizeOpenAiModelValue(String(modelId || "").trim());
    if (!value || models.some((model) => model.value === value)) return models;
    return [
        {
            value,
            label: labelOpenAiModel(stripOpenAiModelPrefix(value)),
        },
        ...models,
    ];
}

export async function resolveOpenAiApiKey(
    locationId?: string,
    options: { includeAuthenticatedUser?: boolean } = {}
): Promise<string | null> {
    if (options.includeAuthenticatedUser !== false) {
        const userSecret = await resolveAuthenticatedUserOpenAiApiKey();
        if (userSecret) return userSecret;
    }

    if (locationId) {
        const locationSecret = await settingsService.getSecret({
            scopeType: "LOCATION",
            scopeId: locationId,
            domain: SETTINGS_DOMAINS.LOCATION_AI,
            secretKey: SETTINGS_SECRET_KEYS.OPENAI_API_KEY,
        }).catch(() => null);
        if (locationSecret) return locationSecret;
    }

    return String(process.env.OPENAI_API_KEY || "").trim() || null;
}

async function resolveAuthenticatedUserOpenAiApiKey(): Promise<string | null> {
    try {
        const userId = await resolveAuthenticatedDbUserId();
        return userId ? resolveUserOpenAiApiKey(userId) : null;
    } catch {
        return null;
    }
}

export async function hasOpenAiApiKey(locationId?: string): Promise<boolean> {
    return Boolean(await resolveOpenAiApiKey(locationId));
}

async function resolveUserOpenAiApiKey(userId: string): Promise<string | null> {
    const normalizedUserId = String(userId || "").trim();
    if (!normalizedUserId) return null;

    const doc = await settingsService.getDocument<any>({
        scopeType: "USER",
        scopeId: normalizedUserId,
        domain: SETTINGS_DOMAINS.USER_OPENAI_INTEGRATIONS,
    }).catch(() => null);
    if (doc?.payload?.enabled !== true) return null;

    return await settingsService.getSecret({
        scopeType: "USER",
        scopeId: normalizedUserId,
        domain: SETTINGS_DOMAINS.USER_OPENAI_INTEGRATIONS,
        secretKey: SETTINGS_SECRET_KEYS.OPENAI_API_KEY,
    }).catch(() => null);
}

export async function fetchOpenAiModels(apiKey: string): Promise<OpenAiModelsResponse["data"] | null> {
    const response = await fetch("https://api.openai.com/v1/models", {
        headers: {
            Authorization: `Bearer ${apiKey}`,
        },
    });

    if (!response.ok) {
        console.error(`[OpenAI Model Fetch] Failed: ${response.status} ${response.statusText}`);
        return null;
    }

    const data = await response.json() as OpenAiModelsResponse;
    return Array.isArray(data.data) ? data.data : [];
}

function buildOpenAiModelOptions(apiModels: NonNullable<OpenAiModelsResponse["data"]>): OpenAiModelOption[] {
    const discovered = apiModels
        .map((model) => String(model.id || "").trim())
        .filter(isLikelyOpenAiTextGenerationModel)
        .map((id) => ({
            value: normalizeOpenAiModelValue(id),
            label: labelOpenAiModel(id),
            description: "OpenAI text generation model",
        }));

    return sortOpenAiModels(dedupeModelOptions([...discovered, ...FALLBACK_OPENAI_TEXT_MODELS]));
}

function buildOpenAiImageModelOptions(apiModels: NonNullable<OpenAiModelsResponse["data"]>): OpenAiModelOption[] {
    const discovered = apiModels
        .map((model) => String(model.id || "").trim())
        .filter(isLikelyOpenAiImageGenerationModel)
        .map((id) => ({
            value: normalizeOpenAiModelValue(id),
            label: labelOpenAiModel(id),
            description: "OpenAI image generation and editing model",
        }));

    return sortOpenAiModels(dedupeModelOptions([...discovered, ...FALLBACK_OPENAI_IMAGE_MODELS]));
}

export const getAvailableOpenAiTextModels = unstable_cache(
    async (locationId?: string): Promise<OpenAiModelOption[]> => {
        try {
            const storedModels = locationId
                ? [
                    ...(await getStoredProviderModelOptions({
                        provider: "openai_api",
                        scopeType: "LOCATION",
                        scopeId: locationId,
                        taskId: "general.text",
                    })),
                    ...(await getStoredProviderModelOptions({
                        provider: "openai_api",
                        scopeType: "GLOBAL",
                        scopeId: "global",
                        taskId: "general.text",
                    })),
                ]
                : await getStoredProviderModelOptions({
                    provider: "openai_api",
                    scopeType: "GLOBAL",
                    scopeId: "global",
                    taskId: "general.text",
                });
            if (storedModels.length > 0) {
                return sortOpenAiModels(dedupeModelOptions(storedModels));
            }

            const apiKey = await resolveOpenAiApiKey(locationId, { includeAuthenticatedUser: false });
            if (!apiKey) return FALLBACK_OPENAI_TEXT_MODELS;

            const models = await fetchOpenAiModels(apiKey);
            if (!models) return FALLBACK_OPENAI_TEXT_MODELS;

            return buildOpenAiModelOptions(models);
        } catch (error) {
            console.error("[OpenAI Model Fetch] Error:", error);
            return FALLBACK_OPENAI_TEXT_MODELS;
        }
    },
    ["available-openai-text-models"],
    { revalidate: 60 * 60 * 24, tags: [AI_PROVIDER_CATALOG_CACHE_TAG] }
);

export const getAvailableOpenAiTextModelsForUser = unstable_cache(
    async (userId: string): Promise<OpenAiModelOption[]> => {
        try {
            const storedModels = await getStoredProviderModelOptions({
                provider: "openai_api",
                scopeType: "USER",
                scopeId: userId,
                taskId: "general.text",
            });
            if (storedModels.length > 0) {
                return sortOpenAiModels(dedupeModelOptions(storedModels));
            }

            const apiKey = await resolveUserOpenAiApiKey(userId);
            if (!apiKey) return FALLBACK_OPENAI_TEXT_MODELS;

            const models = await fetchOpenAiModels(apiKey);
            if (!models) return FALLBACK_OPENAI_TEXT_MODELS;

            return buildOpenAiModelOptions(models);
        } catch (error) {
            console.error("[OpenAI User Model Fetch] Error:", error);
            return FALLBACK_OPENAI_TEXT_MODELS;
        }
    },
    ["available-openai-user-text-models"],
    { revalidate: 60 * 60 * 24, tags: [AI_PROVIDER_CATALOG_CACHE_TAG] }
);

export const getAvailableOpenAiImageModels = unstable_cache(
    async (locationId?: string): Promise<OpenAiModelOption[]> => {
        try {
            const storedModels = locationId
                ? [
                    ...(await getStoredProviderModelOptions({
                        provider: "openai_api",
                        scopeType: "LOCATION",
                        scopeId: locationId,
                        taskId: "property.image.generation",
                    })),
                    ...(await getStoredProviderModelOptions({
                        provider: "openai_api",
                        scopeType: "GLOBAL",
                        scopeId: "global",
                        taskId: "property.image.generation",
                    })),
                ]
                : await getStoredProviderModelOptions({
                    provider: "openai_api",
                    scopeType: "GLOBAL",
                    scopeId: "global",
                    taskId: "property.image.generation",
                });
            if (storedModels.length > 0) {
                return sortOpenAiModels(dedupeModelOptions(storedModels));
            }

            const apiKey = await resolveOpenAiApiKey(locationId);
            if (!apiKey) return [];

            const models = await fetchOpenAiModels(apiKey);
            if (!models) return FALLBACK_OPENAI_IMAGE_MODELS;

            return buildOpenAiImageModelOptions(models);
        } catch (error) {
            console.error("[OpenAI Image Model Fetch] Error:", error);
            return FALLBACK_OPENAI_IMAGE_MODELS;
        }
    },
    ["available-openai-image-models"],
    { revalidate: 60 * 60 * 24, tags: [AI_PROVIDER_CATALOG_CACHE_TAG] }
);

export async function getOpenAiTextModelPickerState(locationId?: string): Promise<{
    models: OpenAiModelOption[];
    defaultModel: string;
}>;
export async function getOpenAiTextModelPickerState(
    locationId?: string,
    options: { includeAuthenticatedUser?: boolean } = {}
): Promise<{
    models: OpenAiModelOption[];
    defaultModel: string;
}> {
    const includeAuthenticatedUser = options.includeAuthenticatedUser !== false;
    const userId = includeAuthenticatedUser ? await resolveAuthenticatedDbUserId() : null;
    const userKey = userId ? await resolveUserOpenAiApiKey(userId) : null;
    const models = userId && userKey
        ? await getAvailableOpenAiTextModelsForUser(userId)
        : await getAvailableOpenAiTextModels(locationId);
    const preferredModel = userId && userKey
        ? await resolveUserOpenAiDefaultModel(userId)
        : await resolveLocationOpenAiDefaultModel(locationId);
    const defaultModel = resolveOpenAiDefaultModelFromOptions(models, preferredModel);
    const pickerModels = ensureOpenAiModelOption(models, preferredModel || defaultModel);

    return { models: pickerModels, defaultModel };
}

export async function getOpenAiImageModelPickerState(locationId?: string): Promise<{
    models: OpenAiModelOption[];
    defaultModel: string;
}> {
    const models = await getAvailableOpenAiImageModels(locationId);
    const defaultModel = models.find((model) => model.value === `${OPENAI_MODEL_VALUE_PREFIX}${OPENAI_DEFAULT_IMAGE_MODEL}`)?.value
        || models[0]?.value
        || "";

    return { models, defaultModel };
}
