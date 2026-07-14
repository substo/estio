export interface AiModelDescriptor {
    value: string;
    label?: string;
    description?: string;
}

export type AiModelCapability =
    | "text"
    | "json"
    | "vision"
    | "audioInput"
    | "imageGeneration"
    | "imageEdit"
    | "embedding"
    | "tools"
    | "streaming";

export type AiTaskId =
    | "conversation.draft"
    | "conversation.translation"
    | "general.text"
    | "property.import.text"
    | "property.import.vision"
    | "property.print.copy"
    | "property.translation"
    | "property.design"
    | "property.image.analysis"
    | "property.image.generation"
    | "audio.transcription"
    | "contact.requirements"
    | "contact.verification"
    | "viewing.translation"
    | "viewing.insights"
    | "viewing.summary";

export interface AiTaskDefinition {
    id: AiTaskId;
    label: string;
    requiredCapabilities: AiModelCapability[];
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

function isOpenAiTextModel(model: AiModelDescriptor): boolean {
    const value = normalizeModelValue(model.value).toLowerCase();
    return value.startsWith("openai:") && !value.includes("image");
}

function isChatGptSubscriptionTextModel(model: AiModelDescriptor): boolean {
    const value = normalizeModelValue(model.value).toLowerCase();
    return value.startsWith("chatgpt_subscription:") && !value.includes("image");
}

function isOpenAiImageModel(model: AiModelDescriptor): boolean {
    const value = normalizeModelValue(model.value).toLowerCase();
    return value.startsWith("openai:") && (value.includes("image") || value.includes("dall-e"));
}

function isChatGptSubscriptionImageModel(model: AiModelDescriptor): boolean {
    return false;
}

function isExcludedUtilityModel(model: AiModelDescriptor): boolean {
    const value = normalizeModelValue(model.value).toLowerCase();
    return value.includes("embedding")
        || value.includes("robotics")
        || value.includes("tts")
        || value.includes("aqa");
}

export function isLikelyPropertyImageGenerationModel(model: AiModelDescriptor): boolean {
    if (isOpenAiImageModel(model) || isChatGptSubscriptionImageModel(model)) return true;
    if (!isGeminiFamilyModel(model) || isExcludedUtilityModel(model)) return false;

    const value = normalizeModelValue(model.value).toLowerCase();
    const haystack = buildModelHaystack(model);

    if (value.includes("-image")) return true;
    if (value.includes("image-preview")) return true;

    return /\bimage preview\b/.test(haystack)
        || /\bimage generation\b/.test(haystack)
        || /\bimage editing\b/.test(haystack)
        || /\bedit images?\b/.test(haystack)
        || /\bgenerate images?\b/.test(haystack)
        || /\bnano banana\b/.test(haystack);
}

export function isLikelyPropertyImageAnalysisModel(model: AiModelDescriptor): boolean {
    if (isChatGptSubscriptionTextModel(model)) return true;
    if (!isGeminiFamilyModel(model) || isExcludedUtilityModel(model)) return false;
    return !isLikelyPropertyImageGenerationModel(model);
}

export function getModelCapabilities(model: AiModelDescriptor): AiModelCapability[] {
    const value = normalizeModelValue(model.value).toLowerCase();
    const capabilities = new Set<AiModelCapability>();

    if (isOpenAiTextModel(model) || isChatGptSubscriptionTextModel(model)) {
        capabilities.add("text");
        capabilities.add("json");
        if (isChatGptSubscriptionTextModel(model)) {
            capabilities.add("vision");
        }
        capabilities.add("streaming");
        return [...capabilities];
    }

    if (isOpenAiImageModel(model) || isChatGptSubscriptionImageModel(model)) {
        capabilities.add("imageGeneration");
        capabilities.add("imageEdit");
        return [...capabilities];
    }

    if (isGeminiFamilyModel(model) && !isExcludedUtilityModel(model)) {
        if (isLikelyPropertyImageGenerationModel(model)) {
            capabilities.add("imageGeneration");
            capabilities.add("imageEdit");
            return [...capabilities];
        }

        capabilities.add("text");
        capabilities.add("json");
        capabilities.add("vision");

        if (value.includes("flash")) {
            capabilities.add("audioInput");
        }

    }

    if (value.includes("embedding")) {
        capabilities.add("embedding");
    }

    return [...capabilities];
}

export const AI_TASK_DEFINITIONS: Record<AiTaskId, AiTaskDefinition> = {
    "conversation.draft": {
        id: "conversation.draft",
        label: "AI drafts and replies",
        requiredCapabilities: ["text", "json"],
    },
    "conversation.translation": {
        id: "conversation.translation",
        label: "Conversation translation",
        requiredCapabilities: ["text", "json"],
    },
    "general.text": {
        id: "general.text",
        label: "General text generation",
        requiredCapabilities: ["text", "json"],
    },
    "property.import.text": {
        id: "property.import.text",
        label: "Property import text extraction",
        requiredCapabilities: ["text", "json"],
    },
    "property.import.vision": {
        id: "property.import.vision",
        label: "Property import screenshot vision",
        requiredCapabilities: ["vision", "json"],
    },
    "property.print.copy": {
        id: "property.print.copy",
        label: "Property print copy",
        requiredCapabilities: ["text", "json"],
    },
    "property.translation": {
        id: "property.translation",
        label: "Property translation",
        requiredCapabilities: ["text", "json"],
    },
    "property.design": {
        id: "property.design",
        label: "Design and content generation",
        requiredCapabilities: ["text", "json"],
    },
    "property.image.analysis": {
        id: "property.image.analysis",
        label: "Property image analysis",
        requiredCapabilities: ["vision", "json"],
    },
    "property.image.generation": {
        id: "property.image.generation",
        label: "Property image generation and editing",
        requiredCapabilities: ["imageGeneration"],
    },
    "audio.transcription": {
        id: "audio.transcription",
        label: "Audio transcription",
        requiredCapabilities: ["audioInput"],
    },
    "contact.requirements": {
        id: "contact.requirements",
        label: "Contact requirements intelligence",
        requiredCapabilities: ["text", "json"],
    },
    "contact.verification": {
        id: "contact.verification",
        label: "Contact profile verification",
        requiredCapabilities: ["text", "json"],
    },
    "viewing.translation": {
        id: "viewing.translation",
        label: "Viewing-session translation",
        requiredCapabilities: ["text", "json"],
    },
    "viewing.insights": {
        id: "viewing.insights",
        label: "Viewing-session insights",
        requiredCapabilities: ["text", "json"],
    },
    "viewing.summary": {
        id: "viewing.summary",
        label: "Viewing-session summary",
        requiredCapabilities: ["text", "json"],
    },
};

export function modelSupportsTask(model: AiModelDescriptor, taskId: AiTaskId): boolean {
    const task = AI_TASK_DEFINITIONS[taskId];
    if (!task) return true;

    const capabilities = new Set(getModelCapabilities(model));
    return task.requiredCapabilities.every((capability) => capabilities.has(capability));
}

export function filterModelsForTask<T extends AiModelDescriptor>(models: readonly T[], taskId: AiTaskId): T[] {
    return models.filter((model) => modelSupportsTask(model, taskId));
}

export function filterPropertyImageAnalysisModels<T extends AiModelDescriptor>(models: readonly T[]): T[] {
    return filterModelsForTask(models, "property.image.analysis").filter((model) => isLikelyPropertyImageAnalysisModel(model));
}

export function filterPropertyImageGenerationModels<T extends AiModelDescriptor>(models: readonly T[]): T[] {
    return filterModelsForTask(models, "property.image.generation").filter((model) => isLikelyPropertyImageGenerationModel(model));
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

    if (allowed.has("gemini-3.1-flash-lite-image")) {
        return "gemini-3.1-flash-lite-image";
    }

    if (allowed.has("gemini-3.1-flash-image")) {
        return "gemini-3.1-flash-image";
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
        imageGeneration?: string | null;
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
                defaults?.imageGeneration,
                defaults?.design,
                defaults?.general,
            ]),
        },
    };
}
