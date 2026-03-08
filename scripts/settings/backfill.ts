import { isDeepStrictEqual } from "node:util";
import db from "@/lib/db";
import { settingsService } from "@/lib/settings/service";
import { SETTINGS_DOMAINS, SETTINGS_SECRET_KEYS } from "@/lib/settings/constants";
import type { SettingsScopeType } from "@prisma/client";
import { getLegacyCryptr } from "@/lib/security/legacy-cryptr";
import { decryptCookies, decryptPassword } from "@/lib/crypto/password-encryption";

type ScopeType = SettingsScopeType;

type Stats = {
    docsUpserted: number;
    docsSkippedUnchanged: number;
    docsPlanned: number;
    docsParityMatched: number;
    docsParityMismatched: number;
    secretsSet: number;
    secretsSkippedExisting: number;
    secretsSkippedEmpty: number;
    secretsPlanned: number;
    failures: number;
};

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const overwriteSecrets = args.includes("--overwrite-secrets");
const continueOnError = args.includes("--continue-on-error");
const skipParity = args.includes("--skip-parity");

function getArgValue(flag: string): string | null {
    const match = args.find((arg) => arg.startsWith(`${flag}=`));
    return match ? match.slice(flag.length + 1) : null;
}

const locationIdFilter = getArgValue("--location-id");
const userIdFilter = getArgValue("--user-id");

const stats: Stats = {
    docsUpserted: 0,
    docsSkippedUnchanged: 0,
    docsPlanned: 0,
    docsParityMatched: 0,
    docsParityMismatched: 0,
    secretsSet: 0,
    secretsSkippedExisting: 0,
    secretsSkippedEmpty: 0,
    secretsPlanned: 0,
    failures: 0,
};

let legacyCryptr: ReturnType<typeof getLegacyCryptr> | null = null;

function toRecord(value: unknown): Record<string, any> {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        return {};
    }
    return value as Record<string, any>;
}

function toArray<T>(value: unknown): T[] {
    if (!Array.isArray(value)) return [];
    return value as T[];
}

function normalizeSocialLinks(value: unknown): Array<{ platform: string; url: string }> {
    return toArray<any>(value)
        .map((item) => ({
            platform: String(item?.platform || "").trim(),
            url: String(item?.url || "").trim(),
        }))
        .filter((item) => item.platform.length > 0 && item.url.length > 0);
}

function normalizeRetentionDays(value: number | null | undefined): 30 | 90 | 365 {
    if (value === 30 || value === 90 || value === 365) return value;
    return 90;
}

function normalizeVisibility(value: string | null | undefined): "team" | "admin_only" {
    return value === "admin_only" ? "admin_only" : "team";
}

function getLegacyDecryptor() {
    if (!legacyCryptr) {
        legacyCryptr = getLegacyCryptr();
    }
    return legacyCryptr;
}

function decryptLegacyCryptrValue(raw: string | null | undefined, label: string): string | null {
    if (!raw) return null;
    try {
        return getLegacyDecryptor().decrypt(raw);
    } catch (error: any) {
        throw new Error(`Failed to decrypt legacy ${label}: ${error?.message || String(error)}`);
    }
}

function decryptOutlookPassword(raw: string | null | undefined): string | null {
    if (!raw) return null;
    try {
        return decryptPassword(raw);
    } catch (error: any) {
        throw new Error(`Failed to decrypt outlookPasswordEncrypted: ${error?.message || String(error)}`);
    }
}

function decryptOutlookCookies(raw: string | null | undefined): string | null {
    if (!raw) return null;
    try {
        const cookies = decryptCookies(raw);
        return JSON.stringify(cookies);
    } catch (error: any) {
        throw new Error(`Failed to decrypt outlookSessionCookies: ${error?.message || String(error)}`);
    }
}

async function upsertDocumentIfChanged(input: {
    scopeType: ScopeType;
    scopeId: string;
    domain: string;
    payload: Record<string, any>;
}) {
    const existing = await db.settingsDocument.findUnique({
        where: {
            scopeType_scopeId_domain: {
                scopeType: input.scopeType,
                scopeId: input.scopeId,
                domain: input.domain,
            },
        },
        select: { payload: true, version: true },
    });

    if (existing && isDeepStrictEqual(existing.payload, input.payload)) {
        stats.docsSkippedUnchanged += 1;
        return;
    }

    if (dryRun) {
        stats.docsPlanned += 1;
        return;
    }

    await settingsService.upsertDocument({
        scopeType: input.scopeType,
        scopeId: input.scopeId,
        domain: input.domain as any,
        payload: input.payload,
        expectedVersion: existing?.version ?? undefined,
        actorUserId: null,
        schemaVersion: 1,
    });
    stats.docsUpserted += 1;

    if (!skipParity) {
        const parity = await settingsService.checkDocumentParity({
            scopeType: input.scopeType,
            scopeId: input.scopeId,
            domain: input.domain as any,
            legacyPayload: input.payload,
            actorUserId: null,
        });
        if (parity.matched) {
            stats.docsParityMatched += 1;
        } else {
            stats.docsParityMismatched += 1;
        }
    }
}

async function setSecretIfNeeded(input: {
    scopeType: ScopeType;
    scopeId: string;
    domain: string;
    secretKey: string;
    plaintext: string | null;
}) {
    if (!input.plaintext) {
        stats.secretsSkippedEmpty += 1;
        return;
    }

    const existing = await db.settingsSecret.findUnique({
        where: {
            scopeType_scopeId_domain_secretKey: {
                scopeType: input.scopeType,
                scopeId: input.scopeId,
                domain: input.domain,
                secretKey: input.secretKey,
            },
        },
        select: { id: true },
    });

    if (existing && !overwriteSecrets) {
        stats.secretsSkippedExisting += 1;
        return;
    }

    if (dryRun) {
        stats.secretsPlanned += 1;
        return;
    }

    await settingsService.setSecret({
        scopeType: input.scopeType,
        scopeId: input.scopeId,
        domain: input.domain as any,
        secretKey: input.secretKey,
        plaintext: input.plaintext,
        actorUserId: null,
    });
    stats.secretsSet += 1;
}

async function backfillLocation(location: any) {
    const siteConfig = location.siteConfig;
    const siteTheme = toRecord(siteConfig?.theme);
    const siteThemeLogo = toRecord(siteTheme.logo);
    const siteContactInfo = toRecord(siteConfig?.contactInfo);

    const publicSitePayload = {
        domain: siteConfig?.domain ?? location.domain ?? null,
        locationName: location.name ?? null,
        locationTimeZone: location.timeZone ?? null,
        theme: {
            primaryColor: siteTheme.primaryColor ?? siteConfig?.primaryColor ?? null,
            secondaryColor: siteTheme.secondaryColor ?? siteConfig?.secondaryColor ?? null,
            accentColor: siteTheme.accentColor ?? siteConfig?.accentColor ?? null,
            backgroundColor: siteTheme.backgroundColor ?? null,
            textColor: siteTheme.textColor ?? null,
            headerStyle: siteTheme.headerStyle === "solid" ? "solid" : "transparent",
            menuStyle: siteTheme.menuStyle === "top" ? "top" : "side",
            logo: {
                url: siteThemeLogo.url ?? null,
                lightUrl: siteThemeLogo.lightUrl ?? null,
                iconUrl: siteThemeLogo.iconUrl ?? null,
                faviconUrl: siteThemeLogo.faviconUrl ?? null,
                textTop: siteThemeLogo.textTop ?? null,
                textBottom: siteThemeLogo.textBottom ?? null,
            },
        },
        contactInfo: {
            address: siteContactInfo.address ?? null,
            mapsLink: siteContactInfo.mapsLink ?? null,
            mapsLinkTitle: siteContactInfo.mapsLinkTitle ?? null,
            mobile: siteContactInfo.mobile ?? siteContactInfo.phone ?? null,
            landline: siteContactInfo.landline ?? null,
            email: siteContactInfo.email ?? null,
        },
        navLinks: toArray<any>(siteConfig?.navLinks),
        footerLinks: toArray<any>(siteConfig?.footerLinks),
        socialLinks: normalizeSocialLinks(siteConfig?.socialLinks),
        legalLinks: toArray<any>(siteConfig?.legalLinks),
        footerDisclaimer: siteConfig?.footerDisclaimer ?? null,
        footerBio: siteConfig?.footerBio ?? null,
        publicListingEnabled: siteConfig?.publicListingEnabled ?? true,
    };

    await upsertDocumentIfChanged({
        scopeType: "LOCATION",
        scopeId: location.id,
        domain: SETTINGS_DOMAINS.LOCATION_PUBLIC_SITE,
        payload: publicSitePayload,
    });

    const outreach = toRecord(siteConfig?.outreachConfig);
    const aiPayload = {
        googleAiModel: siteConfig?.googleAiModel ?? "gemini-1.5-pro",
        googleAiModelExtraction: siteConfig?.googleAiModelExtraction ?? "gemini-1.5-flash",
        googleAiModelDesign: siteConfig?.googleAiModelDesign ?? "gemini-1.5-pro",
        googleAiModelTranscription: siteConfig?.googleAiModelTranscription ?? "gemini-2.5-flash",
        brandVoice: siteConfig?.brandVoice ?? null,
        outreachConfig: {
            enabled: Boolean(outreach.enabled),
            visionIdPrompt: outreach.visionIdPrompt ?? null,
            icebreakerPrompt: outreach.icebreakerPrompt ?? null,
            qualifierPrompt: outreach.qualifierPrompt ?? null,
        },
        whatsappTranscriptOnDemandEnabled: siteConfig?.whatsappTranscriptOnDemandEnabled ?? false,
        whatsappTranscriptRetentionDays: normalizeRetentionDays(siteConfig?.whatsappTranscriptRetentionDays),
        whatsappTranscriptVisibility: normalizeVisibility(siteConfig?.whatsappTranscriptVisibility),
    };

    await upsertDocumentIfChanged({
        scopeType: "LOCATION",
        scopeId: location.id,
        domain: SETTINGS_DOMAINS.LOCATION_AI,
        payload: aiPayload,
    });

    const navigationPayload = {
        navLinks: toArray<any>(siteConfig?.navLinks),
        footerLinks: toArray<any>(siteConfig?.footerLinks),
        socialLinks: normalizeSocialLinks(siteConfig?.socialLinks),
        legalLinks: toArray<any>(siteConfig?.legalLinks),
        footerDisclaimer: siteConfig?.footerDisclaimer ?? null,
        footerBio: siteConfig?.footerBio ?? null,
        menuStyle: siteTheme.menuStyle === "top" ? "top" : "side",
        publicListingEnabled: siteConfig?.publicListingEnabled ?? true,
    };

    await upsertDocumentIfChanged({
        scopeType: "LOCATION",
        scopeId: location.id,
        domain: SETTINGS_DOMAINS.LOCATION_NAVIGATION,
        payload: navigationPayload,
    });

    const contentPayload = {
        heroContent: siteConfig?.heroContent ?? null,
        homeSections: toArray<any>(siteConfig?.homeSections),
        favoritesConfig: siteConfig?.favoritesConfig ?? null,
        searchConfig: siteConfig?.searchConfig ?? null,
        submissionsConfig: siteConfig?.submissionsConfig ?? null,
    };

    await upsertDocumentIfChanged({
        scopeType: "LOCATION",
        scopeId: location.id,
        domain: SETTINGS_DOMAINS.LOCATION_CONTENT,
        payload: contentPayload,
    });

    const integrationsPayload = {
        whatsappBusinessAccountId: location.whatsappBusinessAccountId ?? null,
        whatsappPhoneNumberId: location.whatsappPhoneNumberId ?? null,
        whatsappWebhookSecret: location.whatsappWebhookSecret ?? null,
        twilioAccountSid: location.twilioAccountSid ?? null,
        twilioWhatsAppFrom: location.twilioWhatsAppFrom ?? null,
        evolutionInstanceId: location.evolutionInstanceId ?? null,
        evolutionApiToken: location.evolutionApiToken ?? null,
        evolutionConnectionStatus: location.evolutionConnectionStatus ?? null,
    };

    await upsertDocumentIfChanged({
        scopeType: "LOCATION",
        scopeId: location.id,
        domain: SETTINGS_DOMAINS.LOCATION_INTEGRATIONS,
        payload: integrationsPayload,
    });

    const crmPayload = {
        crmUrl: location.crmUrl ?? null,
        crmEditUrlPattern: location.crmEditUrlPattern ?? null,
        crmLeadUrlPattern: location.crmLeadUrlPattern ?? null,
        crmSchema: location.crmSchema ?? null,
        crmLeadSchema: location.crmLeadSchema ?? null,
        legacyCrmLeadEmailEnabled: location.legacyCrmLeadEmailEnabled ?? false,
        legacyCrmLeadEmailSenders: location.legacyCrmLeadEmailSenders ?? [],
        legacyCrmLeadEmailSenderDomains: location.legacyCrmLeadEmailSenderDomains ?? [],
        legacyCrmLeadEmailSubjectPatterns: location.legacyCrmLeadEmailSubjectPatterns ?? [],
        legacyCrmLeadEmailPinConversation: location.legacyCrmLeadEmailPinConversation ?? true,
        legacyCrmLeadEmailAutoProcess: location.legacyCrmLeadEmailAutoProcess ?? false,
        legacyCrmLeadEmailAutoDraftFirstContact: location.legacyCrmLeadEmailAutoDraftFirstContact ?? false,
    };

    await upsertDocumentIfChanged({
        scopeType: "LOCATION",
        scopeId: location.id,
        domain: SETTINGS_DOMAINS.LOCATION_CRM,
        payload: crmPayload,
    });

    await setSecretIfNeeded({
        scopeType: "LOCATION",
        scopeId: location.id,
        domain: SETTINGS_DOMAINS.LOCATION_AI,
        secretKey: SETTINGS_SECRET_KEYS.GOOGLE_AI_API_KEY,
        plaintext: siteConfig?.googleAiApiKey ?? null,
    });

    await setSecretIfNeeded({
        scopeType: "LOCATION",
        scopeId: location.id,
        domain: SETTINGS_DOMAINS.LOCATION_INTEGRATIONS,
        secretKey: SETTINGS_SECRET_KEYS.WHATSAPP_ACCESS_TOKEN,
        plaintext: decryptLegacyCryptrValue(location.whatsappAccessToken, "whatsappAccessToken"),
    });

    await setSecretIfNeeded({
        scopeType: "LOCATION",
        scopeId: location.id,
        domain: SETTINGS_DOMAINS.LOCATION_INTEGRATIONS,
        secretKey: SETTINGS_SECRET_KEYS.TWILIO_AUTH_TOKEN,
        plaintext: decryptLegacyCryptrValue(location.twilioAuthToken, "twilioAuthToken"),
    });
}

async function backfillUser(user: any) {
    const userCrmPayload = {
        crmUsername: user.crmUsername ?? null,
    };
    await upsertDocumentIfChanged({
        scopeType: "USER",
        scopeId: user.id,
        domain: SETTINGS_DOMAINS.USER_CRM,
        payload: userCrmPayload,
    });

    const userGooglePayload = {
        googleSyncEnabled: user.googleSyncEnabled ?? false,
        googleSyncDirection: user.googleSyncDirection ?? null,
        googleAutoSyncEnabled: user.googleAutoSyncEnabled ?? false,
        googleAutoSyncLeadCapture: user.googleAutoSyncLeadCapture ?? false,
        googleAutoSyncContactForm: user.googleAutoSyncContactForm ?? false,
        googleAutoSyncWhatsAppInbound: user.googleAutoSyncWhatsAppInbound ?? false,
        googleAutoSyncMode: user.googleAutoSyncMode ?? "LINK_ONLY",
        googleAutoSyncPushUpdates: user.googleAutoSyncPushUpdates ?? false,
        googleTasklistId: user.googleTasklistId ?? null,
        googleTasklistTitle: user.googleTasklistTitle ?? null,
        googleCalendarId: user.googleCalendarId ?? null,
        googleCalendarTitle: user.googleCalendarTitle ?? null,
    };
    await upsertDocumentIfChanged({
        scopeType: "USER",
        scopeId: user.id,
        domain: SETTINGS_DOMAINS.USER_GOOGLE_INTEGRATIONS,
        payload: userGooglePayload,
    });

    const userMicrosoftPayload = {
        outlookSyncEnabled: user.outlookSyncEnabled ?? false,
        outlookSubscriptionId: user.outlookSubscriptionId ?? null,
        outlookSubscriptionExpiry: user.outlookSubscriptionExpiry
            ? user.outlookSubscriptionExpiry.toISOString()
            : null,
        outlookAuthMethod: user.outlookAuthMethod ?? null,
        outlookEmail: user.outlookEmail ?? null,
        outlookSessionExpiry: user.outlookSessionExpiry
            ? user.outlookSessionExpiry.toISOString()
            : null,
    };
    await upsertDocumentIfChanged({
        scopeType: "USER",
        scopeId: user.id,
        domain: SETTINGS_DOMAINS.USER_MICROSOFT_INTEGRATIONS,
        payload: userMicrosoftPayload,
    });

    await setSecretIfNeeded({
        scopeType: "USER",
        scopeId: user.id,
        domain: SETTINGS_DOMAINS.USER_CRM,
        secretKey: SETTINGS_SECRET_KEYS.CRM_PASSWORD,
        plaintext: user.crmPassword ?? null,
    });

    await setSecretIfNeeded({
        scopeType: "USER",
        scopeId: user.id,
        domain: SETTINGS_DOMAINS.USER_GOOGLE_INTEGRATIONS,
        secretKey: SETTINGS_SECRET_KEYS.GOOGLE_ACCESS_TOKEN,
        plaintext: user.googleAccessToken ?? null,
    });

    await setSecretIfNeeded({
        scopeType: "USER",
        scopeId: user.id,
        domain: SETTINGS_DOMAINS.USER_GOOGLE_INTEGRATIONS,
        secretKey: SETTINGS_SECRET_KEYS.GOOGLE_REFRESH_TOKEN,
        plaintext: user.googleRefreshToken ?? null,
    });

    await setSecretIfNeeded({
        scopeType: "USER",
        scopeId: user.id,
        domain: SETTINGS_DOMAINS.USER_GOOGLE_INTEGRATIONS,
        secretKey: SETTINGS_SECRET_KEYS.GOOGLE_SYNC_TOKEN,
        plaintext: user.googleSyncToken ?? null,
    });

    await setSecretIfNeeded({
        scopeType: "USER",
        scopeId: user.id,
        domain: SETTINGS_DOMAINS.USER_MICROSOFT_INTEGRATIONS,
        secretKey: SETTINGS_SECRET_KEYS.OUTLOOK_ACCESS_TOKEN,
        plaintext: user.outlookAccessToken ?? null,
    });

    await setSecretIfNeeded({
        scopeType: "USER",
        scopeId: user.id,
        domain: SETTINGS_DOMAINS.USER_MICROSOFT_INTEGRATIONS,
        secretKey: SETTINGS_SECRET_KEYS.OUTLOOK_REFRESH_TOKEN,
        plaintext: user.outlookRefreshToken ?? null,
    });

    await setSecretIfNeeded({
        scopeType: "USER",
        scopeId: user.id,
        domain: SETTINGS_DOMAINS.USER_MICROSOFT_INTEGRATIONS,
        secretKey: SETTINGS_SECRET_KEYS.OUTLOOK_PASSWORD,
        plaintext: decryptOutlookPassword(user.outlookPasswordEncrypted),
    });

    await setSecretIfNeeded({
        scopeType: "USER",
        scopeId: user.id,
        domain: SETTINGS_DOMAINS.USER_MICROSOFT_INTEGRATIONS,
        secretKey: SETTINGS_SECRET_KEYS.OUTLOOK_SESSION_COOKIES,
        plaintext: decryptOutlookCookies(user.outlookSessionCookies),
    });
}

async function main() {
    console.log(
        `[settings/backfill] Starting${dryRun ? " (dry-run)" : ""} with filters: locationId=${locationIdFilter || "*"}, userId=${userIdFilter || "*"}`
    );

    const locations = await db.location.findMany({
        where: locationIdFilter ? { id: locationIdFilter } : undefined,
        select: {
            id: true,
            name: true,
            domain: true,
            timeZone: true,
            whatsappBusinessAccountId: true,
            whatsappPhoneNumberId: true,
            whatsappAccessToken: true,
            whatsappWebhookSecret: true,
            twilioAccountSid: true,
            twilioAuthToken: true,
            twilioWhatsAppFrom: true,
            evolutionInstanceId: true,
            evolutionApiToken: true,
            evolutionConnectionStatus: true,
            crmUrl: true,
            crmEditUrlPattern: true,
            crmLeadUrlPattern: true,
            crmSchema: true,
            crmLeadSchema: true,
            legacyCrmLeadEmailEnabled: true,
            legacyCrmLeadEmailSenders: true,
            legacyCrmLeadEmailSenderDomains: true,
            legacyCrmLeadEmailSubjectPatterns: true,
            legacyCrmLeadEmailPinConversation: true,
            legacyCrmLeadEmailAutoProcess: true,
            legacyCrmLeadEmailAutoDraftFirstContact: true,
            siteConfig: {
                select: {
                    domain: true,
                    theme: true,
                    navLinks: true,
                    footerLinks: true,
                    socialLinks: true,
                    legalLinks: true,
                    footerDisclaimer: true,
                    footerBio: true,
                    heroContent: true,
                    contactInfo: true,
                    googleAiApiKey: true,
                    googleAiModel: true,
                    googleAiModelExtraction: true,
                    googleAiModelDesign: true,
                    googleAiModelTranscription: true,
                    brandVoice: true,
                    homeSections: true,
                    favoritesConfig: true,
                    searchConfig: true,
                    submissionsConfig: true,
                    outreachConfig: true,
                    publicListingEnabled: true,
                    whatsappTranscriptOnDemandEnabled: true,
                    whatsappTranscriptRetentionDays: true,
                    whatsappTranscriptVisibility: true,
                    primaryColor: true,
                    secondaryColor: true,
                    accentColor: true,
                },
            },
        },
        orderBy: { createdAt: "asc" },
    });

    const users = await db.user.findMany({
        where: userIdFilter ? { id: userIdFilter } : undefined,
        select: {
            id: true,
            crmUsername: true,
            crmPassword: true,
            googleAccessToken: true,
            googleRefreshToken: true,
            googleSyncToken: true,
            googleSyncEnabled: true,
            googleSyncDirection: true,
            googleAutoSyncEnabled: true,
            googleAutoSyncLeadCapture: true,
            googleAutoSyncContactForm: true,
            googleAutoSyncWhatsAppInbound: true,
            googleAutoSyncMode: true,
            googleAutoSyncPushUpdates: true,
            googleTasklistId: true,
            googleTasklistTitle: true,
            googleCalendarId: true,
            googleCalendarTitle: true,
            outlookAccessToken: true,
            outlookRefreshToken: true,
            outlookSyncEnabled: true,
            outlookSubscriptionId: true,
            outlookSubscriptionExpiry: true,
            outlookAuthMethod: true,
            outlookEmail: true,
            outlookPasswordEncrypted: true,
            outlookSessionCookies: true,
            outlookSessionExpiry: true,
        },
        orderBy: { createdAt: "asc" },
    });

    for (const location of locations) {
        try {
            await backfillLocation(location);
        } catch (error: any) {
            stats.failures += 1;
            const message = `[settings/backfill] Location ${location.id} failed: ${error?.message || String(error)}`;
            if (!continueOnError) {
                throw new Error(message);
            }
            console.error(message);
        }
    }

    for (const user of users) {
        try {
            await backfillUser(user);
        } catch (error: any) {
            stats.failures += 1;
            const message = `[settings/backfill] User ${user.id} failed: ${error?.message || String(error)}`;
            if (!continueOnError) {
                throw new Error(message);
            }
            console.error(message);
        }
    }

    console.log("[settings/backfill] Completed.");
    console.log(
        JSON.stringify(
            {
                dryRun,
                locationCount: locations.length,
                userCount: users.length,
                ...stats,
            },
            null,
            2
        )
    );
}

main()
    .catch((error) => {
        console.error("[settings/backfill] Failed:", error);
        process.exitCode = 1;
    })
    .finally(async () => {
        await db.$disconnect();
    });
