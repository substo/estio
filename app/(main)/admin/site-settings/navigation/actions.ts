"use server";

import { auth } from "@clerk/nextjs/server";
import db from "@/lib/db";
import { revalidatePath } from "next/cache";

export async function saveNavigation(type: 'nav' | 'footer' | 'social' | 'legal', links: any[]) {
    const { userId } = await auth();
    if (!userId) { throw new Error("Unauthorized"); }
    const user = await db.user.findUnique({ where: { clerkId: userId }, include: { locations: true } });
    const orgId = user?.locations[0]?.id;

    if (!orgId) { throw new Error("Unauthorized"); }

    const data = type === 'nav'
        ? { navLinks: links }
        : type === 'footer'
            ? { footerLinks: links }
            : type === 'social'
                ? { socialLinks: links }
                : { legalLinks: links };

    await db.siteConfig.update({
        where: { locationId: orgId },
        data: data,
    });

    revalidatePath("/admin/site-settings/navigation");
}

export async function getLivePages() {
    const { userId } = await auth();
    if (!userId) { return []; }
    const user = await db.user.findUnique({ where: { clerkId: userId }, include: { locations: true } });
    const orgId = user?.locations[0]?.id;

    if (!orgId) { return []; }

    const pages = await db.contentPage.findMany({
        where: {
            locationId: orgId,
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
export async function saveFooterDisclaimer(text: string) {
    const { userId } = await auth();
    if (!userId) { throw new Error("Unauthorized"); }
    const user = await db.user.findUnique({ where: { clerkId: userId }, include: { locations: true } });
    const orgId = user?.locations[0]?.id;

    if (!orgId) { throw new Error("Unauthorized"); }

    await db.siteConfig.update({
        where: { locationId: orgId },
        data: { footerDisclaimer: text },
    });

    revalidatePath("/admin/site-settings/navigation");
}

export async function saveFooterBio(text: string) {
    const { userId } = await auth();
    if (!userId) { throw new Error("Unauthorized"); }
    const user = await db.user.findUnique({ where: { clerkId: userId }, include: { locations: true } });
    const orgId = user?.locations[0]?.id;

    if (!orgId) { throw new Error("Unauthorized"); }

    await db.siteConfig.update({
        where: { locationId: orgId },
        data: { footerBio: text },
    });
    // Force revalidation of types
    revalidatePath("/admin/site-settings/navigation");
}

export async function saveNavigationStyle(style: 'side' | 'top') {
    const { userId } = await auth();
    if (!userId) { throw new Error("Unauthorized"); }
    const user = await db.user.findUnique({ where: { clerkId: userId }, include: { locations: true } });
    const orgId = user?.locations[0]?.id;

    if (!orgId) { throw new Error("Unauthorized"); }

    const currentConfig = await db.siteConfig.findUnique({ where: { locationId: orgId } });
    const currentTheme = (currentConfig?.theme as any) || {};

    await db.siteConfig.update({
        where: { locationId: orgId },
        data: {
            theme: {
                ...currentTheme,
                menuStyle: style
            }
        },
    });

    revalidatePath("/admin/site-settings/navigation");
    revalidatePath("/admin/site-settings");
}

export async function savePublicListingEnabled(enabled: boolean) {
    const { userId } = await auth();
    if (!userId) { throw new Error("Unauthorized"); }
    const user = await db.user.findUnique({ where: { clerkId: userId }, include: { locations: true } });
    const orgId = user?.locations[0]?.id;

    if (!orgId) { throw new Error("Unauthorized"); }

    await db.siteConfig.update({
        where: { locationId: orgId },
        data: { publicListingEnabled: enabled },
    });

    revalidatePath("/admin/site-settings/navigation");
    revalidatePath("/", "layout"); // Revalidate all public pages potentially
}
