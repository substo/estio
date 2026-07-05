import type { ModelOption } from "@/lib/ai/fetch-models";
import { resolveProviderModelForTask } from "@/lib/ai/provider-model-catalog";

export type PropertyImageGenerationModelResolution = {
    model: string;
    warning?: string;
};

export async function resolvePropertyImageGenerationModel(input: {
    locationId: string;
    requestedModel?: string | null;
    fallbackModels: ModelOption[];
}): Promise<PropertyImageGenerationModelResolution | null> {
    const requestedModel = String(input.requestedModel || "").trim();
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
        warning: curatedResolved.fallbackReason,
    };
}
