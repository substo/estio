import db from "@/lib/db";
import { revalidateTag } from "next/cache";
import { settingsService } from "@/lib/settings/service";
import { SETTINGS_DOMAINS, SETTINGS_SECRET_KEYS } from "@/lib/settings/constants";
import { AI_PROVIDER_CATALOG_CACHE_TAG } from "@/lib/ai/provider-cache";
import {
    fetchOpenAiModels,
    getAvailableOpenAiTextModels,
    getAvailableOpenAiTextModelsForUser,
    normalizeOpenAiModelValue,
} from "@/lib/ai/openai-models";
import { fetchGoogleModels, normalizeGoogleModelId } from "@/lib/ai/fetch-models";
import { resolveLocationGoogleAiApiKey } from "@/lib/ai/location-google-key";
import {
    classifyProviderModelCapabilities,
    refreshProviderModelCatalog,
    type AiProviderModelScopeType,
    type DiscoveredProviderModel,
    type ProviderCatalogRefreshResult,
} from "@/lib/ai/provider-model-catalog";
import {
    fetchOpenAiOrganizationCostsSummary,
    OPENAI_ORGANIZATION_COSTS_REFERENCE_URL,
    resolveOpenAiCostsApiKey,
    type OpenAiOrganizationCostsSummary,
} from "@/lib/ai/openai-costs";
import {
    fetchGoogleGeminiPricingCatalog,
    GOOGLE_GEMINI_PRICING_URL,
    type GoogleGeminiModelPricing,
} from "@/lib/ai/google-pricing";

export type AiProviderCatalogRefreshStats = {
    googleLocationsFound: number;
    googleLocationsRefreshed: number;
    googleGlobalRefreshed: boolean;
    googleFailures: number;
    openAiLocationsFound: number;
    openAiLocationsRefreshed: number;
    openAiUsersFound: number;
    openAiUsersRefreshed: number;
    openAiGlobalRefreshed: boolean;
    openAiFailures: number;
    providerCatalogRefreshes: ProviderCatalogRefreshResult[];
    pricingRefresh: {
        refreshed: boolean;
        configured: boolean;
        source: "provider_catalog";
        reason: string;
        sourceUrl: string;
        googleModels?: number;
        costs?: OpenAiOrganizationCostsSummary;
    };
    failures: Array<{ scopeType: AiProviderModelScopeType | "PROVIDER"; scopeId: string; error: string }>;
};

function normalizeGooglePricingLookupKey(modelId: string): string {
    return String(modelId || "")
        .trim()
        .toLowerCase()
        .replace(/^models\//, "")
        .replace(/-image-preview$/, "-image")
        .replace(/-preview$/, "");
}

function buildGooglePricingMap(pricing: GoogleGeminiModelPricing[]): Map<string, GoogleGeminiModelPricing> {
    const map = new Map<string, GoogleGeminiModelPricing>();
    for (const price of pricing) {
        const key = normalizeGooglePricingLookupKey(price.modelId);
        if (key && !map.has(key)) map.set(key, price);
    }
    return map;
}

function toGoogleDiscoveredModels(input: {
    scopeType: AiProviderModelScopeType;
    scopeId: string;
    models: NonNullable<Awaited<ReturnType<typeof fetchGoogleModels>>>;
    pricingByModel?: Map<string, GoogleGeminiModelPricing>;
}): DiscoveredProviderModel[] {
    const discovered: DiscoveredProviderModel[] = [];
    for (const model of input.models) {
        const modelId = normalizeGoogleModelId(model);
        if (!modelId || !modelId.toLowerCase().includes("gemini")) continue;
        const label = String(model.displayName || "").trim() || modelId;
        const description = String(model.description || "").trim();
        const capabilities = classifyProviderModelCapabilities({
            provider: "google_gemini",
            modelId,
            label,
            description,
        });
        if (!capabilities.length) continue;

        discovered.push({
            provider: "google_gemini",
            scopeType: input.scopeType,
            scopeId: input.scopeId,
            modelId,
            displayName: label,
            description: description || null,
            capabilities,
            source: "google_models_list",
            rawMetadata: model,
            pricing: input.pricingByModel?.get(normalizeGooglePricingLookupKey(modelId)) || null,
        });
    }
    return discovered;
}

function toOpenAiDiscoveredModels(input: {
    scopeType: AiProviderModelScopeType;
    scopeId: string;
    models: NonNullable<Awaited<ReturnType<typeof fetchOpenAiModels>>>;
}): DiscoveredProviderModel[] {
    const discovered: DiscoveredProviderModel[] = [];
    for (const model of input.models) {
        const rawId = String(model.id || "").trim();
        if (!rawId) continue;
        const modelId = normalizeOpenAiModelValue(rawId);
        const capabilities = classifyProviderModelCapabilities({
            provider: "openai_api",
            modelId,
            label: modelId,
        });
        if (!capabilities.length) continue;

        discovered.push({
            provider: "openai_api",
            scopeType: input.scopeType,
            scopeId: input.scopeId,
            modelId,
            displayName: modelId.replace(/^openai:/, "OpenAI "),
            description: model.owned_by ? `Owned by ${model.owned_by}` : null,
            capabilities,
            source: "openai_models_list",
            rawMetadata: model,
        });
    }
    return discovered;
}

export async function runAiProviderCatalogRefresh(): Promise<AiProviderCatalogRefreshStats> {
    revalidateTag(AI_PROVIDER_CATALOG_CACHE_TAG);

    const googleSecretScopes = await db.settingsSecret.findMany({
        where: {
            scopeType: "LOCATION",
            domain: SETTINGS_DOMAINS.LOCATION_AI,
            secretKey: SETTINGS_SECRET_KEYS.GOOGLE_AI_API_KEY,
        },
        select: { scopeId: true },
        distinct: ["scopeId"],
    });
    const googleSiteConfigScopes = await db.siteConfig.findMany({
        where: {
            googleAiApiKey: { not: null },
        },
        select: { locationId: true },
    });
    const openAiSecrets = await db.settingsSecret.findMany({
        where: {
            scopeType: "LOCATION",
            domain: SETTINGS_DOMAINS.LOCATION_AI,
            secretKey: SETTINGS_SECRET_KEYS.OPENAI_API_KEY,
        },
        select: { scopeId: true },
        distinct: ["scopeId"],
    });
    const openAiUserSecrets = await db.settingsSecret.findMany({
        where: {
            scopeType: "USER",
            domain: SETTINGS_DOMAINS.USER_OPENAI_INTEGRATIONS,
            secretKey: SETTINGS_SECRET_KEYS.OPENAI_API_KEY,
        },
        select: { scopeId: true },
        distinct: ["scopeId"],
    });

    const googleLocationIds = Array.from(new Set([
        ...googleSecretScopes.map((secret) => secret.scopeId),
        ...googleSiteConfigScopes.map((config) => config.locationId),
    ].filter(Boolean)));

    const stats: AiProviderCatalogRefreshStats = {
        googleLocationsFound: googleLocationIds.length,
        googleLocationsRefreshed: 0,
        googleGlobalRefreshed: false,
        googleFailures: 0,
        openAiLocationsFound: openAiSecrets.length,
        openAiLocationsRefreshed: 0,
        openAiUsersFound: openAiUserSecrets.length,
        openAiUsersRefreshed: 0,
        openAiGlobalRefreshed: false,
        openAiFailures: 0,
        providerCatalogRefreshes: [],
        pricingRefresh: {
            refreshed: false,
            configured: true,
            source: "provider_catalog",
            reason: "Google pricing is refreshed from Google's official Gemini API pricing page. OpenAI model discovery does not include token price rates; OpenAI organization costs still use the official costs API when configured.",
            sourceUrl: GOOGLE_GEMINI_PRICING_URL,
        },
        failures: [],
    };

    let googlePricingByModel = new Map<string, GoogleGeminiModelPricing>();
    try {
        const googlePricing = await fetchGoogleGeminiPricingCatalog();
        googlePricingByModel = buildGooglePricingMap(googlePricing);
        stats.pricingRefresh.refreshed = true;
        stats.pricingRefresh.googleModels = googlePricingByModel.size;
    } catch (error: any) {
        stats.failures.push({
            scopeType: "PROVIDER",
            scopeId: "google_gemini_pricing",
            error: error?.message || "Unknown Google pricing refresh failure",
        });
    }

    async function refreshGoogleScope(scopeType: AiProviderModelScopeType, scopeId: string, apiKey: string) {
        const models = await fetchGoogleModels(apiKey);
        if (!models) {
            throw new Error("Google model discovery returned no models.");
        }
        const result = await refreshProviderModelCatalog({
            provider: "google_gemini",
            scopeType,
            scopeId,
            models: toGoogleDiscoveredModels({ scopeType, scopeId, models, pricingByModel: googlePricingByModel }),
        });
        stats.providerCatalogRefreshes.push(result);
    }

    const globalGoogleKey = String(process.env.GOOGLE_API_KEY || "").trim();
    if (globalGoogleKey) {
        try {
            await refreshGoogleScope("GLOBAL", "global", globalGoogleKey);
            stats.googleGlobalRefreshed = true;
        } catch (error: any) {
            stats.googleFailures += 1;
            stats.failures.push({
                scopeType: "GLOBAL",
                scopeId: "global",
                error: error?.message || "Unknown Google global model refresh failure",
            });
        }
    }

    for (const locationId of googleLocationIds) {
        try {
            const apiKey = await resolveLocationGoogleAiApiKey(locationId);
            if (!apiKey) continue;
            await refreshGoogleScope("LOCATION", locationId, apiKey);
            stats.googleLocationsRefreshed += 1;
        } catch (error: any) {
            stats.googleFailures += 1;
            stats.failures.push({
                scopeType: "LOCATION",
                scopeId: locationId,
                error: error?.message || "Unknown Google model refresh failure",
            });
        }
    }

    async function refreshOpenAiScope(scopeType: AiProviderModelScopeType, scopeId: string, apiKey: string) {
        const models = await fetchOpenAiModels(apiKey);
        if (!models) {
            throw new Error("OpenAI model discovery returned no models.");
        }
        const result = await refreshProviderModelCatalog({
            provider: "openai_api",
            scopeType,
            scopeId,
            models: toOpenAiDiscoveredModels({ scopeType, scopeId, models }),
        });
        stats.providerCatalogRefreshes.push(result);
    }

    const globalOpenAiKey = String(process.env.OPENAI_API_KEY || "").trim();
    if (globalOpenAiKey) {
        try {
            await refreshOpenAiScope("GLOBAL", "global", globalOpenAiKey);
            stats.openAiGlobalRefreshed = true;
        } catch (error: any) {
            stats.openAiFailures += 1;
            stats.failures.push({
                scopeType: "GLOBAL",
                scopeId: "global",
                error: error?.message || "Unknown OpenAI global model refresh failure",
            });
        }
    }

    for (const secret of openAiSecrets) {
        try {
            const apiKey = await settingsService.getSecret({
                scopeType: "LOCATION",
                scopeId: secret.scopeId,
                domain: SETTINGS_DOMAINS.LOCATION_AI,
                secretKey: SETTINGS_SECRET_KEYS.OPENAI_API_KEY,
            });
            if (apiKey) {
                await refreshOpenAiScope("LOCATION", secret.scopeId, apiKey);
            }
            await getAvailableOpenAiTextModels(secret.scopeId);
            stats.openAiLocationsRefreshed += 1;
        } catch (error: any) {
            stats.openAiFailures += 1;
            stats.failures.push({
                scopeType: "LOCATION",
                scopeId: secret.scopeId,
                error: error?.message || "Unknown OpenAI model refresh failure",
            });
        }
    }

    for (const secret of openAiUserSecrets) {
        try {
            const doc = await settingsService.getDocument<any>({
                scopeType: "USER",
                scopeId: secret.scopeId,
                domain: SETTINGS_DOMAINS.USER_OPENAI_INTEGRATIONS,
            }).catch(() => null);
            const apiKey = doc?.payload?.enabled === true
                ? await settingsService.getSecret({
                    scopeType: "USER",
                    scopeId: secret.scopeId,
                    domain: SETTINGS_DOMAINS.USER_OPENAI_INTEGRATIONS,
                    secretKey: SETTINGS_SECRET_KEYS.OPENAI_API_KEY,
                })
                : null;
            if (apiKey) {
                await refreshOpenAiScope("USER", secret.scopeId, apiKey);
            }
            await getAvailableOpenAiTextModelsForUser(secret.scopeId);
            stats.openAiUsersRefreshed += 1;
        } catch (error: any) {
            stats.openAiFailures += 1;
            stats.failures.push({
                scopeType: "USER",
                scopeId: secret.scopeId,
                error: error?.message || "Unknown OpenAI user model refresh failure",
            });
        }
    }

    if (resolveOpenAiCostsApiKey()) {
        try {
            const costs = await fetchOpenAiOrganizationCostsSummary({ days: 1 });
            stats.pricingRefresh = {
                ...stats.pricingRefresh,
                refreshed: true,
                sourceUrl: `${GOOGLE_GEMINI_PRICING_URL} | ${OPENAI_ORGANIZATION_COSTS_REFERENCE_URL}`,
                reason: "Google pricing was fetched from the official Gemini API pricing page. OpenAI organization cost telemetry was fetched for reconciliation; it is historical cost data, not a per-model token-rate table.",
                costs,
            };
        } catch (error: any) {
            stats.failures.push({
                scopeType: "PROVIDER",
                scopeId: "openai_organization_costs",
                error: error?.message || "Unknown OpenAI organization costs refresh failure",
            });
        }
    }

    return stats;
}
