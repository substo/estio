import crypto from "crypto";
import db from "@/lib/db";
import { settingsService } from "@/lib/settings/service";
import { SETTINGS_DOMAINS, SETTINGS_SECRET_KEYS } from "@/lib/settings/constants";
import { getLegacyCryptr } from "@/lib/security/legacy-cryptr";

export const WHATSAPP_CLOUD_PROVIDER = "whatsapp_cloud";
export const GRAPH_API_VERSION = process.env.META_GRAPH_API_VERSION || "v21.0";
export const GRAPH_API_URL = process.env.META_GRAPH_API_URL || "https://graph.facebook.com";

export type WhatsAppTransport = "cloud_api" | "evolution" | "twilio";
export type WhatsAppProviderMode = "cloud_primary" | "evolution_linked" | "twilio_fallback";
export type WhatsAppOutboundKind = "text" | "image" | "audio" | "document" | "template";

export type WhatsAppTemplateComponent = {
    type: "header" | "body" | "button" | string;
    sub_type?: string;
    index?: string | number;
    parameters?: Array<Record<string, any>>;
};

export type WhatsAppTemplatePayload = {
    name: string;
    language: string;
    category?: string | null;
    components?: WhatsAppTemplateComponent[];
};

export type WhatsAppCloudCredentials = {
    locationId: string;
    businessAccountId: string;
    phoneNumberId: string;
    accessToken: string;
    webhookSecret: string;
    providerMode: WhatsAppProviderMode;
};

type GraphError = Error & {
    response?: { status?: number };
    status?: number;
    code?: string | number;
    whatsappCloudError?: any;
};

function graphUrl(path: string) {
    const cleanPath = String(path || "").replace(/^\/+/, "");
    return `${GRAPH_API_URL}/${GRAPH_API_VERSION}/${cleanPath}`;
}

function normalizeProviderMode(value: unknown): WhatsAppProviderMode {
    if (value === "evolution_linked" || value === "twilio_fallback" || value === "cloud_primary") return value;
    return "cloud_primary";
}

function decryptLegacyToken(value: string | null | undefined): string {
    const raw = String(value || "").trim();
    if (!raw) return "";
    try {
        return getLegacyCryptr().decrypt(raw);
    } catch {
        return raw;
    }
}

export function normalizeWhatsAppRecipient(to: string | null | undefined) {
    return String(to || "").replace(/\D/g, "");
}

export async function getWhatsAppCloudCredentials(locationId: string): Promise<WhatsAppCloudCredentials> {
    const [location, integrationDoc, accessTokenSecret] = await Promise.all([
        db.location.findUnique({
            where: { id: locationId },
            select: {
                id: true,
                whatsappBusinessAccountId: true,
                whatsappPhoneNumberId: true,
                whatsappAccessToken: true,
                whatsappWebhookSecret: true,
                whatsappProviderMode: true,
            } as any,
        }),
        settingsService.getDocument<any>({
            scopeType: "LOCATION",
            scopeId: locationId,
            domain: SETTINGS_DOMAINS.LOCATION_INTEGRATIONS,
        }).catch(() => null),
        settingsService.getSecret({
            scopeType: "LOCATION",
            scopeId: locationId,
            domain: SETTINGS_DOMAINS.LOCATION_INTEGRATIONS,
            secretKey: SETTINGS_SECRET_KEYS.WHATSAPP_ACCESS_TOKEN,
        }).catch(() => null),
    ]);

    const payload = integrationDoc?.payload || {};
    const businessAccountId = String(payload.whatsappBusinessAccountId || location?.whatsappBusinessAccountId || "").trim();
    const phoneNumberId = String(payload.whatsappPhoneNumberId || location?.whatsappPhoneNumberId || "").trim();
    const webhookSecret = String(payload.whatsappWebhookSecret || location?.whatsappWebhookSecret || "").trim();
    const providerMode = normalizeProviderMode(payload.whatsappProviderMode || (location as any)?.whatsappProviderMode);
    const accessToken = String(accessTokenSecret || decryptLegacyToken(location?.whatsappAccessToken) || "").trim();

    if (!phoneNumberId || !accessToken) {
        throw new Error("WhatsApp Cloud API credentials not found for this location.");
    }

    return {
        locationId,
        businessAccountId,
        phoneNumberId,
        accessToken,
        webhookSecret,
        providerMode,
    };
}

async function graphRequest<T = any>(
    path: string,
    accessToken: string,
    init: RequestInit = {}
): Promise<T> {
    const response = await fetch(graphUrl(path), {
        ...init,
        headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
            ...(init.headers || {}),
        },
    });
    const text = await response.text();
    let json: any = null;
    if (text) {
        try {
            json = JSON.parse(text);
        } catch {
            json = { raw: text };
        }
    }

    if (!response.ok) {
        const graphError = json?.error || json || {};
        const err = new Error(`WhatsApp Cloud API Error: ${graphError?.message || response.statusText || "Unknown error"}`) as GraphError;
        err.response = { status: response.status };
        err.status = response.status;
        err.code = graphError?.code || graphError?.error_subcode;
        err.whatsappCloudError = graphError;
        throw err;
    }

    return json as T;
}

export function buildCloudTextPayload(to: string, body: string) {
    const recipient = normalizeWhatsAppRecipient(to);
    return {
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: recipient,
        type: "text",
        text: {
            preview_url: false,
            body: String(body || ""),
        },
    };
}

export function buildCloudMediaPayload(
    to: string,
    input: {
        mediaType: "image" | "audio" | "document";
        mediaUrl: string;
        caption?: string | null;
        mimetype?: string | null;
        fileName?: string | null;
    }
) {
    const mediaType = input.mediaType === "audio" ? "audio" : input.mediaType === "document" ? "document" : "image";
    const media: Record<string, any> = {
        link: input.mediaUrl,
    };
    if (mediaType !== "audio" && input.caption) media.caption = input.caption;
    if (mediaType === "document" && input.fileName) media.filename = input.fileName;

    return {
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: normalizeWhatsAppRecipient(to),
        type: mediaType,
        [mediaType]: media,
    };
}

export function buildCloudTemplatePayload(to: string, template: WhatsAppTemplatePayload) {
    const name = String(template.name || "").trim();
    const language = String(template.language || "en_US").trim();
    if (!name) throw new Error("Template name is required.");
    if (!language) throw new Error("Template language is required.");

    return {
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: normalizeWhatsAppRecipient(to),
        type: "template",
        template: {
            name,
            language: { code: language },
            ...(Array.isArray(template.components) && template.components.length
                ? { components: template.components }
                : {}),
        },
    };
}

async function sendCloudPayload(locationId: string, payload: Record<string, any>) {
    const credentials = await getWhatsAppCloudCredentials(locationId);
    return graphRequest<any>(`${credentials.phoneNumberId}/messages`, credentials.accessToken, {
        method: "POST",
        body: JSON.stringify(payload),
    });
}

export async function sendWhatsAppCloudText(locationId: string, to: string, body: string) {
    return sendCloudPayload(locationId, buildCloudTextPayload(to, body));
}

export async function sendWhatsAppCloudMedia(
    locationId: string,
    to: string,
    input: Parameters<typeof buildCloudMediaPayload>[1]
) {
    return sendCloudPayload(locationId, buildCloudMediaPayload(to, input));
}

export async function sendWhatsAppCloudTemplate(locationId: string, to: string, template: WhatsAppTemplatePayload) {
    return sendCloudPayload(locationId, buildCloudTemplatePayload(to, template));
}

export async function sendWhatsAppMessage(
    locationId: string,
    to: string,
    message: ({ type: "text"; body: string } | ({ type: "template" } & WhatsAppTemplatePayload))
) {
    if (message.type === "template") {
        return sendWhatsAppCloudTemplate(locationId, to, message);
    }
    return sendWhatsAppCloudText(locationId, to, message.body);
}

export function extractCloudWamId(response: any): string | null {
    return response?.messages?.[0]?.id ? String(response.messages[0].id) : null;
}

export async function markWhatsAppCloudMessageRead(locationId: string, messageId: string) {
    const credentials = await getWhatsAppCloudCredentials(locationId);
    return graphRequest<any>(`${credentials.phoneNumberId}/messages`, credentials.accessToken, {
        method: "POST",
        body: JSON.stringify({
            messaging_product: "whatsapp",
            status: "read",
            message_id: messageId,
        }),
    });
}

export async function fetchWhatsAppCloudTemplates(locationId: string) {
    const credentials = await getWhatsAppCloudCredentials(locationId);
    if (!credentials.businessAccountId) throw new Error("WhatsApp Business Account ID is not configured.");
    const response = await graphRequest<any>(
        `${credentials.businessAccountId}/message_templates?limit=200`,
        credentials.accessToken,
        { method: "GET", headers: { "Content-Type": "application/json" } }
    );
    return Array.isArray(response?.data) ? response.data : [];
}

export async function createWhatsAppCloudTemplate(locationId: string, input: {
    name: string;
    language: string;
    category: string;
    components: any[];
    parameterFormat?: string | null;
}) {
    const credentials = await getWhatsAppCloudCredentials(locationId);
    if (!credentials.businessAccountId) throw new Error("WhatsApp Business Account ID is not configured.");
    const body = {
        name: input.name,
        language: input.language,
        category: input.category,
        components: input.components,
        ...(input.parameterFormat ? { parameter_format: input.parameterFormat } : {}),
    };
    return graphRequest<any>(`${credentials.businessAccountId}/message_templates`, credentials.accessToken, {
        method: "POST",
        body: JSON.stringify(body),
    });
}

export async function subscribeWhatsAppAppToWaba(locationId: string) {
    const credentials = await getWhatsAppCloudCredentials(locationId);
    if (!credentials.businessAccountId) throw new Error("WhatsApp Business Account ID is not configured.");
    return graphRequest<any>(`${credentials.businessAccountId}/subscribed_apps`, credentials.accessToken, {
        method: "POST",
        body: JSON.stringify({ subscribed_fields: ["messages"] }),
    });
}

export async function getWhatsAppCloudHealth(locationId: string) {
    const checks: Record<string, { ok: boolean; message?: string; data?: any }> = {
        token: { ok: false },
        waba: { ok: false },
        phoneNumber: { ok: false },
        templates: { ok: false },
        messagesPermission: { ok: false },
        webhookSubscribed: { ok: false },
    };

    try {
        const credentials = await getWhatsAppCloudCredentials(locationId);
        checks.token = { ok: true };
        checks.messagesPermission = { ok: true, message: "Send endpoint credentials are present." };

        if (credentials.businessAccountId) {
            try {
                const waba = await graphRequest<any>(
                    `${credentials.businessAccountId}?fields=id,name,message_template_namespace`,
                    credentials.accessToken,
                    { method: "GET", headers: { "Content-Type": "application/json" } }
                );
                checks.waba = { ok: true, data: waba };
            } catch (error: any) {
                checks.waba = { ok: false, message: error?.message || "WABA lookup failed." };
            }

            try {
                const templates = await graphRequest<any>(
                    `${credentials.businessAccountId}/message_templates?limit=1`,
                    credentials.accessToken,
                    { method: "GET", headers: { "Content-Type": "application/json" } }
                );
                checks.templates = { ok: true, data: { countVisible: Number(templates?.data?.length || 0) } };
            } catch (error: any) {
                checks.templates = { ok: false, message: error?.message || "Template read failed." };
            }

            try {
                const subscribed = await graphRequest<any>(
                    `${credentials.businessAccountId}/subscribed_apps`,
                    credentials.accessToken,
                    { method: "GET", headers: { "Content-Type": "application/json" } }
                );
                checks.webhookSubscribed = {
                    ok: Array.isArray(subscribed?.data) && subscribed.data.length > 0,
                    data: subscribed,
                    message: Array.isArray(subscribed?.data) && subscribed.data.length > 0 ? undefined : "No subscribed app returned by Meta.",
                };
            } catch (error: any) {
                checks.webhookSubscribed = { ok: false, message: error?.message || "Webhook subscription check failed." };
            }
        } else {
            checks.waba = { ok: false, message: "WABA ID is not configured." };
            checks.templates = { ok: false, message: "WABA ID is required to read templates." };
            checks.webhookSubscribed = { ok: false, message: "WABA ID is required to verify subscription." };
        }

        try {
            const phone = await graphRequest<any>(
                `${credentials.phoneNumberId}?fields=id,display_phone_number,verified_name,quality_rating,platform_type,throughput`,
                credentials.accessToken,
                { method: "GET", headers: { "Content-Type": "application/json" } }
            );
            checks.phoneNumber = { ok: true, data: phone };
        } catch (error: any) {
            checks.phoneNumber = { ok: false, message: error?.message || "Phone number lookup failed." };
        }

        return {
            ok: Object.values(checks).every((check) => check.ok),
            locationId,
            providerMode: credentials.providerMode,
            phoneNumberId: credentials.phoneNumberId,
            businessAccountId: credentials.businessAccountId,
            checks,
        };
    } catch (error: any) {
        checks.token = { ok: false, message: error?.message || "Cloud API credentials are missing." };
        return {
            ok: false,
            locationId,
            providerMode: "cloud_primary" as WhatsAppProviderMode,
            phoneNumberId: "",
            businessAccountId: "",
            checks,
        };
    }
}

export function verifyWhatsAppWebhookSignature(rawBody: string, signatureHeader: string | null, appSecret = process.env.META_APP_SECRET || "") {
    if (!appSecret) return true;
    const signature = String(signatureHeader || "").trim();
    if (!signature.startsWith("sha256=")) return false;
    const expected = `sha256=${crypto.createHmac("sha256", appSecret).update(rawBody).digest("hex")}`;
    const signatureBuffer = Buffer.from(signature);
    const expectedBuffer = Buffer.from(expected);
    return signatureBuffer.length === expectedBuffer.length && crypto.timingSafeEqual(signatureBuffer, expectedBuffer);
}

export function mapWhatsAppCloudStatus(status: string | null | undefined) {
    const normalized = String(status || "").toLowerCase();
    if (normalized === "read") return "read";
    if (normalized === "delivered") return "delivered";
    if (normalized === "failed") return "failed";
    if (normalized === "sent") return "sent";
    return "sent";
}
