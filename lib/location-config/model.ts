import { GEMINI_FLASH_LATEST_ALIAS, GEMINI_FLASH_LITE_LATEST_ALIAS, GEMINI_FLASH_STABLE_FALLBACK } from "@/lib/ai/models";
import { WEBSITE_LAYOUT_KEYS } from "@/lib/website/settings";

/** Pure parts of the Location configuration row (service.ts): its shape, defaults, assembly and where each key is saved. */
export const AI_CONFIG_KEYS = [
    "googleAiModel", "googleAiModelExtraction", "googleAiModelDesign", "googleAiModelTranscription", "googleAiModelTranslation",
    "outreachConfig", "whatsappTranscriptOnDemandEnabled", "whatsappTranscriptRetentionDays", "whatsappTranscriptVisibility",
    "viewingSessionRetentionDays", "viewingSessionTranscriptVisibility", "viewingSessionAiDisclosureRequired",
    "viewingSessionAiDisclosureVersion", "viewingSessionRawAudioStorageEnabled", "viewingSessionTranslationModel",
    "viewingSessionInsightsModel", "viewingSessionSummaryModel",
] as const;
/** Search defaults for the Estio public site; stored in the website document. */
export const SEARCH_DEFAULT_KEYS = ["minPrice", "maxPrice", "defaultCity", "defaultRegion", "allowedTypes"] as const;
/** Business details: only the Business profile stores them. */
export const BUSINESS_CONFIG_KEYS = ["contactInfo", "socialLinks", "footerBio", "brandVoice", "primaryColor", "secondaryColor", "accentColor"] as const;

type Json = any;
export type LocationConfig = {
    locationId: string;
    domain: string | null;
    substoSiteSlug: string | null;
    substoSitePublished: boolean;
    substoSiteConfig: { title?: string } | null;
    theme: Json; navLinks: Json; footerLinks: Json; socialLinks: Json; legalLinks: Json; footerDisclaimer: string | null; footerBio: string | null;
    heroContent: Json; contactInfo: Json; homeSections: Json; favoritesConfig: Json; searchConfig: Json; submissionsConfig: Json;
    brandVoice: string | null; primaryColor: string | null; secondaryColor: string | null; accentColor: string | null;
    publicListingEnabled: boolean;
    googleAiModel: string; googleAiModelExtraction: string; googleAiModelDesign: string; googleAiModelTranscription: string; googleAiModelTranslation: string;
    outreachConfig: Json;
    whatsappTranscriptOnDemandEnabled: boolean; whatsappTranscriptRetentionDays: number; whatsappTranscriptVisibility: string;
    viewingSessionRetentionDays: number; viewingSessionTranscriptVisibility: string; viewingSessionAiDisclosureRequired: boolean;
    viewingSessionAiDisclosureVersion: string; viewingSessionRawAudioStorageEnabled: boolean;
    viewingSessionTranslationModel: string | null; viewingSessionInsightsModel: string | null; viewingSessionSummaryModel: string | null;
    minPrice: number | null; maxPrice: number | null; defaultCity: string | null; defaultRegion: string | null; allowedTypes: string | null;
};

/** Values a Location gets before anything is saved (the AI settings document's own defaults). */
export const LOCATION_CONFIG_DEFAULTS: Omit<LocationConfig, "locationId"> = {
    domain: null, substoSiteSlug: null, substoSitePublished: false, substoSiteConfig: null,
    theme: null, navLinks: null, footerLinks: null, socialLinks: null, legalLinks: null, footerDisclaimer: null, footerBio: null,
    heroContent: null, contactInfo: null, homeSections: null, favoritesConfig: null, searchConfig: null, submissionsConfig: null,
    brandVoice: null, primaryColor: null, secondaryColor: null, accentColor: null, publicListingEnabled: true,
    googleAiModel: GEMINI_FLASH_LATEST_ALIAS, googleAiModelExtraction: GEMINI_FLASH_LATEST_ALIAS, googleAiModelDesign: GEMINI_FLASH_LATEST_ALIAS,
    googleAiModelTranscription: GEMINI_FLASH_STABLE_FALLBACK, googleAiModelTranslation: GEMINI_FLASH_LITE_LATEST_ALIAS, outreachConfig: null,
    whatsappTranscriptOnDemandEnabled: false, whatsappTranscriptRetentionDays: 90, whatsappTranscriptVisibility: "team",
    viewingSessionRetentionDays: 90, viewingSessionTranscriptVisibility: "team", viewingSessionAiDisclosureRequired: true,
    viewingSessionAiDisclosureVersion: "v1", viewingSessionRawAudioStorageEnabled: false,
    viewingSessionTranslationModel: null, viewingSessionInsightsModel: null, viewingSessionSummaryModel: null,
    minPrice: null, maxPrice: null, defaultCity: null, defaultRegion: null, allowedTypes: null,
};

type Doc = Record<string, unknown> | null;
/** The row before the website layout and Business profile overlays (service.ts applies those). */
export function assembleLocationConfig(input: { locationId: string; location: { domain: string | null; websiteSlug: string | null; websitePublished: boolean } | null; ai: Doc; website: Doc }): LocationConfig {
    const row: LocationConfig = { locationId: input.locationId, ...LOCATION_CONFIG_DEFAULTS };
    const set = (key: keyof LocationConfig, value: unknown) => { if (value !== undefined) (row as Record<string, unknown>)[key] = value; };
    for (const key of AI_CONFIG_KEYS) set(key, input.ai?.[key]);
    for (const key of SEARCH_DEFAULT_KEYS) set(key, input.website?.[key]);
    set("publicListingEnabled", input.website?.publicListingEnabled);
    row.domain = input.location?.domain ?? null;
    row.substoSiteSlug = input.location?.websiteSlug ?? null;
    row.substoSitePublished = input.location?.websitePublished ?? false;
    const title = input.website?.siteTitle;
    row.substoSiteConfig = typeof title === "string" && title ? { title } : null;
    return row;
}

/** Splits a patch by where each key is saved. Unknown and read-only keys are ignored. */
export function routeConfigPatch(patch: Partial<LocationConfig>) {
    const ai: Record<string, unknown> = {}, website: Record<string, unknown> = {}, location: { domain?: string | null; websiteSlug?: string | null; websitePublished?: boolean } = {};
    const business: string[] = [];
    for (const [key, value] of Object.entries(patch)) {
        if (value === undefined) continue;
        if ((AI_CONFIG_KEYS as readonly string[]).includes(key)) ai[key] = value;
        else if ((SEARCH_DEFAULT_KEYS as readonly string[]).includes(key) || (WEBSITE_LAYOUT_KEYS as readonly string[]).includes(key)) website[key] = value;
        else if (key === "substoSiteConfig") website.siteTitle = (value as { title?: string } | null)?.title ?? null;
        else if (key === "domain") location.domain = value as string | null;
        else if (key === "substoSiteSlug") location.websiteSlug = value as string | null;
        else if (key === "substoSitePublished") location.websitePublished = Boolean(value);
        else if ((BUSINESS_CONFIG_KEYS as readonly string[]).includes(key)) business.push(key);
    }
    return { ai, website, location, business };
}
