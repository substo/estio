import { Prisma } from "@prisma/client";

export const OLD_CRM_SETTINGS_SECTIONS = [
    "CONNECTION",
    "LEAD_EMAIL",
    "PROPERTY_SCHEMA",
    "LEAD_SCHEMA",
] as const;

export type OldCrmSettingsSection = (typeof OLD_CRM_SETTINGS_SECTIONS)[number];

export function isOldCrmSettingsSection(value: unknown): value is OldCrmSettingsSection {
    return OLD_CRM_SETTINGS_SECTIONS.includes(value as OldCrmSettingsSection);
}

export function buildOldCrmSectionClearPlan(
    existingPayload: Record<string, unknown>,
    section: OldCrmSettingsSection
): {
    locationPayload: Record<string, unknown>;
    legacyLocationData: Prisma.LocationUncheckedUpdateInput;
    clearUserCredentials: boolean;
} {
    if (section === "CONNECTION") {
        const patch = {
            crmUrl: null,
            crmEditUrlPattern: null,
            crmLeadUrlPattern: null,
            publicListingUrlMode: "ESTIO",
            legacyPublicListingUrlPattern: null,
        };
        return {
            locationPayload: { ...existingPayload, ...patch },
            legacyLocationData: patch,
            clearUserCredentials: true,
        };
    }

    if (section === "LEAD_EMAIL") {
        const patch = {
            legacyCrmLeadEmailEnabled: false,
            legacyCrmLeadEmailSenders: [],
            legacyCrmLeadEmailSenderDomains: [],
            legacyCrmLeadEmailSubjectPatterns: [],
            legacyCrmLeadEmailPinConversation: true,
            legacyCrmLeadEmailAutoProcess: false,
            legacyCrmLeadEmailAutoDraftFirstContact: false,
        };
        return {
            locationPayload: { ...existingPayload, ...patch },
            legacyLocationData: patch,
            clearUserCredentials: false,
        };
    }

    if (section === "PROPERTY_SCHEMA") {
        return {
            locationPayload: { ...existingPayload, crmSchema: null },
            legacyLocationData: { crmSchema: Prisma.DbNull },
            clearUserCredentials: false,
        };
    }

    return {
        locationPayload: { ...existingPayload, crmLeadSchema: null },
        legacyLocationData: { crmLeadSchema: Prisma.DbNull },
        clearUserCredentials: false,
    };
}
