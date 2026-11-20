import { getLocationConfig } from "@/lib/location-config/service";
import db from "@/lib/db";
import { securelyRecordAiUsage } from "@/lib/ai/usage-metering";
import { callLLMWithMetadata, routeUsageMetadata } from "@/lib/ai/llm";

export interface PropertyTranslationInput {
    title: string;
    description: string;
    metaTitle?: string;
    metaDescription?: string;
}

export interface PropertyTranslationOutput {
    title: string;
    description: string;
    metaTitle: string;
    metaDescription: string;
}

function stripMarkdownCodeFences(value: string) {
    return value
        .replace(/^```(?:json)?/i, "")
        .replace(/```$/i, "")
        .trim();
}

export async function generatePropertyLanguageTranslation(params: {
    locationId: string;
    propertyId: string;
    targetLanguage: string;
    sourceData: PropertyTranslationInput;
    userId?: string | null;
}): Promise<PropertyTranslationOutput> {
    const siteConfig = await getLocationConfig(params.locationId).catch(() => null);
    const model = siteConfig?.googleAiModelTranslation || siteConfig?.googleAiModelDesign || siteConfig?.googleAiModel || null;

    const prompt = [
        `You are an expert luxury real estate multilingual translator.`,
        `Translate the following English property details accurately into language literal code: "${params.targetLanguage}".`,
        "Guidelines:",
        "1. Maintain a high-end, persuasive, and professional tone.",
        "2. Adapt real estate acronyms universally if no direct localization exists.",
        "3. Output ONLY strict JSON.",
        "Input Data to Translate:",
        `Title: ${params.sourceData.title || ""}`,
        `Description: ${params.sourceData.description || ""}`,
        `Meta Title: ${params.sourceData.metaTitle || ""}`,
        `Meta Description: ${params.sourceData.metaDescription || ""}`,
        "",
        "Required Output JSON Shape:",
        JSON.stringify({
            title: "string",
            description: "string",
            metaTitle: "string",
            metaDescription: "string"
        })
    ].join("\n");

    const result = await callLLMWithMetadata(model, prompt, undefined, {
        jsonMode: true,
        temperature: 0.3,
        operation: "crm_translation", locationId: params.locationId,
        executionMode: params.userId ? "interactive" : "background",
    });
    const text = stripMarkdownCodeFences(result.text);

    let parsed: any;
    try {
        parsed = JSON.parse(text);
    } catch {
        throw new Error("AI response did not contain valid translation JSON.");
    }

    void securelyRecordAiUsage({
        locationId: params.locationId,
        userId: params.userId || null,
        resourceType: "property",
        resourceId: params.propertyId,
        featureArea: "property_translation",
        action: "generate_language_translation",
        provider: result.provider,
        model: result.model,
        inputTokens: Number(result.usage.promptTokens) || 0,
        outputTokens: Number(result.usage.completionTokens) || 0,
        fundingScope: result.fundingScope,
        executionMode: result.executionMode,
        metadata: {
            targetLanguage: params.targetLanguage,
            ...routeUsageMetadata(result),
        },
    });

    return {
        title: String(parsed.title || ""),
        description: String(parsed.description || ""),
        metaTitle: String(parsed.metaTitle || ""),
        metaDescription: String(parsed.metaDescription || ""),
    };
}
