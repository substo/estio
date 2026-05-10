"use server";

import db from "@/lib/db";
import { auth } from "@clerk/nextjs/server";
import { revalidatePath } from "next/cache";
import axios from "axios";
import { evolutionClient } from "@/lib/evolution/client";
import { getLocationContext } from "@/lib/auth/location-context";
import { parseEvolutionMessageContent } from "@/lib/whatsapp/evolution-media";
import { extractPhoneJidCandidate, normalizeDigits } from "@/lib/whatsapp/identity";
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

const MASKED_SECRET = "********";

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
    const providerModeInput = String(formData.get("whatsappProviderMode") || "cloud_primary").trim();
    const whatsappProviderMode = ["cloud_primary", "evolution_linked", "twilio_fallback"].includes(providerModeInput)
        ? providerModeInput
        : "cloud_primary";

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
        evolutionInstanceId: location.evolutionInstanceId || null,
        evolutionApiToken: location.evolutionApiToken || null,
        evolutionConnectionStatus: location.evolutionConnectionStatus || null,
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

    // Evolution Status Check (Lazy Sync)
    // If DB says "close" or "connecting", double check with API in case webhook failed
    const payloadInstanceId = payload.evolutionInstanceId || location.evolutionInstanceId;
    let evolutionStatus = payload.evolutionConnectionStatus || location.evolutionConnectionStatus || "close";
    if (payloadInstanceId && evolutionStatus !== "open") {
        try {
            // Only try to fetch if we have an instance ID
            const instanceData = await evolutionClient.fetchInstance(payloadInstanceId);
            let realStatus = "unknown";

            if (Array.isArray(instanceData)) {
                const ref = instanceData.find((i: any) => i.instance?.instanceName === payloadInstanceId) || instanceData[0];
                realStatus = ref?.instance?.status || ref?.connectionStatus || "unknown";
            } else if (instanceData) {
                realStatus = instanceData.instance?.status || instanceData.connectionStatus || "unknown";
            }

            if (realStatus === "open" || realStatus === "connected") {
                evolutionStatus = "open";
                // Sync back to DB
                await db.location.update({
                    where: { id: location.id },
                    data: { evolutionConnectionStatus: "open" }
                });
            }
        } catch (e) {
            // Ignore error, fallback to DB status
        }
    }

    const whatsappChannels = await listWhatsAppChannels(location.id);

    return {
        // Meta
        businessAccountId: payload.whatsappBusinessAccountId || location.whatsappBusinessAccountId || "",
        phoneNumberId: payload.whatsappPhoneNumberId || location.whatsappPhoneNumberId || "",
        accessToken: "",
        hasAccessToken: hasAccessToken || Boolean(location.whatsappAccessToken),
        webhookSecret: payload.whatsappWebhookSecret || location.whatsappWebhookSecret || "",
        whatsappProviderMode: payload.whatsappProviderMode || (location as any).whatsappProviderMode || "cloud_primary",
        whatsappChannels,

        // Twilio
        twilioAccountSid: payload.twilioAccountSid || location.twilioAccountSid || "",
        twilioAuthToken: "",
        hasTwilioAuthToken: hasTwilioAuthToken || Boolean(location.twilioAuthToken),
        twilioWhatsAppFrom: payload.twilioWhatsAppFrom || location.twilioWhatsAppFrom || "",

        // Evolution
        evolutionInstanceId: payloadInstanceId || "",
        evolutionConnectionStatus: evolutionStatus,

        locationId: location.id,
    };
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
    await resolveAdminContext(input.locationId || null);
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

export async function connectEvolutionDevice(locationId?: string | null) {
    const { location, userPhone } = await resolveAdminContext(locationId || null);

    try {

        // 0.5 Health Check: Ensure Evolution API is reachable before attempting connection
        const health = await evolutionClient.healthCheck();
        if (!health.ok) {
            console.error("Evolution Health Check Failed:", health.error);
            return {
                success: false,
                error: health.error || "WhatsApp service is temporarily unavailable. Please try again later."
            };
        }

        // 1. Check if instance exists, if not create
        let qrCodeBase64 = null;
        const instanceName = location.id;

        // Try to create (idempotent usually? or check if needed)
        // Evolution V2: create if not exists
        try {
            const createRes = await evolutionClient.createInstance(location.id, instanceName);
            if (createRes.qrcode?.base64) {
                qrCodeBase64 = createRes.qrcode.base64;
            }
        } catch (e: any) {
            // Check if this is a connection error
            if (evolutionClient.isConnectionError(e)) {
                return {
                    success: false,
                    error: "WhatsApp service is unavailable. Please ensure Docker is running (local) or contact support."
                };
            }
            // If already exists, ignored or handle
            console.log("Instance might already exist, fetching connect...");
        }


        // 2. Fetch connection status/QR
        // If we didn't get QR from create (e.g. already existed), fetch it
        if (!qrCodeBase64) {
            let attempts = 0;
            // Increase to 10 attempts (approx 20s) as Evolution startup can be slow
            while (attempts < 10 && !qrCodeBase64) {
                attempts++;
                console.log(`Polling for QR Code (Attempt ${attempts}/10)...`);

                // Strategy A: Try connect endpoint (Trigger connection)
                if (!qrCodeBase64) {
                    const connectRes = await evolutionClient.connectInstance(instanceName);
                    if (connectRes?.base64 || connectRes?.qrcode?.base64) {
                        qrCodeBase64 = connectRes.base64 || connectRes.qrcode.base64;
                        console.log("Got QR Code from connectInstance!");
                        break;
                    }
                }

                // Strategy B: Check fetchInstance state (Just in case it's already connected or has QR in metadata)
                if (!qrCodeBase64) {
                    const fetchRes = await evolutionClient.fetchInstance(instanceName);
                    if (fetchRes?.qrcode?.base64) {
                        qrCodeBase64 = fetchRes.qrcode.base64;
                        console.log("Got QR Code from fetchInstance!");
                        break;
                    }

                    // Log status for debugging
                    let status = "unknown";
                    let ownerJid = "";

                    // Handle both array (v2) and object (v1?) responses
                    if (Array.isArray(fetchRes)) {
                        const instanceRef = fetchRes.find((i: any) => i.instance?.instanceName === instanceName) || fetchRes[0];
                        status = instanceRef?.instance?.status || instanceRef?.connectionStatus || "unknown";
                        ownerJid = instanceRef?.instance?.owner || "";
                    } else if (fetchRes) {
                        status = fetchRes.instance?.status || fetchRes.connectionStatus || "unknown";
                        ownerJid = fetchRes.instance?.owner || "";
                    }
                    console.log(`Current Instance Status: ${status}, Owner: ${ownerJid}`);

                    if (status === "open" || status === "connected") {
                        console.log("Instance is ALREADY OPEN/CONNECTED!");

                        // SECURITY CHECK: Verify Owner Match
                        const cleanUserPhone = (userPhone || '').replace(/\D/g, '');
                        const cleanOwnerPhone = ownerJid ? ownerJid.replace(/\D/g, '').replace('@s.whatsapp.net', '') : '';

                        // We check if the owner phone ENDS WITH the user phone (to handle country codes somewhat gracefully if user didn't include them, though exact match is better)
                        // Actually, Evolution usually returns full international format "357..."
                        // We should enforce rigorous checking.

                        if (cleanOwnerPhone && !cleanOwnerPhone.includes(cleanUserPhone) && !cleanUserPhone.includes(cleanOwnerPhone)) {
                            console.log(`[Security Mismatch] Connected: ${cleanOwnerPhone}, Expected: ${cleanUserPhone}`);
                            // Disconnect immediately
                            await evolutionClient.logoutInstance(instanceName);
                            return {
                                success: false,
                                error: `Security Mismatch: The connected WhatsApp number (${cleanOwnerPhone}) does not match your profile number (${userPhone}). Please scan with the correct device.`
                            };
                        }

                        await db.location.update({
                            where: { id: location.id },
                            data: { evolutionConnectionStatus: "open" }
                        });
                        return { success: true, message: "Instance is successfully connected" };
                    }
                }

                if (!qrCodeBase64 && attempts < 10) {
                    await new Promise(resolve => setTimeout(resolve, 2000));
                }
            }
        }

        // Save instance ID if not set
        if (!location.evolutionInstanceId) {
            await db.location.update({
                where: { id: location.id },
                data: { evolutionInstanceId: instanceName }
            });
        }

        revalidatePath("/admin/settings/integrations/whatsapp");
        return { success: true, qrCode: qrCodeBase64 };

    } catch (e: any) {
        console.error("Evolution Connect Error:", e);

        // Return user-friendly error for connection issues
        if (evolutionClient.isConnectionError(e)) {
            return {
                success: false,
                error: "WhatsApp service is temporarily unavailable. Please try again later or contact support."
            };
        }

        return { success: false, error: e.message };
    }

}

export async function logoutEvolutionInstance(locationId?: string | null) {
    const { location } = await resolveAdminContext(locationId || null);

    try {
        if (location.evolutionInstanceId) {
            // Best Practice: Fully delete the instance to ensure a fresh start on next connect (Full cleanup)
            await evolutionClient.deleteInstance(location.evolutionInstanceId);

            await db.location.update({
                where: { id: location.id },
                data: {
                    evolutionConnectionStatus: "close"
                } // Reset status
            });
        }
        revalidatePath("/admin/settings/integrations/whatsapp");
        return { success: true };
    } catch (e: any) {
        return { success: false, error: e.message };
    }
}

export async function syncEvolutionChats(locationId?: string | null) {
    const { location } = await resolveAdminContext(locationId || null);

    if (!location.evolutionInstanceId) {
        return { success: false, error: "No WhatsApp instance connected" };
    }

    try {
        console.log("[Chat Sync] Starting chat sync for", location.evolutionInstanceId);

        // Fetch all chats from Evolution
        const chats = await evolutionClient.fetchChats(location.evolutionInstanceId);
        if (!chats.length) {
            return { success: true, message: "No chats found", synced: 0 };
        }

        let contactsCreated = 0;
        let conversationsCreated = 0;

        for (const chat of chats) {
            const remoteJid = chat.id || chat.remoteJid;
            if (!remoteJid || remoteJid.includes("@g.us")) continue; // Skip groups

            const lidJid = remoteJid.endsWith("@lid") ? remoteJid : null;
            const phoneNumber =
                extractPhoneJidCandidate(remoteJid) ||
                extractPhoneJidCandidate(chat.remoteJidAlt) ||
                extractPhoneJidCandidate(chat.participantAlt) ||
                extractPhoneJidCandidate(chat.senderPn) ||
                extractPhoneJidCandidate(chat.previousRemoteJid);

            let contact = null;

            if (lidJid) {
                contact = await db.contact.findFirst({
                    where: {
                        locationId: location.id,
                        lid: { contains: lidJid.replace("@lid", "") },
                    }
                });
            }

            if (!contact && phoneNumber) {
                const phoneSuffix = phoneNumber.slice(-7);
                const candidates = await db.contact.findMany({
                    where: {
                        locationId: location.id,
                        phone: { contains: phoneSuffix }
                    }
                });

                contact = candidates.find((candidate) => {
                    if (!candidate.phone) return false;
                    const candidateDigits = normalizeDigits(candidate.phone);
                    return (
                        candidateDigits === phoneNumber ||
                        (candidateDigits.endsWith(phoneNumber) && phoneNumber.length >= 7) ||
                        (phoneNumber.endsWith(candidateDigits) && candidateDigits.length >= 7)
                    );
                }) || null;
            }

            if (!contact && !phoneNumber) {
                console.warn(`[Chat Sync] Skipping unresolved LID chat ${remoteJid}; no high-confidence phone mapping is available yet.`);
                continue;
            }

            const contactName = chat.name || chat.pushName || `WhatsApp ${phoneNumber || remoteJid}`;

            // Find or create contact
            if (!contact) {
                contact = await db.contact.create({
                    data: {
                        locationId: location.id,
                        phone: phoneNumber ? `+${phoneNumber}` : undefined,
                        name: contactName,
                        status: "New",
                        contactType: "Lead",
                        lid: lidJid || undefined,
                    }
                });
                contactsCreated++;
            } else if ((lidJid && !contact.lid) || (phoneNumber && !contact.phone)) {
                contact = await db.contact.update({
                    where: { id: contact.id },
                    data: {
                        ...(lidJid && !contact.lid ? { lid: lidJid } : {}),
                        ...(phoneNumber && !contact.phone ? { phone: `+${phoneNumber}` } : {}),
                    }
                });
            }

            // Find or create conversation
            let conversation = await db.conversation.findFirst({
                where: { contactId: contact.id, locationId: location.id }
            });

            if (!conversation) {
                conversation = await db.conversation.create({
                    data: {
                        locationId: location.id,
                        contactId: contact.id,
                        status: "open",
                        ghlConversationId: null,
                        lastMessageType: "TYPE_WHATSAPP"
                    }
                });
                conversationsCreated++;
            }
        }

        console.log(`[Chat Sync] Completed. Created ${contactsCreated} contacts, ${conversationsCreated} conversations.`);
        revalidatePath("/admin/conversations");
        return { success: true, contactsCreated, conversationsCreated };
    } catch (e: any) {
        console.error("[Chat Sync] Error:", e);
        return { success: false, error: e.message };
    }
}

/**
 * Fetch messages for a specific conversation from Evolution API (on-demand)
 */
export async function fetchConversationHistory(conversationId: string) {
    const { location } = await resolveAdminContext(null);

    if (!location.evolutionInstanceId) {
        return { success: false, error: "No WhatsApp instance connected" };
    }

    // Get conversation and contact
    const conversation = await db.conversation.findUnique({
        where: { id: conversationId },
        include: { contact: true }
    });

    if (!conversation || !conversation.contact?.phone) {
        return { success: false, error: "Conversation or contact not found" };
    }

    try {
        const phoneNumber = conversation.contact.phone.replace(/\D/g, '');

        const isGroup = conversation.contact.contactType === 'WhatsAppGroup' || conversation.contact.phone.includes('@g.us');
        const remoteJid = isGroup ? `${phoneNumber}@g.us` : `${phoneNumber}@s.whatsapp.net`;

        console.log(`[History Fetch] Fetching messages for ${remoteJid}...`);
        const messages = await evolutionClient.fetchMessages(location.evolutionInstanceId, remoteJid, 100);

        const { processNormalizedMessage } = await import("@/lib/whatsapp/sync");
        let synced = 0;

        for (const msg of messages) {
            try {
                const key = msg.key;
                const messageContent = msg.message;
                if (!messageContent || !key?.id) continue;

                const isFromMe = key.fromMe;

                // Participant Resolution
                const realSenderPhone = (msg as any).senderPn || (key.participant?.includes('@s.whatsapp.net') ? key.participant.replace('@s.whatsapp.net', '') : null);
                let participantPhone = realSenderPhone || (key.participant ? key.participant.replace('@s.whatsapp.net', '').replace('@lid', '') : undefined);
                const parsedContent = parseEvolutionMessageContent(messageContent);
                const senderName = msg.pushName || realSenderPhone || "Unknown";
                const normalizedBody = isGroup && parsedContent.type !== 'text'
                    ? `[${senderName}]: ${parsedContent.body}`
                    : parsedContent.body;

                const normalized: any = {
                    from: isFromMe ? location.id : phoneNumber,
                    to: isFromMe ? phoneNumber : location.id,
                    body: normalizedBody,
                    type: parsedContent.type,
                    wamId: key.id,
                    timestamp: new Date(msg.messageTimestamp ? (msg.messageTimestamp as number) * 1000 : Date.now()),
                    direction: isFromMe ? 'outbound' : 'inbound',
                    source: 'whatsapp_evolution',
                    locationId: location.id,
                    contactName: msg.pushName || realSenderPhone,
                    isGroup: isGroup,
                    participant: participantPhone,
                    participantJid: typeof key.participant === "string" ? key.participant : undefined,
                    participantPhoneJid: typeof (msg as any).senderPn === "string" ? String((msg as any).senderPn) : undefined,
                    participantLidJid: typeof key.participant === "string" && key.participant.endsWith("@lid") ? key.participant : undefined,
                    participantDisplayName: isGroup ? (msg.pushName || realSenderPhone || undefined) : undefined,
                };

                await processNormalizedMessage(normalized);
                synced++;
            } catch (msgErr) {
                console.error("[History Fetch] Error processing message:", msgErr);
            }
        }

        console.log(`[History Fetch] Synced ${synced} messages for conversation ${conversationId}`);
        return { success: true, synced };
    } catch (e: any) {
        console.error("[History Fetch] Error:", e);
        return { success: false, error: e.message };
    }
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
            evolutionInstanceId: location.evolutionInstanceId || null,
            evolutionApiToken: location.evolutionApiToken || null,
            evolutionConnectionStatus: location.evolutionConnectionStatus || null,
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

export async function checkInstanceHealth(locationId?: string | null) {
    const { location } = await resolveAdminContext(locationId || null);
    try {
        if (!location.evolutionInstanceId) return { success: false, error: "No instance ID" };

        const instance = await evolutionClient.fetchInstance(location.evolutionInstanceId);

        // Fetch contacts count & chats count if supported
        // This usually requires separate API calls unless fetchInstance returns counts
        let contactsCount = 0;
        let chatsCount = 0;

        try {
            // Some versions return counts in the instance object
            // @ts-ignore
            if (instance?.instance?._count) {
                // @ts-ignore
                contactsCount = instance.instance._count.Contact || 0;
                // @ts-ignore
                chatsCount = instance.instance._count.Chat || 0;
            } else if (instance?._count) {
                // @ts-ignore
                contactsCount = instance._count.Contact || 0;
                // @ts-ignore
                chatsCount = instance._count.Chat || 0;
            }
        } catch (e) {
            console.warn("Failed to get counts", e);
        }

        // Determine status
        // @ts-ignore
        const status = instance?.instance?.connectionStatus || instance?.connectionStatus || 'disconnected';

        let healthState = 'disconnected';
        if (status === 'open') {
            if (contactsCount === 0 && chatsCount === 0) {
                // "Zombie" state: claims open but has no data (often needs re-scan)
                // BUT: valid new accounts also have 0. We'll warn anyway.
                healthState = 'zombie';
            } else {
                healthState = 'healthy';
            }
        }

        return {
            success: true,
            status: healthState,
            contactsCount,
            chatsCount
        };

    } catch (error: any) {
        console.error("Health check failed:", error);
        return { success: false, error: error.message };
    }
}

export async function resetWebhookUrl() {
    try {
        const { location } = await resolveAdminContext(null);
        if (!location.evolutionInstanceId) return { success: false, error: "No instance ID" };
        const res = await evolutionClient.updateWebhook(location.evolutionInstanceId);

        return { success: true, url: res.url };
    } catch (error: any) {
        console.error("Reset Webhook Failed:", error);
        return { success: false, error: error.message };
    }
}

export async function repairEvolutionConnection(locationId?: string | null) {
    console.log("🛠️ Starting Repair Process...");

    // 1. Logout/Delete
    try {
        await logoutEvolutionInstance(locationId || null);
    } catch (e) {
        console.warn("Logout failed during repair (might be already gone):", e);
    }

    // 2. Connect (Create & Get QR)
    // Add a small delay to ensure cleanup
    await new Promise(resolve => setTimeout(resolve, 1000));

    return await connectEvolutionDevice(locationId || null);
}
