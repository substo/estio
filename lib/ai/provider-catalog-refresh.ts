import db from "@/lib/db";
import { revalidateTag } from "next/cache";
import { SETTINGS_DOMAINS, SETTINGS_SECRET_KEYS } from "@/lib/settings/constants";
import { AI_PROVIDER_CATALOG_CACHE_TAG } from "@/lib/ai/provider-cache";
import {
    getAvailableOpenAiTextModels,
    getAvailableOpenAiTextModelsForUser,
} from "@/lib/ai/openai-models";
import {
    fetchOpenAiOrganizationCostsSummary,
    OPENAI_ORGANIZATION_COSTS_REFERENCE_URL,
    resolveOpenAiCostsApiKey,
    type OpenAiOrganizationCostsSummary,
} from "@/lib/ai/openai-costs";

export type AiProviderCatalogRefreshStats = {
    openAiLocationsFound: number;
    openAiLocationsRefreshed: number;
    openAiUsersFound: number;
    openAiUsersRefreshed: number;
    openAiFailures: number;
    pricingRefresh: {
        refreshed: boolean;
        configured: boolean;
        source: "openai_organization_costs_api";
        reason: string;
        sourceUrl: string;
        costs?: OpenAiOrganizationCostsSummary;
    };
    failures: Array<{ scopeType: "LOCATION" | "USER" | "PROVIDER"; scopeId: string; error: string }>;
};

export async function runAiProviderCatalogRefresh(): Promise<AiProviderCatalogRefreshStats> {
    revalidateTag(AI_PROVIDER_CATALOG_CACHE_TAG);

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

    const stats: AiProviderCatalogRefreshStats = {
        openAiLocationsFound: openAiSecrets.length,
        openAiLocationsRefreshed: 0,
        openAiUsersFound: openAiUserSecrets.length,
        openAiUsersRefreshed: 0,
        openAiFailures: 0,
        pricingRefresh: {
            refreshed: false,
            configured: Boolean(resolveOpenAiCostsApiKey()),
            source: "openai_organization_costs_api",
            reason: "OpenAI model discovery does not include token price rates. Organization cost refresh uses OpenAI's official costs API when OPENAI_ADMIN_API_KEY or OPENAI_API_KEY has access.",
            sourceUrl: OPENAI_ORGANIZATION_COSTS_REFERENCE_URL,
        },
        failures: [],
    };

    for (const secret of openAiSecrets) {
        try {
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

    if (stats.pricingRefresh.configured) {
        try {
            const costs = await fetchOpenAiOrganizationCostsSummary({ days: 1 });
            stats.pricingRefresh = {
                ...stats.pricingRefresh,
                refreshed: true,
                reason: "Fetched official OpenAI organization cost telemetry for the last day. This is historical cost data, not a per-model token-rate table.",
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
