"use server";

import db from "@/lib/db";
import { auth } from "@clerk/nextjs/server";
import { revalidatePath } from "next/cache";
import axios from "axios";
import { getLocationContext } from "@/lib/auth/location-context";
import { verifyUserIsLocationAdmin } from "@/lib/auth/permissions";
import { settingsService } from "@/lib/settings/service";
import {
    SETTINGS_DOMAINS,
    SETTINGS_SECRET_KEYS,
    isSettingsDualWriteLegacyEnabled,
    isSettingsParityCheckEnabled,
} from "@/lib/settings/constants";
import { getLegacyCryptr } from "@/lib/security/legacy-cryptr";
import {
    createWhatsAppCloudTemplate,
    fetchWhatsAppCloudTemplates,
    getWhatsAppCloudCredentials,
    getWhatsAppCloudHealth as getCloudHealth,
    setDefaultWhatsAppCloudChannel,
    subscribeWhatsAppAppToWaba,
    upsertWhatsAppCloudChannel,
} from "@/lib/whatsapp/client";
import { callLLM } from "@/lib/ai/llm";
import { GEMINI_DRAFT_FAST_DEFAULT } from "@/lib/ai/models";
import {
    buildWhatsAppTemplateComponents,
    extractTemplateBodyText,
    normalizeTemplateName,
    renderTemplatePreview,
    validateWhatsAppTemplate,
} from "@/lib/whatsapp/templates";
import {
    clearWhatsAppWebBridgeSession,
    getWhatsAppWebBridgeBaseUrl,
    getWhatsAppWebBridgeHealth,
    getWhatsAppWebBridgeSession,
    restartWhatsAppWebBridgeSession,
    startWhatsAppWebBridgeSession,
    stopWhatsAppWebBridgeSession,
    upsertWhatsAppWebBridgeSession,
} from "@/lib/whatsapp/web-bridge";
import { buildWebBridgeDiagnostics } from "@/lib/whatsapp/web-bridge-diagnostics";
import {
    WHATSAPP_CALLING_PROVIDER,
    checkCallingReadiness,
} from "@/lib/whatsapp/calling";

const MASKED_SECRET = "********";

function serializeWhatsAppCallingConfig(config: any) {
    if (!config) {
        return {
            provider: WHATSAPP_CALLING_PROVIDER,
            status: "not_configured",
            phoneNumberId: "",
            wabaId: "",
            callingEnabled: false,
            webhooksEnabled: false,
            mediaMode: "sip",
            sipEndpoint: "",
            mediaNotes: "",
            lastReadinessStatus: null,
            lastReadinessCheckedAt: null,
            lastError: "",
            metadata: {},
        };
    }
    return {
        provider: config.provider || WHATSAPP_CALLING_PROVIDER,
        status: config.status || "not_configured",
        phoneNumberId: config.phoneNumberId || "",
        wabaId: config.wabaId || "",
        callingEnabled: Boolean(config.callingEnabled),
        webhooksEnabled: Boolean(config.webhooksEnabled),
        mediaMode: config.mediaMode || "sip",
        sipEndpoint: config.sipEndpoint || "",
        mediaNotes: config.mediaNotes || "",
        lastReadinessStatus: config.lastReadinessStatus || null,
        lastReadinessCheckedAt: config.lastReadinessCheckedAt?.toISOString?.() || null,
        lastError: config.lastError || "",
        metadata: config.metadata && typeof config.metadata === "object" ? config.metadata : {},
    };
}

function serializeWhatsAppChannel(channel: any) {
    return {
        id: channel.id,
        locationId: channel.locationId,
        wabaId: channel.wabaId,
        phoneNumberId: channel.phoneNumberId,
        displayPhoneNumber: channel.displayPhoneNumber || "",
        verifiedName: channel.verifiedName || "",
        providerMode: channel.providerMode || "cloud_primary",
        status: channel.status || "unknown",
        qualityRating: channel.qualityRating || "",
        platformType: channel.platformType || "",
        isDefaultOutbound: Boolean(channel.isDefaultOutbound),
        coexistenceEnabled: Boolean(channel.coexistenceEnabled),
        lastHealthCheckedAt: channel.lastHealthCheckedAt?.toISOString?.() || null,
    };
}

async function listWhatsAppChannels(locationId: string) {
    const channels = await (db as any).whatsAppChannel.findMany({
        where: { locationId },
        orderBy: [
            { isDefaultOutbound: "desc" },
            { updatedAt: "desc" },
        ],
    }).catch(() => []);
    return channels.map(serializeWhatsAppChannel);
}

const EXPECTED_WEB_BRIDGE_SESSION_DIR = "/home/martin/whatsapp-web-sessions";

async function resolveAdminContext(locationIdInput?: string | null) {
    const { userId } = await auth();
    if (!userId) throw new Error("Unauthorized");

    const contextLocation = await getLocationContext();
    const locationId = locationIdInput || contextLocation?.id;
    if (!locationId) throw new Error("No location found");

    const isAdmin = await verifyUserIsLocationAdmin(userId, locationId);
    if (!isAdmin) throw new Error("Unauthorized");

    const [user, location] = await Promise.all([
        db.user.findUnique({
            where: { clerkId: userId },
            select: { id: true, phone: true },
        }),
        db.location.findUnique({ where: { id: locationId } }),
    ]);

    if (!user?.id || !location) {
        throw new Error("No location found");
    }

    return { clerkUserId: userId, localUserId: user.id, userPhone: user.phone || "", location };
}

export async function updateWhatsAppSettings(formData: FormData) {
    const locationId = String(formData.get("locationId") || "").trim();
    const { location, localUserId } = await resolveAdminContext(locationId || null);
    const resolvedLocationId = location.id;

    // Meta Credentials
    const businessAccountId = formData.get("businessAccountId") as string;
    const phoneNumberId = formData.get("phoneNumberId") as string;
    const accessTokenInput = String(formData.get("accessToken") || "").trim();
    const webhookSecret = formData.get("webhookSecret") as string;
    const providerModeInput = String(formData.get("whatsappProviderMode") || "web_bridge").trim();
    const whatsappProviderMode = ["cloud_primary", "twilio_fallback", "web_bridge"].includes(providerModeInput)
        ? providerModeInput
        : "web_bridge";

    // Twilio Credentials
    const twilioAccountSid = formData.get("twilioAccountSid") as string;
    const twilioAuthTokenInput = String(formData.get("twilioAuthToken") || "").trim();
    const twilioWhatsAppFrom = formData.get("twilioWhatsAppFrom") as string;
    const clearWhatsAppAccessToken = formData.get("clearWhatsAppAccessToken") === "on";
    const clearTwilioAuthToken = formData.get("clearTwilioAuthToken") === "on";

    const payload = {
        whatsappBusinessAccountId: businessAccountId || null,
        whatsappPhoneNumberId: phoneNumberId || null,
        whatsappWebhookSecret: webhookSecret || null,
        whatsappProviderMode,
        twilioAccountSid: twilioAccountSid || null,
        twilioWhatsAppFrom: twilioWhatsAppFrom || null,
    };

    await settingsService.upsertDocument({
        scopeType: "LOCATION",
        scopeId: resolvedLocationId,
        domain: SETTINGS_DOMAINS.LOCATION_INTEGRATIONS,
        payload,
        actorUserId: localUserId,
        schemaVersion: 1,
    });

    const shouldUpdateAccessToken = accessTokenInput.length > 0 && accessTokenInput !== MASKED_SECRET;
    const shouldUpdateTwilioAuthToken = twilioAuthTokenInput.length > 0 && twilioAuthTokenInput !== MASKED_SECRET;

    if (clearWhatsAppAccessToken) {
        await settingsService.clearSecret({
            scopeType: "LOCATION",
            scopeId: resolvedLocationId,
            domain: SETTINGS_DOMAINS.LOCATION_INTEGRATIONS,
            secretKey: SETTINGS_SECRET_KEYS.WHATSAPP_ACCESS_TOKEN,
            actorUserId: localUserId,
        });
    } else if (shouldUpdateAccessToken) {
        await settingsService.setSecret({
            scopeType: "LOCATION",
            scopeId: resolvedLocationId,
            domain: SETTINGS_DOMAINS.LOCATION_INTEGRATIONS,
            secretKey: SETTINGS_SECRET_KEYS.WHATSAPP_ACCESS_TOKEN,
            plaintext: accessTokenInput,
            actorUserId: localUserId,
        });
    }

    if (clearTwilioAuthToken) {
        await settingsService.clearSecret({
            scopeType: "LOCATION",
            scopeId: resolvedLocationId,
            domain: SETTINGS_DOMAINS.LOCATION_INTEGRATIONS,
            secretKey: SETTINGS_SECRET_KEYS.TWILIO_AUTH_TOKEN,
            actorUserId: localUserId,
        });
    } else if (shouldUpdateTwilioAuthToken) {
        await settingsService.setSecret({
            scopeType: "LOCATION",
            scopeId: resolvedLocationId,
            domain: SETTINGS_DOMAINS.LOCATION_INTEGRATIONS,
            secretKey: SETTINGS_SECRET_KEYS.TWILIO_AUTH_TOKEN,
            plaintext: twilioAuthTokenInput,
            actorUserId: localUserId,
        });
    }

    if (isSettingsDualWriteLegacyEnabled()) {
        const updateData: any = {
            whatsappBusinessAccountId: payload.whatsappBusinessAccountId,
            whatsappPhoneNumberId: payload.whatsappPhoneNumberId,
            whatsappWebhookSecret: payload.whatsappWebhookSecret,
            whatsappProviderMode: payload.whatsappProviderMode,
            twilioAccountSid: payload.twilioAccountSid,
            twilioWhatsAppFrom: payload.twilioWhatsAppFrom,
        };

        const cryptr = getLegacyCryptr();
        if (shouldUpdateAccessToken) {
            updateData.whatsappAccessToken = cryptr.encrypt(accessTokenInput);
        } else if (clearWhatsAppAccessToken) {
            updateData.whatsappAccessToken = null;
        }

        if (shouldUpdateTwilioAuthToken) {
            updateData.twilioAuthToken = cryptr.encrypt(twilioAuthTokenInput);
        } else if (clearTwilioAuthToken) {
            updateData.twilioAuthToken = null;
        }

        await db.location.update({
            where: { id: resolvedLocationId },
            data: updateData
        });
    }

    if (isSettingsDualWriteLegacyEnabled() && isSettingsParityCheckEnabled()) {
        await settingsService.checkDocumentParity({
            scopeType: "LOCATION",
            scopeId: resolvedLocationId,
            domain: SETTINGS_DOMAINS.LOCATION_INTEGRATIONS,
            legacyPayload: payload,
            actorUserId: localUserId,
        });
    }

    if (payload.whatsappBusinessAccountId && payload.whatsappPhoneNumberId) {
        await upsertWhatsAppCloudChannel({
            locationId: resolvedLocationId,
            wabaId: payload.whatsappBusinessAccountId,
            phone: {
                id: payload.whatsappPhoneNumberId,
                wabaId: payload.whatsappBusinessAccountId,
                status: "manual_configured",
            },
            providerMode: whatsappProviderMode as any,
            makeDefault: true,
        }).catch((error) => {
            console.warn("[WhatsApp Cloud] Failed to upsert manual channel:", error?.message || error);
        });
    }

    revalidatePath("/admin/settings/integrations/whatsapp");
    return { success: true };
}

export async function getWhatsAppSettings(locationId?: string | null) {
    const { location: contextLocation } = await resolveAdminContext(locationId || null);
    const location = contextLocation;
    const [doc, hasAccessToken, hasTwilioAuthToken] = await Promise.all([
        settingsService.getDocument<any>({
            scopeType: "LOCATION",
            scopeId: location.id,
            domain: SETTINGS_DOMAINS.LOCATION_INTEGRATIONS,
        }),
        settingsService.hasSecret({
            scopeType: "LOCATION",
            scopeId: location.id,
            domain: SETTINGS_DOMAINS.LOCATION_INTEGRATIONS,
            secretKey: SETTINGS_SECRET_KEYS.WHATSAPP_ACCESS_TOKEN,
        }).catch(() => false),
        settingsService.hasSecret({
            scopeType: "LOCATION",
            scopeId: location.id,
            domain: SETTINGS_DOMAINS.LOCATION_INTEGRATIONS,
            secretKey: SETTINGS_SECRET_KEYS.TWILIO_AUTH_TOKEN,
        }).catch(() => false),
    ]);

    const payload = doc?.payload || {};
    const providerMode = ["cloud_primary", "twilio_fallback", "web_bridge"].includes(String(payload.whatsappProviderMode || location.whatsappProviderMode || ""))
        ? String(payload.whatsappProviderMode || location.whatsappProviderMode)
        : "web_bridge";

    const [whatsappChannels, webBridgeSession, webBridgeHealth, callingConfig] = await Promise.all([
        listWhatsAppChannels(location.id),
        getWhatsAppWebBridgeSession(location.id),
        getWhatsAppWebBridgeHealth(800),
        (db as any).whatsAppCallingConfig.findUnique({ where: { locationId: location.id } }).catch(() => null),
    ]);

    return {
        // Meta
        businessAccountId: payload.whatsappBusinessAccountId || location.whatsappBusinessAccountId || "",
        phoneNumberId: payload.whatsappPhoneNumberId || location.whatsappPhoneNumberId || "",
        accessToken: "",
        hasAccessToken: hasAccessToken || Boolean(location.whatsappAccessToken),
        webhookSecret: payload.whatsappWebhookSecret || location.whatsappWebhookSecret || "",
        whatsappProviderMode: providerMode,
        whatsappChannels,
        whatsappCallingConfig: serializeWhatsAppCallingConfig(callingConfig),
        webBridgeSession: webBridgeSession ? {
            id: webBridgeSession.id,
            sessionId: webBridgeSession.sessionId,
            phone: webBridgeSession.phone || "",
            status: webBridgeSession.status || "disconnected",
            qrCode: webBridgeSession.qrCode || "",
            lastReadyAt: webBridgeSession.lastReadyAt?.toISOString?.() || null,
            lastSeenAt: webBridgeSession.lastSeenAt?.toISOString?.() || null,
            lastError: webBridgeSession.lastError || "",
            isDefaultOutbound: Boolean(webBridgeSession.isDefaultOutbound),
        } : null,
        webBridgeDiagnostics: buildWebBridgeDiagnostics({
            session: webBridgeSession,
            health: webBridgeHealth,
            expectedSessionDir: EXPECTED_WEB_BRIDGE_SESSION_DIR,
        }),

        // Twilio
        twilioAccountSid: payload.twilioAccountSid || location.twilioAccountSid || "",
        twilioAuthToken: "",
        hasTwilioAuthToken: hasTwilioAuthToken || Boolean(location.twilioAuthToken),
        twilioWhatsAppFrom: payload.twilioWhatsAppFrom || location.twilioWhatsAppFrom || "",

        locationId: location.id,
    };
}

export async function getWhatsAppWebBridgeDiagnostics(locationId?: string | null) {
    const { location } = await resolveAdminContext(locationId || null);
    const [session, health] = await Promise.all([
        getWhatsAppWebBridgeSession(location.id),
        getWhatsAppWebBridgeHealth(),
    ]);
    return {
        success: true as const,
        diagnostics: buildWebBridgeDiagnostics({
            session,
            health,
            expectedSessionDir: EXPECTED_WEB_BRIDGE_SESSION_DIR,
        }),
    };
}

export async function updateWhatsAppCallingSettings(input: {
    locationId?: string | null;
    phoneNumberId?: string | null;
    wabaId?: string | null;
    callingEnabled?: boolean | null;
    webhooksEnabled?: boolean | null;
    mediaMode?: string | null;
    sipEndpoint?: string | null;
    mediaNotes?: string | null;
}) {
    const { location } = await resolveAdminContext(input.locationId || null);
    const selectedChannel = input.phoneNumberId
        ? await (db as any).whatsAppChannel.findFirst({
            where: { locationId: location.id, phoneNumberId: String(input.phoneNumberId).trim() },
        }).catch(() => null)
        : null;
    const phoneNumberId = String(input.phoneNumberId || selectedChannel?.phoneNumberId || "").trim() || null;
    const wabaId = String(input.wabaId || selectedChannel?.wabaId || "").trim() || null;
    const mediaMode = ["sip", "browser_webrtc", "manual_sdp", "provider_managed"].includes(String(input.mediaMode || ""))
        ? String(input.mediaMode)
        : "sip";
    const config = await (db as any).whatsAppCallingConfig.upsert({
        where: { locationId: location.id },
        create: {
            locationId: location.id,
            provider: WHATSAPP_CALLING_PROVIDER,
            status: input.callingEnabled ? "ready" : "not_configured",
            phoneNumberId,
            wabaId,
            callingEnabled: input.callingEnabled === true,
            webhooksEnabled: input.webhooksEnabled === true,
            mediaMode,
            sipEndpoint: input.sipEndpoint ? String(input.sipEndpoint).trim() : null,
            mediaNotes: input.mediaNotes ? String(input.mediaNotes).trim() : null,
        },
        update: {
            provider: WHATSAPP_CALLING_PROVIDER,
            status: input.callingEnabled ? "ready" : "not_configured",
            phoneNumberId,
            wabaId,
            callingEnabled: input.callingEnabled === true,
            webhooksEnabled: input.webhooksEnabled === true,
            mediaMode,
            sipEndpoint: input.sipEndpoint ? String(input.sipEndpoint).trim() : null,
            mediaNotes: input.mediaNotes ? String(input.mediaNotes).trim() : null,
        },
    });

    const readiness = await checkCallingReadiness(location.id);
    revalidatePath("/admin/settings/integrations/whatsapp");
    return {
        success: true as const,
        config: serializeWhatsAppCallingConfig(config),
        readiness,
    };
}

export async function checkWhatsAppCallingReadinessAction(locationId?: string | null) {
    const { location } = await resolveAdminContext(locationId || null);
    const readiness = await checkCallingReadiness(location.id);
    const config = await (db as any).whatsAppCallingConfig.findUnique({
        where: { locationId: location.id },
    }).catch(() => null);
    return {
        success: true as const,
        readiness,
        config: serializeWhatsAppCallingConfig(config),
    };
}

export async function connectWhatsAppWebBridge(locationId?: string | null) {
    const { location, localUserId } = await resolveAdminContext(locationId || null);
    try {
        const bridgeResult = await startWhatsAppWebBridgeSession(location.id);
        const doc = await settingsService.getDocument<any>({
            scopeType: "LOCATION",
            scopeId: location.id,
            domain: SETTINGS_DOMAINS.LOCATION_INTEGRATIONS,
        }).catch(() => null);
        await settingsService.upsertDocument({
            scopeType: "LOCATION",
            scopeId: location.id,
            domain: SETTINGS_DOMAINS.LOCATION_INTEGRATIONS,
            payload: {
                ...(doc?.payload || {}),
                whatsappProviderMode: "web_bridge",
            },
            actorUserId: localUserId,
            schemaVersion: doc?.schemaVersion || 1,
        });
        await db.location.update({
            where: { id: location.id },
            data: { whatsappProviderMode: "web_bridge" } as any,
        });
        revalidatePath("/admin/settings/integrations/whatsapp");
        return { success: true as const, bridgeResult };
    } catch (error: any) {
        await upsertWhatsAppWebBridgeSession(location.id, {
            status: "failed",
            lastError: error?.message || "WhatsApp Web Bridge service is not reachable.",
            isDefaultOutbound: true,
        });
        return {
            success: false as const,
            error: `${error?.message || "Unable to start WhatsApp Web Bridge."} Bridge URL: ${getWhatsAppWebBridgeBaseUrl()}`,
        };
    }
}

export async function restartWhatsAppWebBridge(locationId?: string | null) {
    const { location, localUserId } = await resolveAdminContext(locationId || null);
    try {
        const bridgeResult = await restartWhatsAppWebBridgeSession(location.id);
        const doc = await settingsService.getDocument<any>({
            scopeType: "LOCATION",
            scopeId: location.id,
            domain: SETTINGS_DOMAINS.LOCATION_INTEGRATIONS,
        }).catch(() => null);
        await settingsService.upsertDocument({
            scopeType: "LOCATION",
            scopeId: location.id,
            domain: SETTINGS_DOMAINS.LOCATION_INTEGRATIONS,
            payload: {
                ...(doc?.payload || {}),
                whatsappProviderMode: "web_bridge",
            },
            actorUserId: localUserId,
            schemaVersion: doc?.schemaVersion || 1,
        });
        await db.location.update({
            where: { id: location.id },
            data: { whatsappProviderMode: "web_bridge" } as any,
        }).catch(() => null);
        revalidatePath("/admin/settings/integrations/whatsapp");
        return { success: true as const, bridgeResult };
    } catch (error: any) {
        await upsertWhatsAppWebBridgeSession(location.id, {
            status: "failed",
            lastError: error?.message || "WhatsApp Web Bridge restart failed.",
            isDefaultOutbound: true,
        });
        return {
            success: false as const,
            error: `${error?.message || "Unable to restart WhatsApp Web Bridge."} Bridge URL: ${getWhatsAppWebBridgeBaseUrl()}`,
        };
    }
}

export async function disconnectWhatsAppWebBridge(locationId?: string | null) {
    const { location } = await resolveAdminContext(locationId || null);
    try {
        await stopWhatsAppWebBridgeSession(location.id);
    } catch (error: any) {
        await upsertWhatsAppWebBridgeSession(location.id, {
            status: "disconnected",
            qrCode: null,
            lastError: error?.message || null,
            isDefaultOutbound: false,
        });
    }
    revalidatePath("/admin/settings/integrations/whatsapp");
    return { success: true as const };
}

export async function clearWhatsAppWebBridge(locationId?: string | null) {
    const { location } = await resolveAdminContext(locationId || null);
    await clearWhatsAppWebBridgeSession(location.id);
    revalidatePath("/admin/settings/integrations/whatsapp");
    return { success: true as const };
}

export async function setWhatsAppWebBridgeDefault(locationId?: string | null) {
    const { location, localUserId } = await resolveAdminContext(locationId || null);
    const doc = await settingsService.getDocument<any>({
        scopeType: "LOCATION",
        scopeId: location.id,
        domain: SETTINGS_DOMAINS.LOCATION_INTEGRATIONS,
    }).catch(() => null);
    await settingsService.upsertDocument({
        scopeType: "LOCATION",
        scopeId: location.id,
        domain: SETTINGS_DOMAINS.LOCATION_INTEGRATIONS,
        payload: {
            ...(doc?.payload || {}),
            whatsappProviderMode: "web_bridge",
        },
        actorUserId: localUserId,
        schemaVersion: doc?.schemaVersion || 1,
    });
    await db.location.update({
        where: { id: location.id },
        data: { whatsappProviderMode: "web_bridge" } as any,
    }).catch(() => null);
    await upsertWhatsAppWebBridgeSession(location.id, { isDefaultOutbound: true });
    revalidatePath("/admin/settings/integrations/whatsapp");
    return { success: true as const };
}

function normalizeTemplateStatus(value: unknown) {
    return String(value || "UNKNOWN").toLowerCase();
}

function normalizeTemplateCategory(value: unknown) {
    return String(value || "UTILITY").toUpperCase();
}

function normalizeTemplateLocalStatus(row: any) {
    const status = String(row?.status || "").toLowerCase();
    if (String(row?.localStatus || "").trim()) return String(row.localStatus).toLowerCase();
    if (status === "approved") return "approved";
    if (status === "rejected") return "rejected";
    if (["pending", "submitted", "in_appeal"].includes(status)) return "pending";
    return "synced";
}

function serializeWhatsAppTemplate(row: any) {
    const components = Array.isArray(row.components) ? row.components : [];
    const bodyText = row.bodyText || extractTemplateBodyText(components);
    const examples = row.examples && typeof row.examples === "object" ? row.examples : {};
    const validation = validateWhatsAppTemplate({
        name: row.name,
        category: row.category,
        language: row.language,
        bodyText,
        headerText: row.header?.text || "",
        footerText: row.footer || "",
        examples,
    });
    return {
        id: row.id,
        name: row.name,
        language: row.language,
        category: row.category,
        status: row.status,
        localStatus: normalizeTemplateLocalStatus(row),
        metaTemplateId: row.metaTemplateId || null,
        rejectionReason: row.rejectionReason || null,
        bodyText,
        header: row.header || null,
        footer: row.footer || "",
        buttons: row.buttons || [],
        components,
        variableLabels: row.variableLabels || {},
        examples,
        aiPrompt: row.aiPrompt || "",
        aiRiskNotes: row.aiRiskNotes || [],
        previewText: renderTemplatePreview(bodyText, examples),
        validation,
        lastSyncedAt: row.lastSyncedAt?.toISOString?.() || null,
        updatedAt: row.updatedAt?.toISOString?.() || null,
    };
}

async function upsertLocalWhatsAppTemplate(locationId: string, template: any, fallbackWabaId?: string) {
    const credentials = fallbackWabaId
        ? null
        : await getWhatsAppCloudCredentials(locationId).catch(() => null);
    const wabaId = String(fallbackWabaId || credentials?.businessAccountId || template?.wabaId || "").trim();
    const name = String(template?.name || "").trim();
    const language = String(template?.language || "").trim();
    if (!wabaId || !name || !language) return null;

    return (db as any).whatsAppTemplate.upsert({
        where: {
            locationId_name_language: {
                locationId,
                name,
                language,
            },
        },
        create: {
            locationId,
            wabaId,
            name,
            language,
            category: normalizeTemplateCategory(template?.category),
            status: normalizeTemplateStatus(template?.status),
            components: template?.components || [],
            parameterFormat: template?.parameter_format || template?.parameterFormat || null,
            metaTemplateId: template?.id ? String(template.id) : null,
            rejectionReason: template?.rejected_reason || template?.rejectionReason || null,
            bodyText: extractTemplateBodyText(template?.components || []),
            localStatus: normalizeTemplateStatus(template?.status) === "approved"
                ? "approved"
                : normalizeTemplateStatus(template?.status) === "rejected"
                    ? "rejected"
                    : "pending",
            lastSyncedAt: new Date(),
        },
        update: {
            wabaId,
            category: normalizeTemplateCategory(template?.category),
            status: normalizeTemplateStatus(template?.status),
            components: template?.components || [],
            parameterFormat: template?.parameter_format || template?.parameterFormat || null,
            metaTemplateId: template?.id ? String(template.id) : null,
            rejectionReason: template?.rejected_reason || template?.rejectionReason || null,
            bodyText: extractTemplateBodyText(template?.components || []),
            localStatus: normalizeTemplateStatus(template?.status) === "approved"
                ? "approved"
                : normalizeTemplateStatus(template?.status) === "rejected"
                    ? "rejected"
                    : "pending",
            lastSyncedAt: new Date(),
        },
    });
}

export async function getWhatsAppCloudHealth(locationId?: string | null) {
    const { location } = await resolveAdminContext(locationId || null);
    return getCloudHealth(location.id);
}

export async function verifyWhatsAppCloudChannel(channelId: string, locationId?: string | null) {
    const { location } = await resolveAdminContext(locationId || null);
    const channel = await (db as any).whatsAppChannel.findFirst({
        where: { id: channelId, locationId: location.id },
    });
    if (!channel) throw new Error("WhatsApp channel not found.");

    const health = await getCloudHealth(location.id, channel.id);
    revalidatePath("/admin/settings/integrations/whatsapp");
    return {
        success: health.ok,
        health,
        channels: await listWhatsAppChannels(location.id),
    };
}

export async function setDefaultWhatsAppChannelAction(channelId: string, locationId?: string | null) {
    const { location } = await resolveAdminContext(locationId || null);
    await setDefaultWhatsAppCloudChannel(location.id, channelId);
    revalidatePath("/admin/settings/integrations/whatsapp");
    return {
        success: true as const,
        channels: await listWhatsAppChannels(location.id),
    };
}

export async function syncWhatsAppTemplates(locationId?: string | null) {
    const { location } = await resolveAdminContext(locationId || null);
    const credentials = await getWhatsAppCloudCredentials(location.id);
    const templates = await fetchWhatsAppCloudTemplates(location.id);
    const rows = [];

    for (const template of templates) {
        const row = await upsertLocalWhatsAppTemplate(location.id, template, credentials.businessAccountId);
        if (row) rows.push(row);
    }

    revalidatePath("/admin/settings/integrations/whatsapp");
    return {
        success: true as const,
        count: rows.length,
        templates: rows.map(serializeWhatsAppTemplate),
    };
}

export async function listWhatsAppTemplates(locationId?: string | null) {
    const { location } = await resolveAdminContext(locationId || null);
    const rows = await (db as any).whatsAppTemplate.findMany({
        where: { locationId: location.id },
        orderBy: [{ updatedAt: "desc" }],
    });
    return { success: true as const, templates: rows.map(serializeWhatsAppTemplate) };
}

export async function saveWhatsAppTemplateDraft(input: {
    locationId?: string | null;
    templateId?: string | null;
    name: string;
    language: string;
    category: string;
    bodyText: string;
    headerText?: string | null;
    footerText?: string | null;
    buttons?: any[];
    variableLabels?: Record<string, string>;
    examples?: Record<string, string>;
    aiPrompt?: string | null;
    aiRiskNotes?: any;
}) {
    const { location } = await resolveAdminContext(input.locationId || null);
    const credentials = await getWhatsAppCloudCredentials(location.id);
    const name = normalizeTemplateName(input.name);
    const category = normalizeTemplateCategory(input.category);
    const bodyText = String(input.bodyText || "").trim();
    const headerText = String(input.headerText || "").trim();
    const footerText = String(input.footerText || "").trim();
    const validation = validateWhatsAppTemplate({
        name,
        language: input.language,
        category,
        bodyText,
        headerText,
        footerText,
        examples: input.examples || {},
    });
    if (!name) throw new Error("Template name is required.");
    if (!bodyText) throw new Error("Template body is required.");

    const components = buildWhatsAppTemplateComponents({
        headerText,
        bodyText,
        footerText,
        buttons: input.buttons || [],
        examples: input.examples || {},
    });

    const row = await (db as any).whatsAppTemplate.upsert({
        where: {
            locationId_name_language: {
                locationId: location.id,
                name,
                language: String(input.language || "en_US").trim(),
            },
        },
        create: {
            locationId: location.id,
            wabaId: credentials.businessAccountId,
            name,
            language: String(input.language || "en_US").trim(),
            category,
            status: "draft",
            localStatus: validation.ok ? "ready" : "draft",
            components,
            bodyText,
            header: headerText ? { type: "TEXT", text: headerText } : null,
            footer: footerText || null,
            buttons: input.buttons || [],
            variableLabels: input.variableLabels || {},
            examples: input.examples || {},
            aiPrompt: input.aiPrompt || null,
            aiRiskNotes: input.aiRiskNotes || [],
        },
        update: {
            category,
            status: "draft",
            localStatus: validation.ok ? "ready" : "draft",
            components,
            bodyText,
            header: headerText ? { type: "TEXT", text: headerText } : null,
            footer: footerText || null,
            buttons: input.buttons || [],
            variableLabels: input.variableLabels || {},
            examples: input.examples || {},
            aiPrompt: input.aiPrompt || null,
            aiRiskNotes: input.aiRiskNotes || [],
        },
    });

    revalidatePath("/admin/settings/integrations/whatsapp");
    return { success: true as const, template: serializeWhatsAppTemplate(row), validation };
}

export async function generateWhatsAppTemplateDrafts(input: {
    locationId?: string | null;
    intent: string;
    notes?: string | null;
    language?: string | null;
    model?: string | null;
}) {
    const context = await resolveAdminContext(input.locationId || null);
    const intent = String(input.intent || "first contact").trim();
    const language = String(input.language || "en_US").trim();
    const notes = String(input.notes || "").trim();
    const model = String(input.model || GEMINI_DRAFT_FAST_DEFAULT).trim() || GEMINI_DRAFT_FAST_DEFAULT;
    const systemPrompt = [
        "You create WhatsApp Business Cloud API message templates for an enterprise real-estate SaaS.",
        "Return strict JSON only.",
        "Generate 3 variants. Do not submit anything to Meta.",
        "Each variant must include name, category, language, components, variableLabels, examples, riskNotes, approvalChecklist.",
        "Use BODY text with sequential variables like {{1}}, {{2}}. Provide sample values for every variable.",
        "Categories must be UTILITY, MARKETING, or AUTHENTICATION.",
        "Utility templates must be tied to an actual customer action or transaction.",
        "Marketing templates may be promotional and should include an opt-out footer where appropriate.",
    ].join("\n");
    const userContent = JSON.stringify({ intent, language, notes });
    const raw = await callLLM(model, systemPrompt, userContent, {
        jsonMode: true,
        temperature: 0.4,
        maxOutputTokens: 3000,
        locationId: context.location.id,
        executionMode: "interactive",
    });
    let parsed: any;
    try {
        parsed = JSON.parse(raw);
    } catch {
        throw new Error("AI returned an invalid template response. Please try again.");
    }
    const variants = Array.isArray(parsed?.variants) ? parsed.variants : Array.isArray(parsed) ? parsed : [];
    return {
        success: true as const,
        variants: variants.slice(0, 3).map((variant: any) => {
            const components = Array.isArray(variant.components) ? variant.components : [];
            const bodyText = String(variant.bodyText || extractTemplateBodyText(components) || "").trim();
            const footer = components.find((component: any) => String(component?.type || "").toUpperCase() === "FOOTER")?.text || variant.footer || "";
            const header = components.find((component: any) => String(component?.type || "").toUpperCase() === "HEADER");
            const examples = variant.examples || {};
            const normalized = {
                name: normalizeTemplateName(variant.name || intent),
                category: normalizeTemplateCategory(variant.category),
                language: variant.language || language,
                bodyText,
                headerText: header?.text || variant.headerText || "",
                footerText: footer,
                buttons: variant.buttons || [],
                variableLabels: variant.variableLabels || {},
                examples,
                riskNotes: Array.isArray(variant.riskNotes) ? variant.riskNotes : [],
                approvalChecklist: Array.isArray(variant.approvalChecklist) ? variant.approvalChecklist : [],
            };
            return {
                ...normalized,
                previewText: renderTemplatePreview(bodyText, examples),
                validation: validateWhatsAppTemplate(normalized),
            };
        }),
    };
}

export async function createWhatsAppTemplate(input: {
    locationId?: string | null;
    name: string;
    language: string;
    category: string;
    components: any[];
    parameterFormat?: string | null;
    variableLabels?: any;
    examples?: any;
}) {
    const { location } = await resolveAdminContext(input.locationId || null);
    const name = String(input.name || "").trim().toLowerCase().replace(/[^a-z0-9_]/g, "_");
    const language = String(input.language || "en_US").trim();
    const category = normalizeTemplateCategory(input.category);
    const components = Array.isArray(input.components) ? input.components : [];

    if (!name) throw new Error("Template name is required.");
    if (!components.length) throw new Error("At least one template component is required.");

    const created = await createWhatsAppCloudTemplate(location.id, {
        name,
        language,
        category,
        components,
        parameterFormat: input.parameterFormat || null,
    });

    const credentials = await getWhatsAppCloudCredentials(location.id);
    const row = await (db as any).whatsAppTemplate.upsert({
        where: {
            locationId_name_language: {
                locationId: location.id,
                name,
                language,
            },
        },
        create: {
            locationId: location.id,
            wabaId: credentials.businessAccountId,
            name,
            language,
            category,
            status: normalizeTemplateStatus(created?.status || "submitted"),
            localStatus: "pending",
            components,
            parameterFormat: input.parameterFormat || null,
            metaTemplateId: created?.id ? String(created.id) : null,
            variableLabels: input.variableLabels || null,
            examples: input.examples || null,
            bodyText: extractTemplateBodyText(components),
            lastSyncedAt: new Date(),
        },
        update: {
            category,
            status: normalizeTemplateStatus(created?.status || "submitted"),
            localStatus: "pending",
            components,
            parameterFormat: input.parameterFormat || null,
            metaTemplateId: created?.id ? String(created.id) : null,
            variableLabels: input.variableLabels || null,
            examples: input.examples || null,
            bodyText: extractTemplateBodyText(components),
            lastSyncedAt: new Date(),
        },
    });

    revalidatePath("/admin/settings/integrations/whatsapp");
    return { success: true as const, template: row, meta: created };
}

export async function submitWhatsAppTemplateDraft(input: {
    locationId?: string | null;
    templateId?: string | null;
    name?: string;
    language?: string;
    category?: string;
    bodyText?: string;
    headerText?: string | null;
    footerText?: string | null;
    buttons?: any[];
    variableLabels?: Record<string, string>;
    examples?: Record<string, string>;
}) {
    const { location } = await resolveAdminContext(input.locationId || null);
    const existing = input.templateId
        ? await (db as any).whatsAppTemplate.findFirst({ where: { id: input.templateId, locationId: location.id } })
        : null;
    const name = normalizeTemplateName(input.name || existing?.name || "");
    const language = String(input.language || existing?.language || "en_US").trim();
    const category = normalizeTemplateCategory(input.category || existing?.category || "UTILITY");
    const bodyText = String(input.bodyText || existing?.bodyText || extractTemplateBodyText(existing?.components || []) || "").trim();
    const headerText = String(input.headerText ?? existing?.header?.text ?? "").trim();
    const footerText = String(input.footerText ?? existing?.footer ?? "").trim();
    const buttons = input.buttons || existing?.buttons || [];
    const variableLabels = input.variableLabels || existing?.variableLabels || {};
    const examples = input.examples || existing?.examples || {};
    const validation = validateWhatsAppTemplate({ name, language, category, bodyText, headerText, footerText, examples });
    if (!validation.ok) {
        throw new Error(validation.errors.join(" "));
    }
    const components = buildWhatsAppTemplateComponents({ headerText, bodyText, footerText, buttons, examples });
    return createWhatsAppTemplate({
        locationId: location.id,
        name,
        language,
        category,
        components,
        variableLabels,
        examples,
    });
}

export async function repairWhatsAppCloudConnection(locationId?: string | null) {
    const { location } = await resolveAdminContext(locationId || null);
    const subscribeResult = await subscribeWhatsAppAppToWaba(location.id).catch((error) => ({
        error: error?.message || String(error),
    }));
    const templateResult = await syncWhatsAppTemplates(location.id).catch((error) => ({
        success: false as const,
        error: error?.message || String(error),
    }));
    const health = await getCloudHealth(location.id);

    revalidatePath("/admin/settings/integrations/whatsapp");
    return {
        success: health.ok,
        subscribeResult,
        templateResult,
        health,
        channels: await listWhatsAppChannels(location.id),
    };
}

export async function exchangeSystemUserToken(
    authCodeOrToken: string,
    appId: string,
    redirectUri?: string,
    isDirectToken: boolean = false,
    locationId?: string | null,
    selectedPhoneNumberId?: string | null
) {
    const appSecret = process.env.META_APP_SECRET;
    if (!appSecret) throw new Error("Server Misconfiguration: META_APP_SECRET is missing.");
    const { location, localUserId } = await resolveAdminContext(locationId || null);
    const resolvedLocationId = location.id;

    console.log("🔄 Starting Token Processing for Location:", resolvedLocationId);
    console.log("📍 Mode:", isDirectToken ? "Direct Token" : "Code Exchange");

    try {
        let accessToken: string;

        if (isDirectToken) {
            // User Access Token flow - token provided directly
            accessToken = authCodeOrToken;
            console.log("✅ Using provided Access Token directly");
        } else {
            // System User Access Token flow - exchange code for token
            const tokenUrl = `https://graph.facebook.com/v21.0/oauth/access_token`;
            const tokenResponse = await axios.get(tokenUrl, {
                params: {
                    client_id: appId,
                    client_secret: appSecret,
                    code: authCodeOrToken,
                    ...(redirectUri && { redirect_uri: redirectUri }),
                }
            });

            accessToken = tokenResponse.data.access_token;
            if (!accessToken) throw new Error("Failed to retrieve access_token from Meta");
            console.log("✅ Got Access Token from code exchange");
        }

        // 3. Fetch WABA (WhatsApp Business Account)
        let wabas: any[] = [];
        try {
            console.log("📍 Trying to fetch businesses...");
            const businessesUrl = `https://graph.facebook.com/v21.0/me/businesses`;
            const businessesResponse = await axios.get(businessesUrl, {
                params: { access_token: accessToken }
            });

            const businesses = businessesResponse.data.data || [];
            console.log("✅ Found businesses:", businesses.length);

            // For each business, try to get owned WABAs
            for (const business of businesses) {
                try {
                    const wabaUrl = `https://graph.facebook.com/v21.0/${business.id}/owned_whatsapp_business_accounts`;
                    const wabaResponse = await axios.get(wabaUrl, {
                        params: { access_token: accessToken }
                    });
                    if (wabaResponse.data.data?.length > 0) {
                        wabas = wabaResponse.data.data;
                        console.log("✅ Found WABAs from business", business.id, ":", wabas.length);
                        break;
                    }
                } catch (e) {
                    // Continue to next business
                }
            }
        } catch (e: any) {
            console.log("📍 Could not fetch businesses:", e.response?.data?.error?.message || e.message);
        }

        // Try 2: Direct debug_token to get granted assets (for Embedded Signup)
        if (wabas.length === 0) {
            try {
                console.log("📍 Trying debug_token for granted assets...");
                const debugUrl = `https://graph.facebook.com/v21.0/debug_token`;
                const debugResponse = await axios.get(debugUrl, {
                    params: {
                        input_token: accessToken,
                        access_token: accessToken
                    }
                });

                const granularScopes = debugResponse.data.data?.granular_scopes || [];
                for (const scope of granularScopes) {
                    if (scope.scope === 'whatsapp_business_management' && scope.target_ids?.length > 0) {
                        // These are WABA IDs we have access to
                        wabas = scope.target_ids.map((id: string) => ({ id }));
                        console.log("✅ Found WABA IDs from granted scopes:", wabas.length);
                        break;
                    }
                }
            } catch (e: any) {
                console.log("📍 Could not debug token:", e.response?.data?.error?.message || e.message);
            }
        }

        if (wabas.length === 0) {
            console.warn("⚠️ No WABA found through any method.");
            throw new Error("No WhatsApp Business Account found. Make sure you completed the WhatsApp setup in the popup and have permission to access a WABA.");
        }

        const wabaId = wabas[0].id;
        console.log("✅ Using WABA ID:", wabaId);

        // 4. Fetch and sync all Phone Numbers on this WABA.
        const phoneUrl = `https://graph.facebook.com/v21.0/${wabaId}/phone_numbers`;
        const phoneResponse = await axios.get(phoneUrl, {
            params: {
                access_token: accessToken,
                fields: "id,display_phone_number,verified_name,quality_rating,platform_type,code_verification_status",
            }
        });

        const phones = phoneResponse.data.data;
        if (!phones || phones.length === 0) {
            console.warn("⚠️ WABA has no phone numbers.");
            throw new Error("No Phone Numbers found in this WhatsApp Account.");
        }

        const selectedId = String(selectedPhoneNumberId || "").trim();
        const syncedChannels = [];
        for (const phone of phones) {
            const makeDefault = selectedId
                ? String(phone?.id || "") === selectedId
                : false;
            const channel = await upsertWhatsAppCloudChannel({
                locationId: resolvedLocationId,
                wabaId,
                phone,
                providerMode: "cloud_primary",
                makeDefault,
            });
            syncedChannels.push(channel);
        }

        const defaultChannel =
            syncedChannels.find((channel: any) => selectedId && channel.phoneNumberId === selectedId)
            || syncedChannels.find((channel: any) => channel.isDefaultOutbound)
            || syncedChannels[0];
        if (defaultChannel?.id) {
            await setDefaultWhatsAppCloudChannel(resolvedLocationId, defaultChannel.id);
        }

        const phoneNumberId = defaultChannel.phoneNumberId;
        const displayPhoneNumber = defaultChannel.displayPhoneNumber || phoneNumberId;
        console.log("✅ Synced Phone IDs:", syncedChannels.length, "Default:", phoneNumberId, "Display:", displayPhoneNumber);

        // 5. Save encrypted token in settings secrets
        await settingsService.setSecret({
            scopeType: "LOCATION",
            scopeId: resolvedLocationId,
            domain: SETTINGS_DOMAINS.LOCATION_INTEGRATIONS,
            secretKey: SETTINGS_SECRET_KEYS.WHATSAPP_ACCESS_TOKEN,
            plaintext: accessToken,
            actorUserId: localUserId,
        });

        const integrationPayload = {
            whatsappBusinessAccountId: wabaId,
            whatsappPhoneNumberId: phoneNumberId,
            whatsappWebhookSecret: location.whatsappWebhookSecret || crypto.randomUUID(),
            whatsappProviderMode: "cloud_primary",
            twilioAccountSid: location.twilioAccountSid || null,
            twilioWhatsAppFrom: location.twilioWhatsAppFrom || null,
        };

        await settingsService.upsertDocument({
            scopeType: "LOCATION",
            scopeId: resolvedLocationId,
            domain: SETTINGS_DOMAINS.LOCATION_INTEGRATIONS,
            payload: integrationPayload,
            actorUserId: localUserId,
            schemaVersion: 1,
        });

        // 6. Dual-write to legacy columns
        // Ensure webhook secret is set if missing
        const currentSettings = await db.location.findUnique({ where: { id: resolvedLocationId }, select: { whatsappWebhookSecret: true } });
        const webhookSecret = currentSettings?.whatsappWebhookSecret || crypto.randomUUID();

        if (isSettingsDualWriteLegacyEnabled()) {
            const encryptedAccessToken = getLegacyCryptr().encrypt(accessToken);
            await db.location.update({
                where: { id: resolvedLocationId },
                data: {
                    whatsappBusinessAccountId: wabaId,
                    whatsappPhoneNumberId: phoneNumberId,
                    whatsappAccessToken: encryptedAccessToken,
                    whatsappWebhookSecret: webhookSecret,
                    whatsappProviderMode: "cloud_primary",
                } as any
            });
        }

        await subscribeWhatsAppAppToWaba(resolvedLocationId).catch((error) => {
            console.warn("[WhatsApp Cloud] Embedded signup webhook subscription failed:", error?.message || error);
        });
        await syncWhatsAppTemplates(resolvedLocationId).catch((error) => {
            console.warn("[WhatsApp Cloud] Embedded signup template sync failed:", error?.message || error);
        });

        if (isSettingsDualWriteLegacyEnabled() && isSettingsParityCheckEnabled()) {
            await settingsService.checkDocumentParity({
                scopeType: "LOCATION",
                scopeId: resolvedLocationId,
                domain: SETTINGS_DOMAINS.LOCATION_INTEGRATIONS,
                legacyPayload: {
                    ...integrationPayload,
                    whatsappWebhookSecret: webhookSecret,
                },
                actorUserId: localUserId,
            });
        }

        console.log("🎉 WhatsApp Settings Updated Successfully!");

        revalidatePath("/admin/settings/integrations/whatsapp");
        return { success: true, message: `Connected: ${displayPhoneNumber}` };

    } catch (error: any) {
        console.error("❌ Token Exchange Failed:", error.response?.data || error.message);
        return {
            success: false,
            message: error.response?.data?.error?.message || error.message || "Token Exchange Failed"
        };
    }
}
