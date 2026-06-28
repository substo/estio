"use server";

import { revalidatePath } from "next/cache";
import db from "@/lib/db";
import { resolveIntegrationAdminContext } from "@/app/(main)/admin/settings/integrations/admin-context";
import { settingsService } from "@/lib/settings/service";
import { SETTINGS_DOMAINS, SETTINGS_SECRET_KEYS } from "@/lib/settings/constants";
import {
    resolveChatGptSubscriptionDefaultModel,
    validateChatGptSubscriptionConnection,
} from "@/lib/ai/chatgpt-subscription";

const OPENAI_INTEGRATION_PATH = "/admin/settings/integrations/openai";
const AI_SETTINGS_PATH = "/admin/settings/ai";

export type OpenAiIntegrationActionState = {
    success?: boolean;
    message?: string;
    error?: string;
};

function normalizeOptionalModel(value: FormDataEntryValue | null): string | null {
    const normalized = String(value || "").trim();
    return normalized || null;
}

async function resolveLocalUserId(clerkUserId: string): Promise<string> {
    const user = await db.user.findUnique({
        where: { clerkId: clerkUserId },
        select: { id: true },
    });
    if (!user?.id) throw new Error("User not found.");
    return user.id;
}

function revalidateOpenAiSettings() {
    revalidatePath(OPENAI_INTEGRATION_PATH);
    revalidatePath(AI_SETTINGS_PATH);
    revalidatePath("/admin/user-profile");
}

export async function saveOpenAiIntegrationSettings(
    _previousState: OpenAiIntegrationActionState,
    formData: FormData
): Promise<OpenAiIntegrationActionState> {
    try {
        const { userId: clerkUserId, locationId } = await resolveIntegrationAdminContext();
        const userId = await resolveLocalUserId(clerkUserId);

        const personalOpenAiEnabled = formData.get("personalOpenAiEnabled") === "on";
        const personalOpenAiApiKey = String(formData.get("personalOpenAiApiKey") || "").trim();
        const clearPersonalOpenAiApiKey = formData.get("clearPersonalOpenAiApiKey") === "on";
        const personalOpenAiDefaultTextModel = normalizeOptionalModel(formData.get("personalOpenAiDefaultTextModel"));

        const chatGptSubscriptionEnabled = formData.get("chatGptSubscriptionEnabled") === "on";
        const chatGptSubscriptionAccessToken = String(formData.get("chatGptSubscriptionAccessToken") || "").trim();
        const clearChatGptSubscriptionAccessToken = formData.get("clearChatGptSubscriptionAccessToken") === "on";
        const chatGptSubscriptionDefaultTextModel = normalizeOptionalModel(formData.get("chatGptSubscriptionDefaultTextModel"));

        const locationOpenAiApiKey = String(formData.get("locationOpenAiApiKey") || "").trim();
        const clearLocationOpenAiApiKey = formData.get("clearLocationOpenAiApiKey") === "on";
        const locationOpenAiTextModel = normalizeOptionalModel(formData.get("locationOpenAiTextModel"));

        await settingsService.upsertDocument({
            scopeType: "USER",
            scopeId: userId,
            domain: SETTINGS_DOMAINS.USER_OPENAI_INTEGRATIONS,
            payload: {
                enabled: personalOpenAiEnabled,
                defaultTextModel: personalOpenAiDefaultTextModel,
            },
            actorUserId: userId,
            schemaVersion: 1,
        });

        if (clearPersonalOpenAiApiKey) {
            await settingsService.clearSecret({
                scopeType: "USER",
                scopeId: userId,
                domain: SETTINGS_DOMAINS.USER_OPENAI_INTEGRATIONS,
                secretKey: SETTINGS_SECRET_KEYS.OPENAI_API_KEY,
                actorUserId: userId,
            });
        } else if (personalOpenAiApiKey) {
            await settingsService.setSecret({
                scopeType: "USER",
                scopeId: userId,
                domain: SETTINGS_DOMAINS.USER_OPENAI_INTEGRATIONS,
                secretKey: SETTINGS_SECRET_KEYS.OPENAI_API_KEY,
                plaintext: personalOpenAiApiKey,
                actorUserId: userId,
            });
        }

        await settingsService.upsertDocument({
            scopeType: "USER",
            scopeId: userId,
            domain: SETTINGS_DOMAINS.USER_CHATGPT_SUBSCRIPTION_INTEGRATIONS,
            payload: {
                enabled: chatGptSubscriptionEnabled,
                defaultTextModel: chatGptSubscriptionDefaultTextModel,
            },
            actorUserId: userId,
            schemaVersion: 1,
        });

        if (clearChatGptSubscriptionAccessToken) {
            await settingsService.clearSecret({
                scopeType: "USER",
                scopeId: userId,
                domain: SETTINGS_DOMAINS.USER_CHATGPT_SUBSCRIPTION_INTEGRATIONS,
                secretKey: SETTINGS_SECRET_KEYS.CHATGPT_CODEX_ACCESS_TOKEN,
                actorUserId: userId,
            });
        } else if (chatGptSubscriptionAccessToken) {
            await settingsService.setSecret({
                scopeType: "USER",
                scopeId: userId,
                domain: SETTINGS_DOMAINS.USER_CHATGPT_SUBSCRIPTION_INTEGRATIONS,
                secretKey: SETTINGS_SECRET_KEYS.CHATGPT_CODEX_ACCESS_TOKEN,
                plaintext: chatGptSubscriptionAccessToken,
                actorUserId: userId,
            });
        }

        const currentLocationAiDoc = await settingsService.getDocument<any>({
            scopeType: "LOCATION",
            scopeId: locationId,
            domain: SETTINGS_DOMAINS.LOCATION_AI,
        }).catch(() => null);
        const currentLocationAiPayload = currentLocationAiDoc?.payload && typeof currentLocationAiDoc.payload === "object"
            ? currentLocationAiDoc.payload
            : {};

        await settingsService.upsertDocument({
            scopeType: "LOCATION",
            scopeId: locationId,
            domain: SETTINGS_DOMAINS.LOCATION_AI,
            payload: {
                ...currentLocationAiPayload,
                openAiTextModel: locationOpenAiTextModel,
            },
            actorUserId: userId,
            schemaVersion: 1,
        });

        if (clearLocationOpenAiApiKey) {
            await settingsService.clearSecret({
                scopeType: "LOCATION",
                scopeId: locationId,
                domain: SETTINGS_DOMAINS.LOCATION_AI,
                secretKey: SETTINGS_SECRET_KEYS.OPENAI_API_KEY,
                actorUserId: userId,
            });
        } else if (locationOpenAiApiKey) {
            await settingsService.setSecret({
                scopeType: "LOCATION",
                scopeId: locationId,
                domain: SETTINGS_DOMAINS.LOCATION_AI,
                secretKey: SETTINGS_SECRET_KEYS.OPENAI_API_KEY,
                plaintext: locationOpenAiApiKey,
                actorUserId: userId,
            });
        }

        revalidateOpenAiSettings();
        return { success: true, message: "OpenAI integration settings saved." };
    } catch (error: any) {
        console.error("[OpenAI Integration] Save failed:", error);
        return { success: false, error: error?.message || "Could not save OpenAI integration settings." };
    }
}

export async function connectChatGptSubscriptionFromIntegration(modelId?: string | null): Promise<OpenAiIntegrationActionState> {
    try {
        const { userId: clerkUserId } = await resolveIntegrationAdminContext();
        const userId = await resolveLocalUserId(clerkUserId);
        const defaultTextModel = resolveChatGptSubscriptionDefaultModel(modelId);

        const status = await validateChatGptSubscriptionConnection({ modelId: defaultTextModel });
        if (!status.ok) {
            return { success: false, error: status.message };
        }

        await settingsService.upsertDocument({
            scopeType: "USER",
            scopeId: userId,
            domain: SETTINGS_DOMAINS.USER_CHATGPT_SUBSCRIPTION_INTEGRATIONS,
            payload: {
                enabled: true,
                defaultTextModel,
            },
            actorUserId: userId,
            schemaVersion: 1,
        });

        revalidateOpenAiSettings();
        return {
            success: true,
            message: "ChatGPT subscription connected and enabled.",
        };
    } catch (error: any) {
        console.error("[OpenAI Integration] Subscription connect failed:", error);
        return { success: false, error: error?.message || "ChatGPT subscription connection failed." };
    }
}

export async function disconnectChatGptSubscriptionFromIntegration(modelId?: string | null): Promise<OpenAiIntegrationActionState> {
    try {
        const { userId: clerkUserId } = await resolveIntegrationAdminContext();
        const userId = await resolveLocalUserId(clerkUserId);
        const defaultTextModel = resolveChatGptSubscriptionDefaultModel(modelId);

        await settingsService.upsertDocument({
            scopeType: "USER",
            scopeId: userId,
            domain: SETTINGS_DOMAINS.USER_CHATGPT_SUBSCRIPTION_INTEGRATIONS,
            payload: {
                enabled: false,
                defaultTextModel,
            },
            actorUserId: userId,
            schemaVersion: 1,
        });

        revalidateOpenAiSettings();
        return {
            success: true,
            message: "ChatGPT subscription disconnected.",
        };
    } catch (error: any) {
        console.error("[OpenAI Integration] Subscription disconnect failed:", error);
        return { success: false, error: error?.message || "ChatGPT subscription disconnect failed." };
    }
}
