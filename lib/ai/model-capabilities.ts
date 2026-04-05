export interface AiModelDescriptor {
    value: string;
    label?: string;
    description?: string;
}

export interface PropertyImageModelDefaults {
    analysis: string;
    generation: string;
}

export interface PropertyImageModelCatalog<T extends AiModelDescriptor = AiModelDescriptor> {
    analysisModels: T[];
    generationModels: T[];
    defaults: PropertyImageModelDefaults;
}

function normalizeModelValue(value: string | null | undefined): string {
    return String(value || "").trim();
}

function buildModelHaystack(model: AiModelDescriptor): string {
    return [
        model.value,
        model.label,
        model.description,
    ]
        .map((value) => String(value || "").trim().toLowerCase())
        .filter(Boolean)
        .join(" ");
}

function isGeminiFamilyModel(model: AiModelDescriptor): boolean {
    const value = normalizeModelValue(model.value).toLowerCase();
    return value.includes("gemini");
}

function isExcludedUtilityModel(model: AiModelDescriptor): boolean {
    const value = normalizeModelValue(model.value).toLowerCase();
    return value.includes("embedding")
        || value.includes("robotics")
        || value.includes("tts")
        || value.includes("aqa");
}

export function isLikelyPropertyImageGenerationModel(model: AiModelDescriptor): boolean {
    if (!isGeminiFamilyModel(model) || isExcludedUtilityModel(model)) return false;

    const value = normalizeModelValue(model.value).toLowerCase();
    const haystack = buildModelHaystack(model);

    if (value.includes("-image")) return true;
    if (value.includes("image-preview")) return true;
    if (value.includes("imagen")) return true;

    return /\bimage preview\b/.test(haystack)
        || /\bimage generation\b/.test(haystack)
        || /\bimage editing\b/.test(haystack)
        || /\bedit images?\b/.test(haystack)
        || /\bgenerate images?\b/.test(haystack)
        || /\bnano banana\b/.test(haystack);
}

export function isLikelyPropertyImageAnalysisModel(model: AiModelDescriptor): boolean {
    if (!isGeminiFamilyModel(model) || isExcludedUtilityModel(model)) return false;
    return !isLikelyPropertyImageGenerationModel(model);
}

export function filterPropertyImageAnalysisModels<T extends AiModelDescriptor>(models: readonly T[]): T[] {
    return models.filter((model) => isLikelyPropertyImageAnalysisModel(model));
}

export function filterPropertyImageGenerationModels<T extends AiModelDescriptor>(models: readonly T[]): T[] {
    return models.filter((model) => isLikelyPropertyImageGenerationModel(model));
}

function resolvePreferredModel<T extends AiModelDescriptor>(
    models: readonly T[],
    preferredValues: Array<string | null | undefined>
): string {
    const allowed = new Set(models.map((model) => normalizeModelValue(model.value)).filter(Boolean));

    for (const preferred of preferredValues) {
        const normalized = normalizeModelValue(preferred);
        if (normalized && allowed.has(normalized)) {
            return normalized;
        }
    }

    if (allowed.has("gemini-2.5-flash-image")) {
        return "gemini-2.5-flash-image";
    }

    return normalizeModelValue(models[0]?.value);
}

export function buildPropertyImageModelCatalog<T extends AiModelDescriptor>(
    models: readonly T[],
    defaults?: {
        general?: string | null;
        extraction?: string | null;
        design?: string | null;
    }
): PropertyImageModelCatalog<T> {
    const analysisModels = filterPropertyImageAnalysisModels(models);
    const generationModels = filterPropertyImageGenerationModels(models);

    return {
        analysisModels,
        generationModels,
        defaults: {
            analysis: resolvePreferredModel(analysisModels, [
                defaults?.extraction,
                defaults?.general,
            ]),
            generation: resolvePreferredModel(generationModels, [
                defaults?.design,
                defaults?.general,
            ]),
        },
    };
}
