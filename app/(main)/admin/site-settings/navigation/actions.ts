"use server";

import { assertCrmActionAllowed } from "@/lib/auth/crm-action-guard";

import { auth } from "@clerk/nextjs/server";
import { getRequestAuthRealm } from "@/lib/auth/request-realm";
import db from "@/lib/db";
import { revalidatePath } from "next/cache";
import { verifyUserIsLocationAdmin } from "@/lib/auth/permissions";
import { getWebsiteSettings, saveWebsiteLayout } from "@/lib/website/settings-service";
import { overlayWebsiteLayout } from "@/lib/website/settings";
import { getLocationContext } from "@/lib/auth/location-context";
import { saveBusinessDetails } from "@/lib/business-profile/service";

/** Website navigation layout. Social links and the footer description are business details (Business profile). */
type NavigationPayload = {
    navLinks: any[];
    footerLinks: any[];
    legalLinks: any[];
    footerDisclaimer: string | null;
    menuStyle: "side" | "top";
    publicListingEnabled: boolean;
};

async function assertAdmin(locationId: string): Promise<string> {
    const { userId } = await auth();
    if (!userId) {
        throw new Error("Unauthorized");
    }

    const isAdmin = (await getLocationContext())?.id === locationId && await verifyUserIsLocationAdmin(userId, locationId);
    if (!isAdmin) {
        throw new Error("Unauthorized");
    }

    const localUser = await db.user.findUnique({
        where: { authRealm_clerkId: { authRealm: (await getRequestAuthRealm()) || "estio", clerkId: userId } },
        select: { id: true }
    });
    if (!localUser?.id) {
        throw new Error("Unauthorized");
    }
    return localUser.id;
}

async function getNavigationPayload(locationId: string): Promise<{ payload: NavigationPayload; version: number }> {
    // Layout comes from the website document, over the stored row for Locations that don't have one yet.
    const [website, config] = await Promise.all([getWebsiteSettings(locationId), db.siteConfig.findUnique({ where: { locationId } })]);
    const row = overlayWebsiteLayout({ ...(config ?? {}) } as Record<string, any>, website?.payload);
    const theme = (row.theme as any) || {};
    return {
        payload: {
            navLinks: (row.navLinks as any[]) || [],
            footerLinks: (row.footerLinks as any[]) || [],
            legalLinks: (row.legalLinks as any[]) || [],
            footerDisclaimer: row.footerDisclaimer || null,
            menuStyle: (theme.menuStyle ?? row.menuStyle) === "top" ? "top" : "side",
            publicListingEnabled: row.publicListingEnabled ?? true,
        },
        version: website?.version ?? 0,
    };
}

async function saveNavigationPayload(
    locationId: string,
    actorUserId: string,
    payload: NavigationPayload
) {
    // Menus live only in the website document; menu style is part of its theme.
    const current = await getWebsiteSettings(locationId);
    const { menuStyle, ...links } = payload;
    return saveWebsiteLayout(locationId, { ...links, theme: { ...((current?.payload?.theme as object) ?? {}), menuStyle } }, actorUserId);
}

export async function saveNavigation(locationId: string, type: "nav" | "footer" | "social" | "legal", links: any[]) {
    await assertCrmActionAllowed("site-settings/navigation/actions.ts", "saveNavigation");
    const actorUserId = await assertAdmin(locationId);
    if (type === "social") {
        // The business's own accounts belong to the Business profile; empty rows from the editor are not accounts.
        const socialLinks = links.flatMap((link: any) => typeof link?.url === "string" && link.url.trim() && typeof link?.platform === "string" && link.platform.trim()
            ? [{ platform: link.platform.trim(), url: link.url.trim() }] : []);
        await saveBusinessDetails(locationId, { socialLinks }, actorUserId);
        revalidatePath("/admin/site-settings/navigation");
        revalidatePath("/admin/site-settings");
        return;
    }
    const { payload } = await getNavigationPayload(locationId);

    const nextPayload: NavigationPayload = {
        ...payload,
        ...(type === "nav" ? { navLinks: links } : {}),
        ...(type === "footer" ? { footerLinks: links } : {}),
        ...(type === "legal" ? { legalLinks: links } : {}),
    };

    await saveNavigationPayload(locationId, actorUserId, nextPayload);
    revalidatePath("/admin/site-settings/navigation");
    revalidatePath("/admin/site-settings");
}

export async function getLivePages(locationId: string) {
    await assertCrmActionAllowed("site-settings/navigation/actions.ts", "getLivePages");
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
        ...(await getRequestAuthRealm() === "substo" ? [{ label: "Blog", value: "/blog" }] : [{ label: "Properties / Search", value: "/properties/search" }]),
    ];

    const contentPages = pages.map(p => ({
        label: p.title,
        value: `/${p.slug}`
    }));

    return [...systemPages, ...contentPages];
}

export async function saveFooterDisclaimer(locationId: string, text: string) {
    await assertCrmActionAllowed("site-settings/navigation/actions.ts", "saveFooterDisclaimer");
    const actorUserId = await assertAdmin(locationId);
    const { payload } = await getNavigationPayload(locationId);
    await saveNavigationPayload(locationId, actorUserId, {
        ...payload,
        footerDisclaimer: text || null,
    });
    revalidatePath("/admin/site-settings/navigation");
}

export async function saveFooterBio(locationId: string, text: string) {
    await assertCrmActionAllowed("site-settings/navigation/actions.ts", "saveFooterBio");
    const actorUserId = await assertAdmin(locationId);
    // The footer description is the business summary (one text, in the Business profile).
    await saveBusinessDetails(locationId, { summary: text?.trim() || null }, actorUserId);
    revalidatePath("/admin/site-settings/navigation");
}

export async function saveNavigationStyle(locationId: string, style: "side" | "top") {
    await assertCrmActionAllowed("site-settings/navigation/actions.ts", "saveNavigationStyle");
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
    await assertCrmActionAllowed("site-settings/navigation/actions.ts", "savePublicListingEnabled");
    const actorUserId = await assertAdmin(locationId);
    const { payload } = await getNavigationPayload(locationId);
    await saveNavigationPayload(locationId, actorUserId, {
        ...payload,
        publicListingEnabled: enabled,
    });
    revalidatePath("/admin/site-settings/navigation");
    revalidatePath("/", "layout");
}
