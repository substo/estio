"use server";

import { auth } from "@clerk/nextjs/server";
import db from "@/lib/db";
import { revalidatePath } from "next/cache";
import { verifyUserIsLocationAdmin } from "@/lib/auth/permissions";
import { settingsService } from "@/lib/settings/service";
import {
    SETTINGS_DOMAINS,
    isSettingsDualWriteLegacyEnabled,
    isSettingsParityCheckEnabled,
} from "@/lib/settings/constants";

type NavigationPayload = {
    navLinks: any[];
    footerLinks: any[];
    socialLinks: any[];
    legalLinks: any[];
    footerDisclaimer: string | null;
    footerBio: string | null;
    menuStyle: "side" | "top";
    publicListingEnabled: boolean;
};

async function assertAdmin(locationId: string): Promise<string> {
    const { userId } = await auth();
    if (!userId) {
        throw new Error("Unauthorized");
    }

    const isAdmin = await verifyUserIsLocationAdmin(userId, locationId);
    if (!isAdmin) {
        throw new Error("Unauthorized");
    }

    const localUser = await db.user.findUnique({
        where: { clerkId: userId },
        select: { id: true }
    });
    if (!localUser?.id) {
        throw new Error("Unauthorized");
    }
    return localUser.id;
}

async function getNavigationPayload(locationId: string): Promise<{ payload: NavigationPayload; version: number }> {
    const [doc, config] = await Promise.all([
        settingsService.getDocument<NavigationPayload>({
            scopeType: "LOCATION",
            scopeId: locationId,
            domain: SETTINGS_DOMAINS.LOCATION_NAVIGATION,
        }),
        db.siteConfig.findUnique({ where: { locationId } }),
    ]);

    const theme = (config?.theme as any) || {};

    if (doc) {
        return { payload: doc.payload, version: doc.version };
    }

    return {
        payload: {
            navLinks: (config?.navLinks as any[]) || [],
            footerLinks: (config?.footerLinks as any[]) || [],
            socialLinks: (config?.socialLinks as any[]) || [],
            legalLinks: (config?.legalLinks as any[]) || [],
            footerDisclaimer: config?.footerDisclaimer || null,
            footerBio: config?.footerBio || null,
            menuStyle: theme.menuStyle === "top" ? "top" : "side",
            publicListingEnabled: config?.publicListingEnabled ?? true,
        },
        version: 0,
    };
}

async function saveNavigationPayload(
    locationId: string,
    actorUserId: string,
    payload: NavigationPayload
) {
    const saved = await settingsService.upsertDocument({
        scopeType: "LOCATION",
        scopeId: locationId,
        domain: SETTINGS_DOMAINS.LOCATION_NAVIGATION,
        payload,
        actorUserId,
        schemaVersion: 1,
    });

    if (isSettingsDualWriteLegacyEnabled()) {
        const existing = await db.siteConfig.findUnique({ where: { locationId } });
        const currentTheme = (existing?.theme as any) || {};
        await db.siteConfig.upsert({
            where: { locationId },
            create: {
                locationId,
                navLinks: payload.navLinks,
                footerLinks: payload.footerLinks,
                socialLinks: payload.socialLinks,
                legalLinks: payload.legalLinks,
                footerDisclaimer: payload.footerDisclaimer || null,
                footerBio: payload.footerBio || null,
                publicListingEnabled: payload.publicListingEnabled,
                theme: {
                    ...currentTheme,
                    menuStyle: payload.menuStyle,
                },
            },
            update: {
                navLinks: payload.navLinks,
                footerLinks: payload.footerLinks,
                socialLinks: payload.socialLinks,
                legalLinks: payload.legalLinks,
                footerDisclaimer: payload.footerDisclaimer || null,
                footerBio: payload.footerBio || null,
                publicListingEnabled: payload.publicListingEnabled,
                theme: {
                    ...currentTheme,
                    menuStyle: payload.menuStyle,
                },
            },
        });
    }

    if (isSettingsDualWriteLegacyEnabled() && isSettingsParityCheckEnabled()) {
        await settingsService.checkDocumentParity({
            scopeType: "LOCATION",
            scopeId: locationId,
            domain: SETTINGS_DOMAINS.LOCATION_NAVIGATION,
            legacyPayload: payload,
            actorUserId,
        });
    }

    return saved;
}

export async function saveNavigation(locationId: string, type: "nav" | "footer" | "social" | "legal", links: any[]) {
    const actorUserId = await assertAdmin(locationId);
    const { payload } = await getNavigationPayload(locationId);

    const nextPayload: NavigationPayload = {
        ...payload,
        ...(type === "nav" ? { navLinks: links } : {}),
        ...(type === "footer" ? { footerLinks: links } : {}),
        ...(type === "social" ? { socialLinks: links } : {}),
        ...(type === "legal" ? { legalLinks: links } : {}),
    };

    await saveNavigationPayload(locationId, actorUserId, nextPayload);
    revalidatePath("/admin/site-settings/navigation");
    revalidatePath("/admin/site-settings");
}

export async function getLivePages(locationId: string) {
    await assertAdmin(locationId);
    const pages = await db.contentPage.findMany({
        where: {
            locationId,
            published: true,
        },
        select: {
            title: true,
            slug: true,
        }
    });

    const systemPages = [
        { label: "Home", value: "/" },
        { label: "Properties / Search", value: "/properties/search" },
    ];

    const contentPages = pages.map(p => ({
        label: p.title,
        value: `/${p.slug}`
    }));

    return [...systemPages, ...contentPages];
}

export async function saveFooterDisclaimer(locationId: string, text: string) {
    const actorUserId = await assertAdmin(locationId);
    const { payload } = await getNavigationPayload(locationId);
    await saveNavigationPayload(locationId, actorUserId, {
        ...payload,
        footerDisclaimer: text || null,
    });
    revalidatePath("/admin/site-settings/navigation");
}

export async function saveFooterBio(locationId: string, text: string) {
    const actorUserId = await assertAdmin(locationId);
    const { payload } = await getNavigationPayload(locationId);
    await saveNavigationPayload(locationId, actorUserId, {
        ...payload,
        footerBio: text || null,
    });
    revalidatePath("/admin/site-settings/navigation");
}

export async function saveNavigationStyle(locationId: string, style: "side" | "top") {
    const actorUserId = await assertAdmin(locationId);
    const { payload } = await getNavigationPayload(locationId);
    await saveNavigationPayload(locationId, actorUserId, {
        ...payload,
        menuStyle: style,
    });
    revalidatePath("/admin/site-settings/navigation");
    revalidatePath("/admin/site-settings");
}

export async function savePublicListingEnabled(locationId: string, enabled: boolean) {
    const actorUserId = await assertAdmin(locationId);
    const { payload } = await getNavigationPayload(locationId);
    await saveNavigationPayload(locationId, actorUserId, {
        ...payload,
        publicListingEnabled: enabled,
    });
    revalidatePath("/admin/site-settings/navigation");
    revalidatePath("/", "layout");
}
