"use server";

import { auth } from "@clerk/nextjs/server";
import db from "@/lib/db";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { verifyUserHasAccessToLocation, verifyUserIsLocationAdmin } from "@/lib/auth/permissions";
import { settingsService } from "@/lib/settings/service";
import {
    SETTINGS_DOMAINS,
    isSettingsDualWriteLegacyEnabled,
    isSettingsParityCheckEnabled,
} from "@/lib/settings/constants";

// Reserved slugs to prevent breaking the app
const RESERVED_SLUGS = ["search", "property", "blog", "api", "dashboard", "sign-in"];

function nullableString(value: FormDataEntryValue | null): string | null {
    if (value === null || value === undefined) return null;
    const str = String(value).trim();
    return str ? str : null;
}

async function resolveUserContext() {
    const { userId } = await auth();
    if (!userId) {
        return null;
    }

    const user = await db.user.findUnique({
        where: { clerkId: userId },
        select: { id: true },
    });

    if (!user?.id) {
        return null;
    }

    return { clerkUserId: userId, localUserId: user.id };
}

async function assertLocationAccess(clerkUserId: string, locationId: string) {
    const hasAccess = await verifyUserHasAccessToLocation(clerkUserId, locationId);
    return hasAccess;
}

async function assertLocationAdmin(clerkUserId: string, locationId: string) {
    const isAdmin = await verifyUserIsLocationAdmin(clerkUserId, locationId);
    return isAdmin;
}

// Helper to extract Cloudflare Image IDs from blocks
function extractImageIds(blocks: any): Set<string> {
    const ids = new Set<string>();
    // Regex to capture the ID from: https://imagedelivery.net/<ACCOUNT_HASH>/<IMAGE_ID>/<VARIANT>
    const regex = /imagedelivery\.net\/[^/]+\/([0-9a-fA-F-]+)\//g;

    const traverse = (obj: any) => {
        if (!obj) return;
        if (typeof obj === "string") {
            // Use exec handling for broader compatibility than matchAll iterator
            let match;
            while ((match = regex.exec(obj)) !== null) {
                if (match[1]) ids.add(match[1]);
            }
        } else if (typeof obj === "object") {
            Object.values(obj).forEach(val => traverse(val));
        }
    };

    traverse(blocks);
    return ids;
}

export async function upsertPage(prevState: any, formData: FormData) {
    const context = await resolveUserContext();
    if (!context) return { message: "Unauthorized: No user" };

    const id = (formData.get("id") as string | null) || null;
    const locationIdInput = String(formData.get("locationId") || "").trim();
    let locationId = locationIdInput;
    if (!locationId && id) {
        const existing = await db.contentPage.findUnique({
            where: { id },
            select: { locationId: true },
        });
        locationId = existing?.locationId || "";
    }
    if (!locationId) return { message: "Unauthorized: No Location" };

    const hasAccess = await assertLocationAccess(context.clerkUserId, locationId);
    if (!hasAccess) return { message: "Unauthorized" };

    const title = formData.get("title") as string;
    let slug = formData.get("slug") as string;
    const content = formData.get("content") as string; // Legacy/Fallback HTML
    const blocksJson = formData.get("blocks") as string; // JSON String of blocks
    const published = formData.get("published") === "on";
    const headerStyle = formData.get("headerStyle") as string || null;
    const heroImage = formData.get("heroImage") as string || null;
    const metaTitle = formData.get("metaTitle") as string || null;
    const metaDescription = formData.get("metaDescription") as string || null;
    let blocks: any = null;
    if (blocksJson) {
        try {
            blocks = JSON.parse(blocksJson);
        } catch (e) {
            console.error("Failed to parse blocks JSON");
        }
    }

    // Slugify
    slug = slug.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");

    if (RESERVED_SLUGS.includes(slug)) {
        return { message: `The slug '${slug}' is reserved. Please choose another.` };
    }

    try {
        if (id) {
            const existingScoped = await db.contentPage.findFirst({
                where: { id, locationId },
                select: { id: true, blocks: true },
            });
            if (!existingScoped) {
                return { message: "Unauthorized" };
            }

            // --- IMAGE CLEANUP LOGIC ---
            // 1. Fetch existing page to get old blocks
            if (existingScoped.blocks) {
                const oldIds = extractImageIds(existingScoped.blocks);
                const newIds = extractImageIds(blocks);

                // Find IDs present in Old but NOT in New
                const idsToDelete = Array.from(oldIds).filter(x => !newIds.has(x));

                if (idsToDelete.length > 0) {
                    console.log(`[upsertPage] Found ${idsToDelete.length} orphaned images to delete.`);
                    // Dynamic import to avoid top-level issues if any
                    const { deleteImage } = await import("@/lib/cloudflareImages");

                    // Delete in background so we don't block the save if it's slow
                    // Use Promise.allSettled to ensure individual failures don't crash the logic
                    Promise.allSettled(idsToDelete.map(imgId => {
                        console.log(`[upsertPage] Deleting orphaned image: ${imgId}`);
                        return deleteImage(imgId);
                    }));
                }
            }
            // ---------------------------

            // @ts-ignore
            await (db.contentPage as any).update({
                where: { id },
                data: { title, slug, content, blocks, published, headerStyle, heroImage, metaTitle, metaDescription },
            });
        } else {
            // @ts-ignore
            await (db.contentPage as any).create({
                data: {
                    locationId,
                    title,
                    slug,
                    content,
                    blocks,
                    published,
                    headerStyle,
                    heroImage,
                    metaTitle,
                    metaDescription
                }
            });
        }
    } catch (e) {
        console.error(e);
        return { message: "Error saving page. Slug might be duplicate." };
    }

    revalidatePath("/admin/content/pages");
    redirect("/admin/content/pages");
}

export async function deletePage(id: string) {
    const context = await resolveUserContext();
    if (!context) return { message: "Unauthorized" };

    const page = await db.contentPage.findUnique({
        where: { id },
        select: { id: true, locationId: true },
    });
    if (!page) return { message: "Error deleting page" };

    const hasAccess = await assertLocationAccess(context.clerkUserId, page.locationId);
    if (!hasAccess) return { message: "Unauthorized" };

    try {
        await db.contentPage.delete({
            where: { id: page.id },
        });
        revalidatePath("/admin/content/pages");
        return { message: "Success" };
    } catch (e) {
        return { message: "Error deleting page" };
    }
}

export async function upsertPost(prevState: any, formData: FormData) {
    const context = await resolveUserContext();
    if (!context) return { message: "Unauthorized" };

    const id = (formData.get("id") as string | null) || null;
    const locationIdInput = String(formData.get("locationId") || "").trim();
    let locationId = locationIdInput;
    if (!locationId && id) {
        const existing = await db.blogPost.findUnique({
            where: { id },
            select: { locationId: true },
        });
        locationId = existing?.locationId || "";
    }
    if (!locationId) return { message: "Unauthorized: No Location" };

    const hasAccess = await assertLocationAccess(context.clerkUserId, locationId);
    if (!hasAccess) return { message: "Unauthorized" };

    const title = formData.get("title") as string;
    let slug = formData.get("slug") as string;
    const content = formData.get("content") as string;
    const coverImage = formData.get("coverImage") as string;
    const published = formData.get("published") === "on";
    slug = slug.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");

    if (RESERVED_SLUGS.includes(slug)) {
        return { message: `The slug '${slug}' is reserved.` };
    }

    try {
        const data = {
            locationId,
            title,
            slug,
            content,
            coverImage,
            published,
            publishedAt: published ? new Date() : null, // Simple logic: set date on publish
        };

        if (id) {
            const existing = await db.blogPost.findFirst({
                where: { id, locationId },
                select: { id: true },
            });
            if (!existing) {
                return { message: "Unauthorized" };
            }

            // Don't overwrite publishedAt if already set, unless unpublishing? 
            // Simplified: Just update fields
            await db.blogPost.update({
                where: { id },
                data: { title, slug, content, coverImage, published, publishedAt: published ? new Date() : null },
            });
        } else {
            await db.blogPost.create({ data });
        }
    } catch (e) {
        return { message: "Error saving post." };
    }

    revalidatePath("/admin/content/posts");
    redirect("/admin/content/posts");
}

export async function deletePost(id: string) {
    const context = await resolveUserContext();
    if (!context) return { message: "Unauthorized" };

    const post = await db.blogPost.findUnique({
        where: { id },
        select: { id: true, locationId: true },
    });
    if (!post) return { message: "Error deleting post" };

    const hasAccess = await assertLocationAccess(context.clerkUserId, post.locationId);
    if (!hasAccess) return { message: "Unauthorized" };

    try {
        await db.blogPost.delete({
            where: { id: post.id },
        });
        revalidatePath("/admin/content/posts");
        return { message: "Success" };
    } catch (e) {
        return { message: "Error deleting post" };
    }
}

export async function updateHomeConfig(prevState: any, formData: FormData) {
    const context = await resolveUserContext();
    if (!context) return { message: "Unauthorized", success: false };

    const locationId = String(formData.get("locationId") || "").trim();
    const blocksJson = formData.get("blocks") as string;

    if (!locationId) return { message: "Internal Error: No Location ID", success: false };

    const isAdmin = await assertLocationAdmin(context.clerkUserId, locationId);
    if (!isAdmin) {
        return { message: "Unauthorized", success: false };
    }

    let blocks: any[] = [];
    try {
        blocks = JSON.parse(blocksJson);
    } catch (e) {
        return { message: "Invalid Data format", success: false };
    }

    // --- TRANSFORM BLOCKS BACK TO SITE CONFIG ---

    // 1. Extract Hero Content
    const heroBlock = blocks.find(b => b.type === "hero");
    let heroContent = {};
    if (heroBlock) {
        // Strip block-specific fields if necessary, but SiteConfig.heroContent is JSON, so we can store it all
        // We might want to remove 'type', 'id' if they exist, but keeping them is harmless
        heroContent = { ...heroBlock };
    }

    // 2. Rebuild Home Sections Logic
    // We map the block list to the { id, type, enabled, order } structure
    const homeSections = blocks.map((block, index) => {
        let type = block.type;
        // Map block types to section types if they differ, but currently they match mostly
        // 'hero' -> 'hero'
        // 'featured-properties' -> 'featured-properties'
        // 'trusted-partners' -> 'trusted-partners'

        // Use a stable ID if possible, or generate one
        const id = block.id || block.type;

        return {
            ...block, // CRITICAL: Preserve all block data (items, title, filter, etc.)
            id: id,
            type: type,
            enabled: block.enabled !== false, // Default to true unless explicitly disabled
            order: index
        };
    });

    console.log("[updateHomeConfig] Saving homeSections count:", homeSections.length);
    const categoriesSection = homeSections.find(s => s.type === 'categories');
    if (categoriesSection) {
        console.log("[updateHomeConfig] Categories Section Items:", (categoriesSection as any).items?.length);
    }

    try {
        const existingDoc = await settingsService.getDocument<any>({
            scopeType: "LOCATION",
            scopeId: locationId,
            domain: SETTINGS_DOMAINS.LOCATION_CONTENT,
        });
        const existingPayload = existingDoc?.payload || {};

        const payload = {
            ...existingPayload,
            heroContent: heroContent as any,
            homeSections: homeSections as any,
        };

        await settingsService.upsertDocument({
            scopeType: "LOCATION",
            scopeId: locationId,
            domain: SETTINGS_DOMAINS.LOCATION_CONTENT,
            payload,
            actorUserId: context.localUserId,
            schemaVersion: 1,
        });

        if (isSettingsDualWriteLegacyEnabled()) {
            await db.siteConfig.upsert({
                where: { locationId },
                create: {
                    locationId,
                    heroContent: heroContent as any,
                    homeSections: homeSections as any,
                },
                update: {
                    heroContent: heroContent as any,
                    homeSections: homeSections as any,
                },
            });
        }

        if (isSettingsDualWriteLegacyEnabled() && isSettingsParityCheckEnabled()) {
            const legacySiteConfig = await db.siteConfig.findUnique({
                where: { locationId },
                select: {
                    heroContent: true,
                    homeSections: true,
                    favoritesConfig: true,
                    searchConfig: true,
                    submissionsConfig: true,
                },
            });
            await settingsService.checkDocumentParity({
                scopeType: "LOCATION",
                scopeId: locationId,
                domain: SETTINGS_DOMAINS.LOCATION_CONTENT,
                legacyPayload: {
                    heroContent: legacySiteConfig?.heroContent ?? null,
                    homeSections: legacySiteConfig?.homeSections ?? [],
                    favoritesConfig: legacySiteConfig?.favoritesConfig ?? null,
                    searchConfig: legacySiteConfig?.searchConfig ?? null,
                    submissionsConfig: legacySiteConfig?.submissionsConfig ?? null,
                },
                actorUserId: context.localUserId,
            });
        }
    } catch (e) {
        console.error("Failed to update home config", e);
        return { message: "Database update failed", success: false };
    }

    revalidatePath(`/`); // Revalidate home page
    revalidatePath(`/admin/content/home`);

    return { message: "Home Page updated successfully", success: true };
}

export async function updateFavoritesConfig(prevState: any, formData: FormData) {
    const context = await resolveUserContext();
    if (!context) return { success: false, message: "Unauthorized" };

    const locationId = String(formData.get("locationId") || "").trim();
    if (!locationId) return { success: false, message: "Missing location" };

    const isAdmin = await assertLocationAdmin(context.clerkUserId, locationId);
    if (!isAdmin) return { success: false, message: "Unauthorized" };

    const favoritesConfig = {
        title: nullableString(formData.get("title")),
        emptyTitle: nullableString(formData.get("emptyTitle")),
        emptyBody: nullableString(formData.get("emptyBody")),
        headerStyle: nullableString(formData.get("headerStyle")),
        heroImage: nullableString(formData.get("heroImage")),
        metaTitle: nullableString(formData.get("metaTitle")),
        metaDescription: nullableString(formData.get("metaDescription")),
    };

    try {
        const existingDoc = await settingsService.getDocument<any>({
            scopeType: "LOCATION",
            scopeId: locationId,
            domain: SETTINGS_DOMAINS.LOCATION_CONTENT,
        });
        const payload = {
            ...(existingDoc?.payload || {}),
            favoritesConfig,
        };

        await settingsService.upsertDocument({
            scopeType: "LOCATION",
            scopeId: locationId,
            domain: SETTINGS_DOMAINS.LOCATION_CONTENT,
            payload,
            actorUserId: context.localUserId,
            schemaVersion: 1,
        });

        if (isSettingsDualWriteLegacyEnabled()) {
            await db.siteConfig.upsert({
                where: { locationId },
                create: { locationId, favoritesConfig },
                update: { favoritesConfig },
            });
        }

        if (isSettingsDualWriteLegacyEnabled() && isSettingsParityCheckEnabled()) {
            const legacySiteConfig = await db.siteConfig.findUnique({
                where: { locationId },
                select: {
                    heroContent: true,
                    homeSections: true,
                    favoritesConfig: true,
                    searchConfig: true,
                    submissionsConfig: true,
                },
            });
            await settingsService.checkDocumentParity({
                scopeType: "LOCATION",
                scopeId: locationId,
                domain: SETTINGS_DOMAINS.LOCATION_CONTENT,
                legacyPayload: {
                    heroContent: legacySiteConfig?.heroContent ?? null,
                    homeSections: legacySiteConfig?.homeSections ?? [],
                    favoritesConfig: legacySiteConfig?.favoritesConfig ?? null,
                    searchConfig: legacySiteConfig?.searchConfig ?? null,
                    submissionsConfig: legacySiteConfig?.submissionsConfig ?? null,
                },
                actorUserId: context.localUserId,
            });
        }

        revalidatePath(`/admin/content/favorites`);
        return { success: true, message: "Favorites configuration saved" };
    } catch (error) {
        console.error("Failed to update favorites config:", error);
        return { success: false, message: "Failed to save configuration" };
    }
}

export async function updateSearchConfig(prevState: any, formData: FormData) {
    const context = await resolveUserContext();
    if (!context) return { success: false, message: "Unauthorized" };

    const locationId = String(formData.get("locationId") || "").trim();
    if (!locationId) return { success: false, message: "Missing location" };

    const isAdmin = await assertLocationAdmin(context.clerkUserId, locationId);
    if (!isAdmin) return { success: false, message: "Unauthorized" };

    const searchConfig = {
        metaTitle: nullableString(formData.get("metaTitle")),
        metaDescription: nullableString(formData.get("metaDescription")),
        emptyTitle: nullableString(formData.get("emptyTitle")),
        emptyBody: nullableString(formData.get("emptyBody")),
        headerStyle: nullableString(formData.get("headerStyle")),
        heroImage: nullableString(formData.get("heroImage")),
    };

    try {
        const existingDoc = await settingsService.getDocument<any>({
            scopeType: "LOCATION",
            scopeId: locationId,
            domain: SETTINGS_DOMAINS.LOCATION_CONTENT,
        });
        const payload = {
            ...(existingDoc?.payload || {}),
            searchConfig,
        };

        await settingsService.upsertDocument({
            scopeType: "LOCATION",
            scopeId: locationId,
            domain: SETTINGS_DOMAINS.LOCATION_CONTENT,
            payload,
            actorUserId: context.localUserId,
            schemaVersion: 1,
        });

        if (isSettingsDualWriteLegacyEnabled()) {
            await db.siteConfig.upsert({
                where: { locationId },
                create: { locationId, searchConfig },
                update: { searchConfig },
            });
        }

        if (isSettingsDualWriteLegacyEnabled() && isSettingsParityCheckEnabled()) {
            const legacySiteConfig = await db.siteConfig.findUnique({
                where: { locationId },
                select: {
                    heroContent: true,
                    homeSections: true,
                    favoritesConfig: true,
                    searchConfig: true,
                    submissionsConfig: true,
                },
            });
            await settingsService.checkDocumentParity({
                scopeType: "LOCATION",
                scopeId: locationId,
                domain: SETTINGS_DOMAINS.LOCATION_CONTENT,
                legacyPayload: {
                    heroContent: legacySiteConfig?.heroContent ?? null,
                    homeSections: legacySiteConfig?.homeSections ?? [],
                    favoritesConfig: legacySiteConfig?.favoritesConfig ?? null,
                    searchConfig: legacySiteConfig?.searchConfig ?? null,
                    submissionsConfig: legacySiteConfig?.submissionsConfig ?? null,
                },
                actorUserId: context.localUserId,
            });
        }

        revalidatePath(`/admin/content/search`);
        return { success: true, message: "Search configuration saved" };
    } catch (error) {
        console.error("Failed to update search config:", error);
        return { success: false, message: "Failed to save configuration" };
    }
}

export async function updateSubmissionsConfig(prevState: any, formData: FormData) {
    const context = await resolveUserContext();
    if (!context) return { success: false, message: "Unauthorized" };

    const locationId = String(formData.get("locationId") || "").trim();
    if (!locationId) return { success: false, message: "Missing location" };

    const isAdmin = await assertLocationAdmin(context.clerkUserId, locationId);
    if (!isAdmin) return { success: false, message: "Unauthorized" };

    const submissionsConfig = {
        title: nullableString(formData.get("title")),
        metaTitle: nullableString(formData.get("metaTitle")),
        metaDescription: nullableString(formData.get("metaDescription")),
        emptyTitle: nullableString(formData.get("emptyTitle")),
        emptyBody: nullableString(formData.get("emptyBody")),
        headerStyle: nullableString(formData.get("headerStyle")),
        heroImage: nullableString(formData.get("heroImage")),
    };

    try {
        const existingDoc = await settingsService.getDocument<any>({
            scopeType: "LOCATION",
            scopeId: locationId,
            domain: SETTINGS_DOMAINS.LOCATION_CONTENT,
        });
        const payload = {
            ...(existingDoc?.payload || {}),
            submissionsConfig,
        };

        await settingsService.upsertDocument({
            scopeType: "LOCATION",
            scopeId: locationId,
            domain: SETTINGS_DOMAINS.LOCATION_CONTENT,
            payload,
            actorUserId: context.localUserId,
            schemaVersion: 1,
        });

        if (isSettingsDualWriteLegacyEnabled()) {
            await db.siteConfig.upsert({
                where: { locationId },
                create: { locationId, submissionsConfig },
                update: { submissionsConfig },
            });
        }

        if (isSettingsDualWriteLegacyEnabled() && isSettingsParityCheckEnabled()) {
            const legacySiteConfig = await db.siteConfig.findUnique({
                where: { locationId },
                select: {
                    heroContent: true,
                    homeSections: true,
                    favoritesConfig: true,
                    searchConfig: true,
                    submissionsConfig: true,
                },
            });
            await settingsService.checkDocumentParity({
                scopeType: "LOCATION",
                scopeId: locationId,
                domain: SETTINGS_DOMAINS.LOCATION_CONTENT,
                legacyPayload: {
                    heroContent: legacySiteConfig?.heroContent ?? null,
                    homeSections: legacySiteConfig?.homeSections ?? [],
                    favoritesConfig: legacySiteConfig?.favoritesConfig ?? null,
                    searchConfig: legacySiteConfig?.searchConfig ?? null,
                    submissionsConfig: legacySiteConfig?.submissionsConfig ?? null,
                },
                actorUserId: context.localUserId,
            });
        }

        revalidatePath(`/admin/content/submissions`);
        return { success: true, message: "Submissions configuration saved" };
    } catch (error) {
        console.error("Failed to update submissions config:", error);
        return { success: false, message: "Failed to save configuration" };
    }
}
