"use server";

import { assertCrmActionAllowed } from "@/lib/auth/crm-action-guard";

import { getRequestAuthRealm } from "@/lib/auth/request-realm";
import { getSubstoLocationActor } from "@/lib/locations/substo-locations";
import { saveWebsiteDesign } from "@/lib/substo-sites/service";
import { saveBusinessDetails } from "@/lib/business-profile/service";
import type { BusinessDetailsPatch } from "@/lib/business-profile/view";
import db from "@/lib/db";
import { auth } from "@clerk/nextjs/server";
import { verifyUserIsLocationAdmin } from "@/lib/auth/permissions";
import { revalidatePath } from "next/cache";
import { normalizeIanaTimeZoneOrThrow, ViewingDateTimeValidationError } from "@/lib/viewings/datetime";
import { settingsService } from "@/lib/settings/service";
import {
    SETTINGS_DOMAINS,
    isSettingsDualWriteLegacyEnabled,
    isSettingsParityCheckEnabled,
} from "@/lib/settings/constants";
import { SettingsVersionConflictError } from "@/lib/settings/errors";
import { clearLocationMarketContextCache } from "@/lib/locations/market-context";
import { parseLocationMarketProfileSettings } from "@/lib/locations/market-profile-settings";
import { getLocationContext } from "@/lib/auth/location-context";

interface SiteSettingsState {
    message?: string;
    version?: number;
    errors?: {
        domain?: string[];
        locationTimeZone?: string[];
        marketCountryCode?: string[];
        marketCountryName?: string[];
        marketLocale?: string[];
        marketCurrencyCode?: string[];
        marketSupportedLanguages?: string[];
        marketServiceAreas?: string[];
        _version?: string[];
        _form?: string[];
    };
}

export async function updateSiteSettings(
    prevState: SiteSettingsState,
    formData: FormData
): Promise<SiteSettingsState> {
    await assertCrmActionAllowed("site-settings/actions.ts", "updateSiteSettings");
    if (await getRequestAuthRealm() === "substo") {
        const actor = await getSubstoLocationActor();
        if (!actor) return { message: "Brand admin access is required." };
        const result = await saveWebsiteDesign(db, actor, formData, saveBusinessDetails);
        revalidatePath("/admin/site-settings");
        revalidatePath("/admin/content/website");
        return result;
    }

    const { userId } = await auth();
    if (!userId) return { message: "Unauthorized" };

    const locationId = formData.get("locationId") as string;
    if (!locationId) {
        return { message: "Location ID is missing" };
    }
    if ((await getLocationContext())?.id !== locationId) return { message: "Active location mismatch" };

    const isAdmin = await verifyUserIsLocationAdmin(userId, locationId);
    if (!isAdmin) {
        return { message: "Unauthorized: Admin access is required to update settings." };
    }

    const locationNameRaw = formData.get("locationName") as string;
    const locationName = locationNameRaw?.trim() ? locationNameRaw.trim() : null;
    const locationTimeZoneRaw = (formData.get("locationTimeZone") as string) || "";
    const locationTimeZone = locationTimeZoneRaw.trim();
    const primaryColor = formData.get("primaryColor") as string;
    // New Advanced Colors
    const secondaryColor = formData.get("secondaryColor") as string;
    const accentColor = formData.get("accentColor") as string;
    const backgroundColor = formData.get("backgroundColor") as string;
    const textColor = formData.get("textColor") as string;


    const logoUrl = formData.get("logoUrl") as string;
    const brandName = formData.get("brandName") as string;
    const brandTagline = formData.get("brandTagline") as string;

    const contactAddress = formData.get("contactAddress") as string;
    const contactMapsLink = formData.get("contactMapsLink") as string;
    const contactMapsLinkTitle = formData.get("contactMapsLinkTitle") as string;
    const contactMobile = formData.get("contactMobile") as string;
    const contactLandline = formData.get("contactLandline") as string;
    const contactEmail = formData.get("contactEmail") as string;

    const localUser = await db.user.findUnique({
        where: { clerkId: userId },
        select: { id: true }
    });

    const settingsDoc = await settingsService.getDocument<any>({
        scopeType: "LOCATION",
        scopeId: locationId,
        domain: SETTINGS_DOMAINS.LOCATION_PUBLIC_SITE,
    });
    const marketProfileSubmitted = formData.has("marketCountryCode");
    const parsedMarketProfile = marketProfileSubmitted
        ? parseLocationMarketProfileSettings({
            countryCode: formData.get("marketCountryCode"),
            countryName: formData.get("marketCountryName"),
            locale: formData.get("marketLocale"),
            currencyCode: formData.get("marketCurrencyCode"),
            supportedLanguages: formData.get("marketSupportedLanguages"),
            serviceAreasJson: formData.get("marketServiceAreas"),
        })
        : null;
    if (parsedMarketProfile?.errors) {
        return { errors: parsedMarketProfile.errors };
    }
    const existingConfig = await db.siteConfig.findUnique({ where: { locationId } });
    const existingTheme =
        (settingsDoc?.payload as any)?.theme
        || (existingConfig?.theme as any)
        || {};

    // Website layout only: brand colours, logos and contact details belong to the Business profile (saved below).
    const themeData = {
        backgroundColor,
        textColor,
        logo: {
            textTop: brandName,
            textBottom: brandTagline
        },
        headerStyle: formData.get("headerStyle") as string || "transparent",
        menuStyle: existingTheme.menuStyle || "side" // Preserve existing or default to side
    };
    const blank = (v: string | null | undefined) => v?.trim() ? v.trim() : null;
    const businessPatch: BusinessDetailsPatch = {
        colours: { primary: blank(primaryColor), secondary: blank(secondaryColor), accent: blank(accentColor) },
        logos: { primary: blank(logoUrl), light: blank(formData.get("lightLogoUrl") as string), icon: blank(formData.get("iconUrl") as string), favicon: blank(formData.get("faviconUrl") as string) },
        address: blank(contactAddress), email: blank(contactEmail),
        phones: ([["Mobile", contactMobile], ["Landline", contactLandline]] as const).flatMap(([label, number]) => blank(number) ? [{ label, number: blank(number)! }] : []),
        maps: blank(contactMapsLink) ? [{ url: blank(contactMapsLink)!, title: blank(contactMapsLinkTitle) }] : [],
        ...(parsedMarketProfile?.profile ? { market: {
            countryCode: parsedMarketProfile.profile.countryCode ?? null, countryName: parsedMarketProfile.profile.countryName ?? null, locale: parsedMarketProfile.profile.locale ?? null,
            currencyCode: parsedMarketProfile.profile.currencyCode ?? null, supportedLanguages: parsedMarketProfile.profile.supportedLanguages ?? [],
            serviceAreas: (parsedMarketProfile.profile.serviceAreas ?? []).map((a: any) => ({ id: a.id, label: a.label, aliases: a.aliases ?? [], parentId: a.parentId ?? null, kind: a.kind ?? null })),
        } } : {}),
    };

    // Parse Navigation Links (Only if provided in form, otherwise preserve existing on update)
    let navLinksForCreate: any = [
        { label: "Home", href: "/" },
        { label: "Search", href: "/properties/search" }
    ];
    let navLinksForUpdate: any = undefined;

    if (formData.has("navLinksJson")) {
        try {
            const navLinksInput = formData.get("navLinksJson") as string;
            // console.log("Received navLinksJson:", navLinksInput); // DEBUG LOG
            if (navLinksInput) {
                const parsed = JSON.parse(navLinksInput);
                navLinksForCreate = parsed;
                navLinksForUpdate = parsed;
            } else {
                // Empty string provided implies user cleared it? Or just error?
                // For now, let's assume if it is present and valid JSON, we use it.
            }
        } catch (e) {
            console.error("Error parsing navLinks", e);
        }
    }
    // If formData.has("navLinksJson") is FALSE (field removed from UI), navLinksForUpdate remains undefined.

    const expectedVersionRaw = (formData.get("settingsVersion") as string | null)?.trim();
    const expectedVersionCandidate = expectedVersionRaw ? Number(expectedVersionRaw) : null;
    const expectedVersion = Number.isFinite(expectedVersionCandidate) ? expectedVersionCandidate : null;

    try {
        // Domain lifecycle is managed separately. General settings saves must never disconnect a site.
        const activeDomain = await db.publicSiteDomain.findFirst({
            where: { locationId, role: "CANONICAL", status: "ACTIVE" },
            select: { hostname: true },
        });
        const domainVal = activeDomain?.hostname || existingConfig?.domain || null;
        let validatedLocationTimeZone: string | null = null;
        if (locationTimeZone) {
            validatedLocationTimeZone = normalizeIanaTimeZoneOrThrow(locationTimeZone);
        }

        const updateData: any = {
            domain: domainVal,
            theme: themeData,
        };

        if (navLinksForUpdate !== undefined) {
            updateData.navLinks = navLinksForUpdate;
        }

        // Name and time zone live only on Location; business details only in the Business profile.
        const payload = {
            domain: domainVal,
            theme: themeData,
            navLinks: navLinksForUpdate ?? navLinksForCreate,
            footerLinks: (existingConfig?.footerLinks as any[]) || [],
            legalLinks: (existingConfig?.legalLinks as any[]) || [],
            footerDisclaimer: existingConfig?.footerDisclaimer || null,
            publicListingEnabled: existingConfig?.publicListingEnabled ?? true,
        };

        const savedDoc = await settingsService.upsertDocument({
            scopeType: "LOCATION",
            scopeId: locationId,
            domain: SETTINGS_DOMAINS.LOCATION_PUBLIC_SITE,
            payload,
            expectedVersion,
            actorUserId: localUser?.id,
            schemaVersion: 1,
        });

        if (isSettingsDualWriteLegacyEnabled()) {
            await db.siteConfig.upsert({
                where: { locationId },
                create: {
                    locationId,
                    domain: domainVal,
                    theme: themeData,
                    navLinks: navLinksForCreate,
                },
                update: updateData,
            });
        }

        if (!localUser?.id) return { message: "Account unavailable. Sign in again." };
        await saveBusinessDetails(locationId, businessPatch, localUser.id);

        // Also sync the domain to the Location table for consistency
        await db.location.update({
            where: { id: locationId },
            data: {
                domain: domainVal,
                name: locationName,
                timeZone: validatedLocationTimeZone
            }
        });

        if (isSettingsDualWriteLegacyEnabled() && isSettingsParityCheckEnabled()) {
            await settingsService.checkDocumentParity({
                scopeType: "LOCATION",
                scopeId: locationId,
                domain: SETTINGS_DOMAINS.LOCATION_PUBLIC_SITE,
                legacyPayload: payload,
                actorUserId: localUser?.id,
            });
        }

        clearLocationMarketContextCache(locationId);

        revalidatePath("/admin/site-settings");
        return { message: "Settings saved successfully", version: savedDoc.version };
    } catch (error: any) {
        console.error(error);
        if (error instanceof SettingsVersionConflictError) {
            return { errors: { _version: ["This form is out of date. Refresh and try again."] } };
        }
        if (error instanceof ViewingDateTimeValidationError && error.code === "INVALID_TIMEZONE") {
            return { errors: { locationTimeZone: ["Please enter a valid IANA timezone (e.g. Europe/Nicosia)."] } };
        }
        if (error.code === 'P2002') {
            return { errors: { domain: ["This domain is already taken."] } };
        }
        return { message: "Database error occurred." };
    }
}
