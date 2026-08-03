"use server";

import { revalidatePath } from "next/cache";
import db from "@/lib/db";
import { resolveIntegrationAdminContext } from "./admin-context";
import { SETTINGS_DOMAINS, SETTINGS_SECRET_KEYS } from "@/lib/settings/constants";
import { settingsService } from "@/lib/settings/service";
import { resolveLocationGoogleAiApiKey } from "@/lib/ai/location-google-key";
import { resolveOpenAiApiKey } from "@/lib/ai/openai-models";

export type AiProviderActionState = { success?: boolean; message?: string; error?: string };
type ProviderOperation = "save" | "test" | "remove";

async function localUserId(clerkId: string) {
    const user = await db.user.findUnique({ where: { clerkId }, select: { id: true } });
    if (!user?.id) throw new Error("User not found.");
    return user.id;
}

async function testKey(provider: "gemini" | "openai", key: string): Promise<boolean> {
    const response = provider === "gemini"
        ? await fetch("https://generativelanguage.googleapis.com/v1beta/models", { headers: { "x-goog-api-key": key }, cache: "no-store" })
        : await fetch("https://api.openai.com/v1/models", { headers: { Authorization: `Bearer ${key}` }, cache: "no-store" });
    return response.ok;
}

async function recordProviderStatus(input: {
    locationId: string;
    actorUserId: string;
    provider: "gemini" | "openai";
    operation: ProviderOperation;
    health: "connected" | "needs_attention" | "disconnected";
}) {
    const existing = await settingsService.getDocument<any>({
        scopeType: "LOCATION",
        scopeId: input.locationId,
        domain: SETTINGS_DOMAINS.LOCATION_INTEGRATIONS,
    }).catch(() => null);
    const previousConnections = existing?.payload?.providerConnections || {};
    await settingsService.upsertDocument({
        scopeType: "LOCATION",
        scopeId: input.locationId,
        domain: SETTINGS_DOMAINS.LOCATION_INTEGRATIONS,
        payload: {
            ...(existing?.payload || {}),
            providerConnections: {
                ...previousConnections,
                [input.provider]: {
                    ...(previousConnections[input.provider] || {}),
                    health: input.health,
                    lastOperation: input.operation,
                    lastCheckedAt: new Date().toISOString(),
                },
            },
        },
        actorUserId: input.actorUserId,
        schemaVersion: 1,
    });
}

async function mutateProvider(provider: "gemini" | "openai", formData: FormData): Promise<AiProviderActionState> {
    try {
        const { userId: clerkId, locationId } = await resolveIntegrationAdminContext();
        const actorUserId = await localUserId(clerkId);
        const operationValue = String(formData.get("operation") || "save");
        if (!["save", "test", "remove"].includes(operationValue)) {
            return { error: "Unsupported connection operation." };
        }
        const operation = operationValue as ProviderOperation;
        const secretKey = provider === "gemini" ? SETTINGS_SECRET_KEYS.GOOGLE_AI_API_KEY : SETTINGS_SECRET_KEYS.OPENAI_API_KEY;
        const inputKey = String(formData.get("apiKey") || "").trim();

        if (inputKey.length > 8_192) {
            return { error: "The API key is too long." };
        }

        if (operation === "remove") {
            await settingsService.clearSecret({ scopeType: "LOCATION", scopeId: locationId, domain: SETTINGS_DOMAINS.LOCATION_AI, secretKey, actorUserId });
            if (provider === "gemini") await db.siteConfig.updateMany({ where: { locationId }, data: { googleAiApiKey: null } });
            await recordProviderStatus({ locationId, actorUserId, provider, operation, health: "disconnected" });
            revalidatePath(`/admin/settings/integrations/${provider === "gemini" ? "gemini" : "openai-api"}`);
            revalidatePath("/admin/settings/ai");
            return { success: true, message: "Connection removed." };
        }

        const key = operation === "test"
            ? provider === "gemini"
                ? await resolveLocationGoogleAiApiKey(locationId)
                : await resolveOpenAiApiKey(locationId)
            : inputKey;
        if (!key) return { error: operation === "test" ? "No saved connection to test." : "Enter an API key." };
        if (!await testKey(provider, key)) {
            await recordProviderStatus({ locationId, actorUserId, provider, operation, health: "needs_attention" });
            return { error: "The provider did not accept this connection. Check the key and try again." };
        }

        if (operation !== "test") {
            await settingsService.setSecret({ scopeType: "LOCATION", scopeId: locationId, domain: SETTINGS_DOMAINS.LOCATION_AI, secretKey, plaintext: key, actorUserId });
        }
        await recordProviderStatus({ locationId, actorUserId, provider, operation, health: "connected" });
        revalidatePath(`/admin/settings/integrations/${provider === "gemini" ? "gemini" : "openai-api"}`);
        revalidatePath("/admin/settings/ai");
        return { success: true, message: operation === "test" ? "Connection test succeeded." : "Connection saved and tested." };
    } catch {
        return { error: "The connection could not be updated. Try again." };
    }
}

export async function saveGeminiIntegration(_state: AiProviderActionState, formData: FormData) {
    return mutateProvider("gemini", formData);
}

export async function saveOpenAiApiIntegration(_state: AiProviderActionState, formData: FormData) {
    return mutateProvider("openai", formData);
}
