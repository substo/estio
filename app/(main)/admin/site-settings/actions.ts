"use server";

import db from "@/lib/db";
import { auth } from "@clerk/nextjs/server";
import { verifyUserHasAccessToLocation } from "@/lib/auth/permissions";
import { revalidatePath } from "next/cache";

interface SiteSettingsState {
    message?: string;
    errors?: {
        domain?: string[];
        _form?: string[];
    };
}

export async function updateSiteSettings(
    prevState: SiteSettingsState,
    formData: FormData
): Promise<SiteSettingsState> {
    const { userId } = await auth();
    if (!userId) return { message: "Unauthorized" };

    const locationId = formData.get("locationId") as string;
    if (!locationId) {
        return { message: "Location ID is missing" };
    }

    const hasAccess = await verifyUserHasAccessToLocation(userId, locationId);
    if (!hasAccess) {
        return { message: "Unauthorized: You do not have access to this location." };
    }

    const domain = formData.get("domain") as string;
    const locationNameRaw = formData.get("locationName") as string;
    const locationName = locationNameRaw?.trim() ? locationNameRaw.trim() : null;
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

    // Fetch existing config to preserve menuStyle
    const existingConfig = await db.siteConfig.findUnique({ where: { locationId } });
    const existingTheme = (existingConfig?.theme as any) || {};

    const themeData = {
        primaryColor,
        secondaryColor,
        accentColor,
        backgroundColor,
        textColor,
        logo: {
            url: logoUrl,
            lightUrl: formData.get("lightLogoUrl") as string,
            iconUrl: formData.get("iconUrl") as string,
            faviconUrl: formData.get("faviconUrl") as string,
            textTop: brandName,
            textBottom: brandTagline
        },
        headerStyle: formData.get("headerStyle") as string || "transparent",
        menuStyle: existingTheme.menuStyle || "side" // Preserve existing or default to side
    };

    const contactData = {
        address: contactAddress,
        mapsLink: contactMapsLink,
        mapsLinkTitle: contactMapsLinkTitle,
        mobile: contactMobile,
        landline: contactLandline,
        email: contactEmail
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

    try {
        // If domain is empty string, we should probably set it to null/undefined
        const domainVal = domain && domain.trim() !== "" ? domain.trim() : null;

        const updateData: any = {
            domain: domainVal,
            theme: themeData,
            contactInfo: contactData,

            primaryColor,
            secondaryColor,
            accentColor,
        };

        if (navLinksForUpdate !== undefined) {
            updateData.navLinks = navLinksForUpdate;
        }

        await db.siteConfig.upsert({
            where: { locationId },
            create: {
                locationId,
                domain: domainVal,
                theme: themeData,
                contactInfo: contactData,

                navLinks: navLinksForCreate, // Use default or provided
                primaryColor,
                secondaryColor,
                accentColor,
            },
            update: updateData,
        });

        // Also sync the domain to the Location table for consistency
        await db.location.update({
            where: { id: locationId },
            data: {
                domain: domainVal,
                name: locationName
            }
        });

        // AUTOMATION: If a valid domain was saved, whitelist it in Clerk
        if (domainVal) {
            try {
                // Use registerClerkDomain to ensure it's added as a Satellite Domain + Whitelisted
                const { registerClerkDomain } = await import("@/lib/auth/clerk-domains");
                // We fire and forget this to not block the UI, or await it if strict
                await registerClerkDomain(domainVal);
            } catch (clerkErr) {
                console.error("Failed to automate Clerk whitelist:", clerkErr);
                // We don't fail the request, but we log it. User might need to retry or do it manually.
            }
        }

        revalidatePath("/admin/site-settings");
        return { message: "Settings saved successfully" };
    } catch (error: any) {
        console.error(error);
        if (error.code === 'P2002') {
            return { errors: { domain: ["This domain is already taken."] } };
        }
        return { message: "Database error occurred." };
    }
}
