import type { ModelOption } from "@/lib/ai/fetch-models";
import { resolveProviderModelForTask } from "@/lib/ai/provider-model-catalog";
import type { AiProviderModelProvider } from "@/lib/ai/provider-model-catalog";
import { modelSupportsTask } from "@/lib/ai/model-capabilities";

export type PropertyImageGenerationModelResolution = {
    model: string;
    provider: AiProviderModelProvider;
    warning?: string;
};

export function resolvePropertyImageGenerationProvider(modelId: string): AiProviderModelProvider {
    const normalized = String(modelId || "").trim();
    if (normalized.startsWith("openai:")) return "openai_api";
    if (normalized.startsWith("chatgpt_subscription:")) return "chatgpt_subscription";
    return "google_gemini";
}

function resolveRequestedFallbackModel(input: {
    requestedModel: string;
    provider: AiProviderModelProvider;
    fallbackModels: ModelOption[];
}): PropertyImageGenerationModelResolution | null {
    if (!input.requestedModel) return null;
    const option = input.fallbackModels.find((model) => model.value === input.requestedModel);
    if (!option || !modelSupportsTask(option, "property.image.generation")) return null;

    return {
        model: option.value,
        provider: input.provider,
    };
}

export async function resolvePropertyImageGenerationModel(input: {
    locationId: string;
    requestedModel?: string | null;
    fallbackModels: ModelOption[];
}): Promise<PropertyImageGenerationModelResolution | null> {
    const requestedModel = String(input.requestedModel || "").trim();
    const requestedProvider = resolvePropertyImageGenerationProvider(requestedModel);

    if (requestedModel && requestedProvider !== "google_gemini") {
        const fallback = resolveRequestedFallbackModel({
            requestedModel,
            provider: requestedProvider,
            fallbackModels: input.fallbackModels,
        });
        if (fallback) return fallback;

        const userResolved = await resolveProviderModelForTask({
            provider: requestedProvider,
            scopeType: requestedProvider === "chatgpt_subscription" ? "USER" : "LOCATION",
            scopeId: requestedProvider === "chatgpt_subscription" ? "global" : input.locationId,
            taskId: "property.image.generation",
            requestedModel,
        });
        if (userResolved) {
            return {
                model: userResolved.modelId,
                provider: userResolved.provider,
                warning: userResolved.fallbackReason,
            };
        }
    }

    const locationResolved = await resolveProviderModelForTask({
        provider: "google_gemini",
        scopeType: "LOCATION",
        scopeId: input.locationId,
        taskId: "property.image.generation",
        requestedModel,
    });
    if (locationResolved) {
        return {
            model: locationResolved.modelId,
            provider: locationResolved.provider,
            warning: locationResolved.fallbackReason,
        };
    }

    const globalResolved = await resolveProviderModelForTask({
        provider: "google_gemini",
        scopeType: "GLOBAL",
        scopeId: "global",
        taskId: "property.image.generation",
        requestedModel,
    });
    if (globalResolved) {
        return {
            model: globalResolved.modelId,
            provider: globalResolved.provider,
            warning: globalResolved.fallbackReason
                || (requestedModel ? `Requested model ${requestedModel} is unavailable or incompatible.` : undefined),
        };
    }

    const curatedResolved = await resolveProviderModelForTask({
        provider: "google_gemini",
        scopeType: "GLOBAL",
        scopeId: "global",
        taskId: "property.image.generation",
        requestedModel,
        fallbackModels: input.fallbackModels,
    });
    if (!curatedResolved) return null;

    return {
        model: curatedResolved.modelId,
        provider: curatedResolved.provider,
        warning: curatedResolved.fallbackReason,
    };
}
