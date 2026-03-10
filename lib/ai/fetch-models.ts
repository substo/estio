import db from "@/lib/db";
import {
    GEMINI_DRAFT_FAST_DEFAULT,
    GEMINI_FLASH_LATEST_ALIAS,
    GEMINI_FLASH_STABLE_FALLBACK,
    GOOGLE_AI_MODELS as FALLBACK_MODELS,
} from "./models";
import { unstable_cache } from "next/cache";

export interface ModelOption {
    value: string;
    label: string;
    description?: string;
}

export type AiModelDefaultKind = "general" | "draft" | "extraction" | "design";

interface ConfiguredAiModelFields {
    googleAiModel: string | null;
    googleAiModelExtraction: string | null;
    googleAiModelDesign: string | null;
}

interface ModelsApiResponse {
    models?: Array<{
        name?: string;
        baseModelId?: string;
        displayName?: string;
        description?: string;
        supportedGenerationMethods?: string[];
    }>;
    nextPageToken?: string;
}

type ApiModel = NonNullable<ModelsApiResponse["models"]>[number];

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

function normalizeModelId(model: ApiModel): string | null {
    const baseModelId = typeof model.baseModelId === "string" ? model.baseModelId.trim() : "";
    if (baseModelId) return baseModelId;

    const name = typeof model.name === "string" ? model.name.trim() : "";
    if (!name) return null;

    return name.replace(/^models\//, "") || null;
}

function isGeminiGenerateContentModel(model: ApiModel): boolean {
    const modelId = normalizeModelId(model);
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

async function fetchGoogleModels(apiKey: string): Promise<NonNullable<ModelsApiResponse["models"]> | null> {
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
            const id = normalizeModelId(m)!;
            return {
                value: id,
                label: (typeof m.displayName === "string" && m.displayName.trim()) || mapCuratedLabel(id) || id,
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

    const siteConfig = await db.siteConfig.findUnique({
        where: { locationId },
        select: {
            googleAiModel: true,
            googleAiModelExtraction: true,
            googleAiModelDesign: true,
        }
    });

    if (!siteConfig) {
        return null;
    }

    const normalize = (value: string | null | undefined) => {
        const trimmed = typeof value === "string" ? value.trim() : "";
        return trimmed || null;
    };

    return {
        googleAiModel: normalize(siteConfig.googleAiModel),
        googleAiModelExtraction: normalize(siteConfig.googleAiModelExtraction),
        googleAiModelDesign: normalize(siteConfig.googleAiModelDesign),
    };
}

function getConfiguredDefaultForKind(fields: ConfiguredAiModelFields | null, kind: AiModelDefaultKind): string | null {
    if (!fields) return null;

    if (kind === "draft" || kind === "general") {
        return fields.googleAiModel || null;
    }

    if (kind === "extraction") {
        return fields.googleAiModelExtraction || fields.googleAiModel || null;
    }

    if (kind === "design") {
        return fields.googleAiModelDesign || fields.googleAiModel || null;
    }

    return fields.googleAiModel || null;
}

// Cache the fetch for 1 hour to avoid continuous API calls
export const getAvailableModels = unstable_cache(
    async (locationId?: string): Promise<ModelOption[]> => {
        try {
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
    return getAiModelPickerState(locationId, "draft");
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

export async function getAiModelPickerDefaults(locationId?: string): Promise<{
    models: ModelOption[];
    defaults: Record<AiModelDefaultKind, string>;
}> {
    const allModels = await getAvailableModels(locationId);
    const pickerModels = sortModels(allModels.filter(isDraftPickerModel));

    const [general, draft, extraction, design] = await Promise.all([
        resolveAiModelDefault(locationId, "general", pickerModels),
        resolveAiModelDefault(locationId, "draft", pickerModels),
        resolveAiModelDefault(locationId, "extraction", pickerModels),
        resolveAiModelDefault(locationId, "design", pickerModels),
    ]);

    const models = dedupeModelOptions([
        ...pickerModels,
        { value: general, label: mapCuratedLabel(general) || general },
        { value: draft, label: mapCuratedLabel(draft) || draft },
        { value: extraction, label: mapCuratedLabel(extraction) || extraction },
        { value: design, label: mapCuratedLabel(design) || design },
    ]);

    return {
        models: sortModels(models),
        defaults: { general, draft, extraction, design }
    };
}
