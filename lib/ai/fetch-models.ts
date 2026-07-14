import db from "@/lib/db";
import { settingsService } from "@/lib/settings/service";
import { SETTINGS_DOMAINS } from "@/lib/settings/constants";
import {
    GEMINI_DRAFT_FAST_DEFAULT,
    GEMINI_FLASH_LITE_LATEST_ALIAS,
    GEMINI_FLASH_LATEST_ALIAS,
    GEMINI_FLASH_STABLE_FALLBACK,
    GEMINI_IMAGE_FAST_DEFAULT,
    GEMINI_IMAGE_GENERAL_DEFAULT,
    GEMINI_IMAGE_LEGACY_FALLBACK,
    GOOGLE_AI_MODELS as FALLBACK_MODELS,
} from "./models";
import { buildPropertyImageModelCatalog } from "./model-capabilities";
import { getStoredProviderModelOptions } from "@/lib/ai/provider-model-catalog";
import { unstable_cache } from "next/cache";

export interface ModelOption {
    value: string;
    label: string;
    description?: string;
}

export type AiModelDefaultKind = "general" | "draft" | "extraction" | "design" | "imageGeneration" | "transcription" | "translation";

interface ConfiguredAiModelFields {
    googleAiModel: string | null;
    googleAiModelDraft: string | null;
    googleAiModelExtraction: string | null;
    googleAiModelDesign: string | null;
    googleAiModelTranscription: string | null;
    googleAiModelTranslation: string | null;
}

export interface ModelsApiResponse {
    models?: Array<{
        name?: string;
        baseModelId?: string;
        displayName?: string;
        description?: string;
        supportedGenerationMethods?: string[];
    }>;
    nextPageToken?: string;
}

export type ApiModel = NonNullable<ModelsApiResponse["models"]>[number];

async function getGoogleAiApiKey(locationId?: string): Promise<string | undefined> {
    let apiKey = process.env.GOOGLE_API_KEY;

    if (!locationId) return apiKey;

    const siteConfig = await db.siteConfig.findUnique({
        where: { locationId },
        select: { googleAiApiKey: true }
    });

    return siteConfig?.googleAiApiKey || apiKey;
}

function mapCuratedLabel(modelId: string): string | undefined {
    return FALLBACK_MODELS.find((m) => m.value === modelId)?.label;
}

export function normalizeGoogleModelId(model: ApiModel): string | null {
    const baseModelId = typeof model.baseModelId === "string" ? model.baseModelId.trim() : "";
    if (baseModelId) return baseModelId;

    const name = typeof model.name === "string" ? model.name.trim() : "";
    if (!name) return null;

    return name.replace(/^models\//, "") || null;
}

function isGeminiGenerateContentModel(model: ApiModel): boolean {
    const modelId = normalizeGoogleModelId(model);
    if (!modelId) return false;
    if (!modelId.toLowerCase().includes("gemini")) return false;
    return Array.isArray(model.supportedGenerationMethods)
        && model.supportedGenerationMethods.includes("generateContent");
}

function dedupeModelOptions(models: ModelOption[]): ModelOption[] {
    const seen = new Set<string>();
    const deduped: ModelOption[] = [];

    for (const model of models) {
        const value = (model.value || "").trim();
        if (!value || seen.has(value)) continue;
        seen.add(value);
        deduped.push({
            value,
            label: model.label || value,
            description: model.description,
        });
    }

    return deduped;
}

function sortModels(models: ModelOption[]): ModelOption[] {
    return [...models].sort((a, b) =>
        b.label.localeCompare(a.label, undefined, { numeric: true })
    );
}

export async function fetchGoogleModels(apiKey: string): Promise<NonNullable<ModelsApiResponse["models"]> | null> {
    const collected: NonNullable<ModelsApiResponse["models"]> = [];
    let nextPageToken: string | undefined;

    do {
        const params = new URLSearchParams({ key: apiKey, pageSize: "100" });
        if (nextPageToken) params.set("pageToken", nextPageToken);

        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?${params.toString()}`);

        if (!response.ok) {
            console.error(`[Model Fetch] Failed: ${response.status} ${response.statusText}`);
            return null;
        }

        const data = await response.json() as ModelsApiResponse;
        if (Array.isArray(data.models)) {
            collected.push(...data.models);
        }

        nextPageToken = typeof data.nextPageToken === "string" && data.nextPageToken.trim()
            ? data.nextPageToken
            : undefined;
    } while (nextPageToken);

    return collected;
}

function buildModelOptions(apiModels: NonNullable<ModelsApiResponse["models"]>): ModelOption[] {
    const discovered = apiModels
        .filter(isGeminiGenerateContentModel)
        .map((m) => {
            const id = normalizeGoogleModelId(m)!;
            const curatedLabel = mapCuratedLabel(id);
            const displayName = (typeof m.displayName === "string" && m.displayName.trim()) || "";
            return {
                value: id,
                // Prefer curated labels so the UI uses stable product naming.
                label: curatedLabel || displayName || id,
                description: m.description
            } satisfies ModelOption;
        });

    // Merge curated models/aliases so alias-based defaults like `gemini-flash-latest`
    // remain selectable even if the list endpoint omits aliases.
    return dedupeModelOptions([...discovered, ...FALLBACK_MODELS]);
}

function isDeprecatedDraftModelId(value: string): boolean {
    const id = String(value || "").trim().toLowerCase();
    if (!id) return false;
    return id.startsWith("gemini-2.0-");
}

function isDraftPickerModel(model: ModelOption): boolean {
    const id = model.value.toLowerCase();
    if (!id.includes("gemini")) return false;
    if (id.includes("embedding")) return false;
    if (id.includes("robotics")) return false;
    if (isDeprecatedDraftModelId(id)) return false;
    return true;
}

function ensureModelOption(models: ModelOption[], modelId: string): ModelOption[] {
    if (!modelId || models.some((m) => m.value === modelId)) return models;
    const curatedLabel = mapCuratedLabel(modelId);
    return [{ value: modelId, label: curatedLabel || modelId }, ...models];
}

async function getConfiguredAiModelFields(locationId?: string): Promise<ConfiguredAiModelFields | null> {
    if (!locationId) return null;

    const normalize = (value: string | null | undefined) => {
        const trimmed = typeof value === "string" ? value.trim() : "";
        return trimmed || null;
    };

    const [siteConfig, aiDoc] = await Promise.all([
        db.siteConfig.findUnique({
            where: { locationId },
            select: {
                googleAiModel: true,
                googleAiModelExtraction: true,
                googleAiModelDesign: true,
                googleAiModelTranscription: true,
                googleAiModelTranslation: true,
            } as any
        }),
        settingsService.getDocument<any>({
            scopeType: "LOCATION",
            scopeId: locationId,
            domain: SETTINGS_DOMAINS.LOCATION_AI,
        }).catch(() => null),
    ]);

    if (!siteConfig && !aiDoc) {
        return null;
    }

    const payload = aiDoc?.payload && typeof aiDoc.payload === "object" ? aiDoc.payload : {};
    const general = normalize((payload as any).googleAiModel) || normalize(siteConfig?.googleAiModel);

    return {
        googleAiModel: general,
        googleAiModelDraft: normalize((payload as any).googleAiModelDraft) || general,
        googleAiModelExtraction: normalize((payload as any).googleAiModelExtraction) || normalize(siteConfig?.googleAiModelExtraction),
        googleAiModelDesign: normalize((payload as any).googleAiModelDesign) || normalize(siteConfig?.googleAiModelDesign),
        googleAiModelTranscription: normalize((payload as any).googleAiModelTranscription) || normalize((siteConfig as any)?.googleAiModelTranscription),
        googleAiModelTranslation: normalize((payload as any).googleAiModelTranslation) || normalize((siteConfig as any)?.googleAiModelTranslation),
    };
}

function getConfiguredDefaultForKind(fields: ConfiguredAiModelFields | null, kind: AiModelDefaultKind): string | null {
    if (!fields) return null;

    if (kind === "draft") {
        return fields.googleAiModelDraft || fields.googleAiModel || null;
    }

    if (kind === "general") {
        return fields.googleAiModel || null;
    }

    if (kind === "extraction") {
        return fields.googleAiModelExtraction || fields.googleAiModel || null;
    }

    if (kind === "design") {
        return fields.googleAiModelDesign || fields.googleAiModel || null;
    }

    if (kind === "imageGeneration") {
        return null;
    }

    if (kind === "transcription") {
        return fields.googleAiModelTranscription || null;
    }

    if (kind === "translation") {
        return fields.googleAiModelTranslation || null;
    }

    return fields.googleAiModel || null;
}

// Cache the fetch for 1 hour to avoid continuous API calls
export const getAvailableModels = unstable_cache(
    async (locationId?: string): Promise<ModelOption[]> => {
        try {
            const storedModels = locationId
                ? [
                    ...(await getStoredProviderModelOptions({
                        provider: "google_gemini",
                        scopeType: "LOCATION",
                        scopeId: locationId,
                    })),
                    ...(await getStoredProviderModelOptions({
                        provider: "google_gemini",
                        scopeType: "GLOBAL",
                        scopeId: "global",
                    })),
                ]
                : await getStoredProviderModelOptions({
                    provider: "google_gemini",
                    scopeType: "GLOBAL",
                    scopeId: "global",
                });
            if (storedModels.length > 0) {
                return sortModels(dedupeModelOptions(storedModels));
            }

            // 1. Resolve API Key
            const apiKey = await getGoogleAiApiKey(locationId);

            if (!apiKey) {
                console.warn("[Model Fetch] No API Key found. Returning fallback list.");
                return FALLBACK_MODELS;
            }

            // 2. Fetch from Google API Response
            // Using direct fetch and pagination because the list endpoint is paginated.
            const apiModels = await fetchGoogleModels(apiKey);
            if (!apiModels) {
                return FALLBACK_MODELS;
            }

            // 3. Transform, merge curated aliases, and sort for UI
            return sortModels(buildModelOptions(apiModels));

        } catch (error) {
            console.error("[Model Fetch] Error:", error);
            return FALLBACK_MODELS;
        }
    },
    ['available-ai-models'], // Cache Key
    { revalidate: 3600 } // 1 Hour TTL
);

export async function resolveAiDraftDefaultModel(locationId?: string, models?: ModelOption[]): Promise<string> {
    return resolveAiModelDefault(locationId, "draft", models);
}

export async function resolveAiModelDefault(
    locationId?: string,
    kind: AiModelDefaultKind = "general",
    models?: ModelOption[]
): Promise<string> {
    const configuredFields = await getConfiguredAiModelFields(locationId);
    const configured = getConfiguredDefaultForKind(configuredFields, kind);
    if (configured && !(kind === "draft" && isDeprecatedDraftModelId(configured))) {
        return configured;
    }

    const available = models && models.length > 0 ? models : await getAvailableModels(locationId);
    const values = new Set(available.map((m) => m.value));

    if (kind === "draft") {
        if (values.has(GEMINI_DRAFT_FAST_DEFAULT)) {
            return GEMINI_DRAFT_FAST_DEFAULT;
        }

        if (values.has(GEMINI_FLASH_STABLE_FALLBACK)) {
            return GEMINI_FLASH_STABLE_FALLBACK;
        }

        const firstFastDraft = available.find((m) => {
            const id = m.value.toLowerCase();
            if (!id.includes("flash")) return false;
            if (isDeprecatedDraftModelId(id)) return false;
            return true;
        });
        if (firstFastDraft) return firstFastDraft.value;

        return GEMINI_FLASH_STABLE_FALLBACK;
    }

    if (kind === "transcription") {
        if (values.has(GEMINI_FLASH_STABLE_FALLBACK)) {
            return GEMINI_FLASH_STABLE_FALLBACK;
        }

        if (values.has(GEMINI_DRAFT_FAST_DEFAULT)) {
            return GEMINI_DRAFT_FAST_DEFAULT;
        }

        const firstFlash = available.find((m) => m.value.toLowerCase().includes("flash"));
        if (firstFlash) return firstFlash.value;

        return GEMINI_FLASH_STABLE_FALLBACK;
    }

    if (kind === "translation") {
        if (values.has(GEMINI_FLASH_LITE_LATEST_ALIAS)) {
            return GEMINI_FLASH_LITE_LATEST_ALIAS;
        }

        if (values.has(GEMINI_DRAFT_FAST_DEFAULT)) {
            return GEMINI_DRAFT_FAST_DEFAULT;
        }

        if (values.has(GEMINI_FLASH_LATEST_ALIAS)) {
            return GEMINI_FLASH_LATEST_ALIAS;
        }

        if (values.has(GEMINI_FLASH_STABLE_FALLBACK)) {
            return GEMINI_FLASH_STABLE_FALLBACK;
        }

        const firstFlashLite = available.find((m) => m.value.toLowerCase().includes("flash-lite"));
        if (firstFlashLite) return firstFlashLite.value;

        const firstFlash = available.find((m) => m.value.toLowerCase().includes("flash"));
        if (firstFlash) return firstFlash.value;

        return GEMINI_DRAFT_FAST_DEFAULT;
    }

    if (kind === "imageGeneration") {
        if (values.has(GEMINI_IMAGE_FAST_DEFAULT)) {
            return GEMINI_IMAGE_FAST_DEFAULT;
        }

        if (values.has(GEMINI_IMAGE_GENERAL_DEFAULT)) {
            return GEMINI_IMAGE_GENERAL_DEFAULT;
        }

        if (values.has(GEMINI_IMAGE_LEGACY_FALLBACK)) {
            return GEMINI_IMAGE_LEGACY_FALLBACK;
        }

        const firstImageFlashLite = available.find((m) => {
            const id = m.value.toLowerCase();
            return id.includes("image") && id.includes("flash-lite");
        });
        if (firstImageFlashLite) return firstImageFlashLite.value;

        const firstImageFlash = available.find((m) => {
            const id = m.value.toLowerCase();
            return id.includes("image") && id.includes("flash");
        });
        if (firstImageFlash) return firstImageFlash.value;

        const firstImage = available.find((m) => m.value.toLowerCase().includes("image"));
        if (firstImage) return firstImage.value;

        return GEMINI_IMAGE_LEGACY_FALLBACK;
    }

    if (values.has(GEMINI_FLASH_LATEST_ALIAS)) {
        return GEMINI_FLASH_LATEST_ALIAS;
    }

    if (values.has(GEMINI_FLASH_STABLE_FALLBACK)) {
        return GEMINI_FLASH_STABLE_FALLBACK;
    }

    const firstFlash = available.find((m) => m.value.toLowerCase().includes("flash"));
    if (firstFlash) return firstFlash.value;

    return GEMINI_FLASH_STABLE_FALLBACK;
}

export async function getAiDraftModelPickerState(locationId?: string): Promise<{ models: ModelOption[]; defaultModel: string }> {
    const googleState = await getAiModelPickerState(locationId, "draft");
    const { getOpenAiTextModelPickerState, hasOpenAiApiKey } = await import("@/lib/ai/openai-models");
    const { getChatGptSubscriptionModelPickerState, hasChatGptSubscriptionAuth } = await import("@/lib/ai/chatgpt-subscription");
    const [openAiAvailable, chatGptSubscriptionAvailable] = await Promise.all([
        hasOpenAiApiKey(locationId),
        hasChatGptSubscriptionAuth(),
    ]);
    if (!openAiAvailable && !chatGptSubscriptionAvailable) {
        return googleState;
    }

    const [openAiState, chatGptSubscriptionState] = await Promise.all([
        openAiAvailable
            ? getOpenAiTextModelPickerState(locationId)
            : Promise.resolve({ models: [] as ModelOption[], defaultModel: "" }),
        chatGptSubscriptionAvailable
            ? getChatGptSubscriptionModelPickerState()
            : Promise.resolve({ models: [] as ModelOption[], defaultModel: "" }),
    ]);

    return buildAiDraftModelPickerStateResult(
        googleState.models,
        [...openAiState.models, ...chatGptSubscriptionState.models],
        googleState.defaultModel,
        openAiState.defaultModel
    );
}

export function buildAiDraftModelPickerStateResult(
    googleModels: ModelOption[],
    openAiModels: ModelOption[],
    googleDefaultModel: string,
    openAiDefaultModel?: string | null
): { models: ModelOption[]; defaultModel: string } {
    const openAiDefault = String(openAiDefaultModel || "").trim();
    const mergedModels = dedupeModelOptions([
        ...googleModels,
        ...openAiModels,
    ]);
    const defaultModel = openAiDefault && mergedModels.some((model) => model.value === openAiDefault)
        ? openAiDefault
        : googleDefaultModel;

    return {
        models: mergedModels,
        defaultModel,
    };
}

export async function getAiModelPickerState(
    locationId?: string,
    kind: AiModelDefaultKind = "general"
): Promise<{ models: ModelOption[]; defaultModel: string }> {
    const allModels = await getAvailableModels(locationId);
    const draftModels = sortModels(allModels.filter(isDraftPickerModel));
    const defaultModel = await resolveAiModelDefault(locationId, kind, draftModels);

    return {
        models: ensureModelOption(draftModels, defaultModel),
        defaultModel
    };
}

export function buildAiModelPickerDefaultsResult(
    pickerModels: ModelOption[],
    openAiModels: ModelOption[],
    defaults: Record<AiModelDefaultKind, string>,
    options: { textDefaultModel?: string | null } = {}
): {
    models: ModelOption[];
    defaults: Record<AiModelDefaultKind, string>;
} {
    const textDefaultModel = String(options.textDefaultModel || "").trim();
    const textDefaultAvailable = !!textDefaultModel
        && [...pickerModels, ...openAiModels].some((model) => model.value === textDefaultModel);
    const resolvedDefaults = textDefaultAvailable
        ? {
            ...defaults,
            general: textDefaultModel,
            draft: textDefaultModel,
        }
        : defaults;

    const models = dedupeModelOptions([
        ...pickerModels,
        ...openAiModels,
        { value: resolvedDefaults.general, label: mapCuratedLabel(resolvedDefaults.general) || resolvedDefaults.general },
        { value: resolvedDefaults.draft, label: mapCuratedLabel(resolvedDefaults.draft) || resolvedDefaults.draft },
        { value: resolvedDefaults.extraction, label: mapCuratedLabel(resolvedDefaults.extraction) || resolvedDefaults.extraction },
        { value: resolvedDefaults.design, label: mapCuratedLabel(resolvedDefaults.design) || resolvedDefaults.design },
        { value: resolvedDefaults.imageGeneration, label: mapCuratedLabel(resolvedDefaults.imageGeneration) || resolvedDefaults.imageGeneration },
        { value: resolvedDefaults.transcription, label: mapCuratedLabel(resolvedDefaults.transcription) || resolvedDefaults.transcription },
        { value: resolvedDefaults.translation, label: mapCuratedLabel(resolvedDefaults.translation) || resolvedDefaults.translation },
    ]);

    return {
        models: sortModels(models),
        defaults: resolvedDefaults,
    };
}

export async function getAiModelPickerDefaults(locationId?: string): Promise<{
    models: ModelOption[];
    defaults: Record<AiModelDefaultKind, string>;
}> {
    const allModels = await getAvailableModels(locationId);
    const pickerModels = sortModels(allModels.filter(isDraftPickerModel));
    const { getOpenAiTextModelPickerState, hasOpenAiApiKey } = await import("@/lib/ai/openai-models");
    const { getChatGptSubscriptionModelPickerState, hasChatGptSubscriptionAuth } = await import("@/lib/ai/chatgpt-subscription");
    const [openAiAvailable, chatGptSubscriptionAvailable] = await Promise.all([
        hasOpenAiApiKey(locationId),
        hasChatGptSubscriptionAuth(),
    ]);
    const [openAiState, chatGptSubscriptionState] = await Promise.all([
        openAiAvailable
            ? getOpenAiTextModelPickerState(locationId)
            : Promise.resolve({ models: [] as ModelOption[], defaultModel: "" }),
        chatGptSubscriptionAvailable
            ? getChatGptSubscriptionModelPickerState()
            : Promise.resolve({ models: [] as ModelOption[], defaultModel: "" }),
    ]);

    const [general, draft, extraction, design, imageGeneration, transcription, translation] = await Promise.all([
        resolveAiModelDefault(locationId, "general", pickerModels),
        resolveAiModelDefault(locationId, "draft", pickerModels),
        resolveAiModelDefault(locationId, "extraction", pickerModels),
        resolveAiModelDefault(locationId, "design", pickerModels),
        resolveAiModelDefault(locationId, "imageGeneration", allModels),
        resolveAiModelDefault(locationId, "transcription", pickerModels),
        resolveAiModelDefault(locationId, "translation", pickerModels),
    ]);

    return buildAiModelPickerDefaultsResult(
        pickerModels,
        [
            ...openAiState.models,
            ...openAiImageState.models,
            ...chatGptSubscriptionState.models,
            ...chatGptSubscriptionImageState.models,
        ],
        { general, draft, extraction, design, imageGeneration, transcription, translation },
        { textDefaultModel: openAiState.defaultModel }
    );
}

export async function getPropertyImageEnhancementModelCatalog(locationId?: string) {
    const { models, defaults } = await getAiModelPickerDefaults(locationId);
    // Stored provider catalogs can be partial (for example, only image-generation
    // models). Merge curated Gemini fallbacks so analysis does not disappear when
    // the database catalog is stale or incomplete.
    return buildPropertyImageModelCatalog(dedupeModelOptions([...models, ...FALLBACK_MODELS]), defaults);
}
