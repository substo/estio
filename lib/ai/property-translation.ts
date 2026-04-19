import { GoogleGenerativeAI } from "@google/generative-ai";
import db from "@/lib/db";
import { resolveLocationGoogleAiApiKey } from "@/lib/ai/location-google-key";
import { settingsService } from "@/lib/settings/service";
import { SETTINGS_DOMAINS } from "@/lib/settings/constants";
import { resolveAiModelDefault } from "@/lib/ai/fetch-models";
import { securelyRecordAiUsage } from "@/lib/ai/usage-metering";

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
    const apiKey = await resolveLocationGoogleAiApiKey(params.locationId);
    if (!apiKey) {
        throw new Error("Google AI API key is not configured for this location.");
    }

    const aiDoc = await settingsService.getDocument<any>({
        scopeType: "LOCATION",
        scopeId: params.locationId,
        domain: SETTINGS_DOMAINS.LOCATION_AI,
    }).catch(() => null);

    const siteConfig = await db.siteConfig.findUnique({
        where: { locationId: params.locationId },
        select: { googleAiModelDesign: true, googleAiModel: true },
    }).catch(() => null);

    const model = String(
        aiDoc?.payload?.googleAiModelDesign
        || aiDoc?.payload?.googleAiModel
        || siteConfig?.googleAiModelDesign
        || siteConfig?.googleAiModel
        || await resolveAiModelDefault(params.locationId, "design")
    ).trim();

    const genAI = new GoogleGenerativeAI(apiKey);
    const modelClient = genAI.getGenerativeModel({
        model,
        generationConfig: {
            responseMimeType: "application/json",
            temperature: 0.3,
        },
    });

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

    const result = await modelClient.generateContent([prompt]);
    const text = stripMarkdownCodeFences(result.response.text());

    let parsed: any;
    try {
        parsed = JSON.parse(text);
    } catch {
        throw new Error("AI response did not contain valid translation JSON.");
    }

    const usageMeta = (result.response.usageMetadata || {}) as Record<string, unknown>;
    void securelyRecordAiUsage({
        locationId: params.locationId,
        userId: params.userId || null,
        resourceType: "property",
        resourceId: params.propertyId,
        featureArea: "property_translation",
        action: "generate_language_translation",
        provider: "google_gemini",
        model,
        inputTokens: Number(usageMeta.promptTokenCount) || 0,
        outputTokens: Number(usageMeta.candidatesTokenCount) || 0,
        metadata: {
            targetLanguage: params.targetLanguage,
        },
    });

    return {
        title: String(parsed.title || ""),
        description: String(parsed.description || ""),
        metaTitle: String(parsed.metaTitle || ""),
        metaDescription: String(parsed.metaDescription || ""),
    };
}
