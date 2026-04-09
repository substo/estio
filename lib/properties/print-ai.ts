import { GoogleGenerativeAI } from "@google/generative-ai";
import db from "@/lib/db";
import { resolveLocationGoogleAiApiKey } from "@/lib/ai/location-google-key";
import { settingsService } from "@/lib/settings/service";
import { SETTINGS_DOMAINS } from "@/lib/settings/constants";
import { resolveAiModelDefault } from "@/lib/ai/fetch-models";
import { securelyRecordAiUsage } from "@/lib/ai/usage-metering";
import {
    normalizePropertyPrintGeneratedContent,
    normalizePropertyPrintLanguages,
    type PropertyPrintGeneratedContent,
} from "@/lib/properties/print-designer";
import { buildPropertyFeatureBullets } from "@/lib/properties/print-designer";

function stripMarkdownCodeFences(value: string) {
    return value
        .replace(/^```(?:json)?/i, "")
        .replace(/```$/i, "")
        .trim();
}

function parseGeneratedContent(value: string): PropertyPrintGeneratedContent {
    const raw = stripMarkdownCodeFences(value);
    try {
        return normalizePropertyPrintGeneratedContent(JSON.parse(raw));
    } catch {
        const start = raw.indexOf("{");
        const end = raw.lastIndexOf("}");
        if (start >= 0 && end > start) {
            return normalizePropertyPrintGeneratedContent(JSON.parse(raw.slice(start, end + 1)));
        }
        throw new Error("AI response did not contain valid brochure JSON.");
    }
}

export async function generatePropertyPrintCopy(params: {
    propertyId: string;
    draftId: string;
    locationId: string;
    userId?: string | null;
    modelOverride?: string | null;
}) {
    const property = await db.property.findFirst({
        where: { id: params.propertyId, locationId: params.locationId },
        include: { media: true },
    });

    const draft = await db.propertyPrintDraft.findFirst({
        where: { id: params.draftId, propertyId: params.propertyId },
    });

    if (!property || !draft) {
        throw new Error("Property print draft not found.");
    }

    const apiKey = await resolveLocationGoogleAiApiKey(params.locationId);
    if (!apiKey) {
        throw new Error("Google AI API key is not configured for this location.");
    }

    const explicitOverride = String(params.modelOverride || "").trim();

    const aiDoc = await settingsService.getDocument<any>({
        scopeType: "LOCATION",
        scopeId: params.locationId,
        domain: SETTINGS_DOMAINS.LOCATION_AI,
    });
    const siteConfig = await db.siteConfig.findUnique({
        where: { locationId: params.locationId },
        select: { googleAiModel: true, googleAiModelDesign: true, brandVoice: true },
    });

    const model = explicitOverride || String(
        aiDoc?.payload?.googleAiModelDesign
        || aiDoc?.payload?.googleAiModel
        || siteConfig?.googleAiModelDesign
        || siteConfig?.googleAiModel
        || await resolveAiModelDefault(params.locationId, "design")
    ).trim();

    const brandVoice = String(
        aiDoc?.payload?.brandVoice
        || siteConfig?.brandVoice
        || "Professional, welcoming, premium real estate brochure copy."
    ).trim();

    const languages = normalizePropertyPrintLanguages(draft.languages);
    if (languages.length === 0) {
        throw new Error("Select at least one language before generating brochure copy.");
    }

    const promptSettings = (draft.promptSettings && typeof draft.promptSettings === "object")
        ? draft.promptSettings as Record<string, unknown>
        : {};

    const genAI = new GoogleGenerativeAI(apiKey);
    const modelClient = genAI.getGenerativeModel({
        model,
        generationConfig: {
            responseMimeType: "application/json",
            temperature: 0.5,
        },
    });

    const deterministicFeatures = buildPropertyFeatureBullets(property);
    const propertyFacts = {
        title: property.title,
        goal: property.goal,
        price: property.price,
        currency: property.currency,
        reference: property.reference,
        city: property.city,
        area: property.propertyArea,
        country: property.country,
        bedrooms: property.bedrooms,
        bathrooms: property.bathrooms,
        coveredAreaSqm: property.coveredAreaSqm || property.areaSqm,
        plotAreaSqm: property.plotAreaSqm,
        condition: property.condition,
        features: property.features || [],
        description: property.description || "",
        deterministicFeatureBullets: deterministicFeatures,
    };

    const prompt = [
        "You are creating polished real estate brochure copy for a property print sheet.",
        `Brand voice: ${brandVoice}`,
        `Languages to generate: ${languages.join(", ")}`,
        `Template: ${draft.templateId}`,
        `Tone override: ${String(promptSettings.toneInstructions || "").trim() || "none"}`,
        "Use the supplied property facts only. Do not invent hard facts or amenities not present in the data.",
        "Return strict JSON with this shape:",
        JSON.stringify({
            title: "string",
            subtitle: "string",
            featureBullets: ["string"],
            footerNote: "string",
            contactCta: "string",
            languages: [
                {
                    language: "en",
                    label: "English",
                    title: "string",
                    subtitle: "string",
                    body: "string",
                },
            ],
        }),
        "Rules:",
        "- Keep title/subtitle concise and brochure-friendly.",
        "- language entries must exactly match the requested languages.",
        "- featureBullets should be short, useful, and printable.",
        "- body should be 80-140 words per language for A4/A3 brochure use.",
        "- If English is not requested, do not add English.",
        "- Never include markdown.",
        `Property facts: ${JSON.stringify(propertyFacts)}`,
    ].join("\n");

    const result = await modelClient.generateContent([prompt]);
    const text = result.response.text();
    const usageMeta = (result.response.usageMetadata || {}) as Record<string, unknown>;
    const inputTokens = Number(usageMeta.promptTokenCount) || 0;
    const outputTokens = Number(usageMeta.candidatesTokenCount) || 0;
    const totalTokens = Number(usageMeta.totalTokenCount) || (inputTokens + outputTokens);

    const generatedContent = parseGeneratedContent(text);
    const generationMetadata = {
        provider: "google_gemini",
        model,
        generatedAt: new Date().toISOString(),
        inputTokens,
        outputTokens,
        totalTokens,
    };

    void securelyRecordAiUsage({
        locationId: params.locationId,
        userId: params.userId || null,
        resourceType: "property",
        resourceId: params.propertyId,
        featureArea: "property_printing",
        action: "generate_print_copy",
        provider: "google_gemini",
        model,
        inputTokens,
        outputTokens,
        metadata: {
            draftId: params.draftId,
            languages,
            templateId: draft.templateId,
        },
    });

    return {
        generatedContent,
        generationMetadata,
    };
}
