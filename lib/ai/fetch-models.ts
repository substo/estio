
import { GoogleGenerativeAI } from "@google/generative-ai";
import db from "@/lib/db";
import { GOOGLE_AI_MODELS as FALLBACK_MODELS } from "./models";
import { unstable_cache } from "next/cache";

export interface ModelOption {
    value: string;
    label: string;
    description?: string;
}

// Cache the fetch for 1 hour to avoid continuous API calls
export const getAvailableModels = unstable_cache(
    async (locationId?: string): Promise<ModelOption[]> => {
        try {
            // 1. Resolve API Key
            let apiKey = process.env.GOOGLE_API_KEY;

            // If location provided, try to find custom key
            if (locationId) {
                const siteConfig = await db.siteConfig.findUnique({
                    where: { locationId },
                    select: { googleAiApiKey: true }
                });
                if (siteConfig?.googleAiApiKey) {
                    apiKey = siteConfig.googleAiApiKey;
                }
            }

            if (!apiKey) {
                console.warn("[Model Fetch] No API Key found. Returning fallback list.");
                return FALLBACK_MODELS;
            }

            // 2. Fetch from Google API Response
            // Using direct fetch as SDK doesn't always expose listModels simply
            const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`;
            const response = await fetch(url);

            if (!response.ok) {
                console.error(`[Model Fetch] Failed: ${response.status} ${response.statusText}`);
                return FALLBACK_MODELS;
            }

            const data = await response.json();

            if (!data.models || !Array.isArray(data.models)) {
                return FALLBACK_MODELS;
            }

            // 3. Transform & Filter
            // We want models that support 'generateContent'
            const validModels = data.models.filter((m: any) =>
                m.supportedGenerationMethods?.includes("generateContent") &&
                m.name.includes("gemini") // Filter strictly for Gemini models
            );

            // 4. Map to UI Options
            const options: ModelOption[] = validModels.map((m: any) => {
                const id = m.name.replace("models/", "");
                return {
                    value: id,
                    label: m.displayName || id, // e.g. "Gemini 1.5 Pro"
                    description: m.description
                };
            });

            // 5. Sort: 
            // - Prefer "Pro" and "Flash"
            // - Prefer newer versions (string sort desc usually works for 1.5 vs 1.0, but 2.0 vs 1.5)
            // - We can use a simple priority score
            const sorted = options.sort((a, b) => {
                // Custom priority logic could go here
                // For now, reverse alphabetical roughly gives newer versions first (Gemini 2 vs 1.5)
                // But Gemini 3 vs 2.5... '3' > '2'
                return b.label.localeCompare(a.label, undefined, { numeric: true });
            });

            return sorted;

        } catch (error) {
            console.error("[Model Fetch] Error:", error);
            return FALLBACK_MODELS;
        }
    },
    ['available-ai-models'], // Cache Key
    { revalidate: 3600 } // 1 Hour TTL
);
