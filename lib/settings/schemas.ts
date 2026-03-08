import { z } from "zod";
import { SETTINGS_DOMAINS, type SettingsDomain } from "./constants";

const nullableTrimmedString = z.string().trim().nullish().transform((v) => v ?? null);
const hexColor = z.string().regex(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/, "Expected hex color");
const optionalHexColor = hexColor.optional().nullable();

const navLinkSchema: z.ZodType<any> = z.lazy(() => z.object({
    id: z.string().optional(),
    label: z.string().trim().min(1),
    href: z.string().trim().min(1),
    type: z.enum(["page", "custom", "category"]).optional(),
    children: z.array(navLinkSchema).optional(),
}).passthrough());

const logoSchema = z.object({
    url: nullableTrimmedString,
    lightUrl: nullableTrimmedString,
    iconUrl: nullableTrimmedString,
    faviconUrl: nullableTrimmedString,
    textTop: nullableTrimmedString,
    textBottom: nullableTrimmedString,
}).passthrough();

const themeSchema = z.object({
    primaryColor: optionalHexColor,
    secondaryColor: optionalHexColor,
    accentColor: optionalHexColor,
    backgroundColor: optionalHexColor,
    textColor: optionalHexColor,
    headerStyle: z.enum(["transparent", "solid"]).default("transparent"),
    menuStyle: z.enum(["side", "top"]).default("side"),
    logo: logoSchema.default({}),
}).passthrough();

const contactInfoSchema = z.object({
    address: nullableTrimmedString,
    mapsLink: nullableTrimmedString,
    mapsLinkTitle: nullableTrimmedString,
    mobile: nullableTrimmedString,
    landline: nullableTrimmedString,
    email: nullableTrimmedString,
}).passthrough();

const publicSiteSchema = z.object({
    domain: nullableTrimmedString,
    locationName: nullableTrimmedString,
    locationTimeZone: nullableTrimmedString,
    theme: themeSchema,
    contactInfo: contactInfoSchema.default({}),
    navLinks: z.array(navLinkSchema).default([]),
    footerLinks: z.array(navLinkSchema).default([]),
    socialLinks: z.array(z.object({
        platform: z.string().trim().min(1),
        url: z.string().trim().min(1),
    }).passthrough()).default([]),
    legalLinks: z.array(navLinkSchema).default([]),
    footerDisclaimer: nullableTrimmedString,
    footerBio: nullableTrimmedString,
    publicListingEnabled: z.boolean().optional(),
}).passthrough();

const aiSchema = z.object({
    googleAiModel: z.string().trim().min(1),
    googleAiModelExtraction: z.string().trim().min(1),
    googleAiModelDesign: z.string().trim().min(1),
    googleAiModelTranscription: z.string().trim().min(1),
    brandVoice: nullableTrimmedString,
    outreachConfig: z.object({
        enabled: z.boolean().default(false),
        visionIdPrompt: nullableTrimmedString,
        icebreakerPrompt: nullableTrimmedString,
        qualifierPrompt: nullableTrimmedString,
    }).passthrough(),
    whatsappTranscriptOnDemandEnabled: z.boolean().default(false),
    whatsappTranscriptRetentionDays: z.union([z.literal(30), z.literal(90), z.literal(365)]),
    whatsappTranscriptVisibility: z.union([z.literal("team"), z.literal("admin_only")]).default("team"),
}).passthrough();

const navigationSchema = z.object({
    navLinks: z.array(navLinkSchema).default([]),
    footerLinks: z.array(navLinkSchema).default([]),
    socialLinks: z.array(z.object({
        platform: z.string().trim().min(1),
        url: z.string().trim().min(1),
    }).passthrough()).default([]),
    legalLinks: z.array(navLinkSchema).default([]),
    footerDisclaimer: nullableTrimmedString,
    footerBio: nullableTrimmedString,
    menuStyle: z.enum(["side", "top"]).default("side"),
    publicListingEnabled: z.boolean().default(true),
}).passthrough();

const contentSchema = z.object({
    heroContent: z.unknown().optional(),
    homeSections: z.array(z.unknown()).default([]),
    favoritesConfig: z.unknown().optional(),
    searchConfig: z.unknown().optional(),
    submissionsConfig: z.unknown().optional(),
}).passthrough();

const locationIntegrationsSchema = z.object({
    whatsappBusinessAccountId: nullableTrimmedString,
    whatsappPhoneNumberId: nullableTrimmedString,
    whatsappWebhookSecret: nullableTrimmedString,
    twilioAccountSid: nullableTrimmedString,
    twilioWhatsAppFrom: nullableTrimmedString,
    evolutionInstanceId: nullableTrimmedString,
    evolutionApiToken: nullableTrimmedString,
    evolutionConnectionStatus: nullableTrimmedString,
}).passthrough();

const locationCrmSchema = z.object({
    crmUrl: nullableTrimmedString,
    crmEditUrlPattern: nullableTrimmedString,
    crmLeadUrlPattern: nullableTrimmedString,
    crmSchema: z.unknown().nullable().optional(),
    crmLeadSchema: z.unknown().nullable().optional(),
    legacyCrmLeadEmailEnabled: z.boolean().default(false),
    legacyCrmLeadEmailSenders: z.array(z.string()).default([]),
    legacyCrmLeadEmailSenderDomains: z.array(z.string()).default([]),
    legacyCrmLeadEmailSubjectPatterns: z.array(z.string()).default([]),
    legacyCrmLeadEmailPinConversation: z.boolean().default(true),
    legacyCrmLeadEmailAutoProcess: z.boolean().default(false),
    legacyCrmLeadEmailAutoDraftFirstContact: z.boolean().default(false),
}).passthrough();

const userCrmSchema = z.object({
    crmUsername: nullableTrimmedString,
}).passthrough();

const userGoogleSchema = z.object({
    googleSyncEnabled: z.boolean().default(false),
    googleSyncDirection: nullableTrimmedString,
    googleAutoSyncEnabled: z.boolean().default(false),
    googleAutoSyncLeadCapture: z.boolean().default(false),
    googleAutoSyncContactForm: z.boolean().default(false),
    googleAutoSyncWhatsAppInbound: z.boolean().default(false),
    googleAutoSyncMode: z.enum(["LINK_ONLY", "LINK_OR_CREATE"]).default("LINK_ONLY"),
    googleAutoSyncPushUpdates: z.boolean().default(false),
    googleTasklistId: nullableTrimmedString,
    googleTasklistTitle: nullableTrimmedString,
    googleCalendarId: nullableTrimmedString,
    googleCalendarTitle: nullableTrimmedString,
}).passthrough();

const userMicrosoftSchema = z.object({
    outlookSyncEnabled: z.boolean().default(false),
    outlookSubscriptionId: nullableTrimmedString,
    outlookSubscriptionExpiry: z.string().datetime().nullable().optional(),
    outlookAuthMethod: nullableTrimmedString,
    outlookEmail: nullableTrimmedString,
    outlookSessionExpiry: z.string().datetime().nullable().optional(),
}).passthrough();

export const SETTINGS_DOMAIN_SCHEMAS: Record<SettingsDomain, z.ZodTypeAny> = {
    [SETTINGS_DOMAINS.LOCATION_PUBLIC_SITE]: publicSiteSchema,
    [SETTINGS_DOMAINS.LOCATION_AI]: aiSchema,
    [SETTINGS_DOMAINS.LOCATION_NAVIGATION]: navigationSchema,
    [SETTINGS_DOMAINS.LOCATION_CONTENT]: contentSchema,
    [SETTINGS_DOMAINS.LOCATION_INTEGRATIONS]: locationIntegrationsSchema,
    [SETTINGS_DOMAINS.LOCATION_CRM]: locationCrmSchema,
    [SETTINGS_DOMAINS.USER_CRM]: userCrmSchema,
    [SETTINGS_DOMAINS.USER_GOOGLE_INTEGRATIONS]: userGoogleSchema,
    [SETTINGS_DOMAINS.USER_MICROSOFT_INTEGRATIONS]: userMicrosoftSchema,
};

export function validateSettingsPayload<T>(domain: SettingsDomain, payload: T): T {
    const schema = SETTINGS_DOMAIN_SCHEMAS[domain];
    if (!schema) {
        throw new Error(`No settings schema registered for domain: ${domain}`);
    }
    return schema.parse(payload);
}
