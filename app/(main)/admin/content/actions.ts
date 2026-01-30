"use server";

import { auth } from "@clerk/nextjs/server";
import db from "@/lib/db";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { Prisma } from "@prisma/client";

// Reserved slugs to prevent breaking the app
const RESERVED_SLUGS = ["search", "property", "blog", "api", "dashboard", "sign-in"];

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
    const { userId } = await auth();
    console.log("[upsertPage] userId:", userId);

    if (!userId) return { message: "Unauthorized: No userId" };

    const user = await db.user.findUnique({ where: { clerkId: userId }, include: { locations: true } });
    console.log("[upsertPage] user locations count:", user?.locations?.length);

    const orgId = user?.locations[0]?.id;
    console.log("[upsertPage] Resolved orgId:", orgId);

    // Check if user has access to location (implicit via locationId being on user)
    if (!orgId) return { message: "Unauthorized: No Location" };


    const title = formData.get("title") as string;
    let slug = formData.get("slug") as string;
    const content = formData.get("content") as string; // Legacy/Fallback HTML
    const blocksJson = formData.get("blocks") as string; // JSON String of blocks
    const published = formData.get("published") === "on";
    const headerStyle = formData.get("headerStyle") as string || null;
    const heroImage = formData.get("heroImage") as string || null;
    const metaTitle = formData.get("metaTitle") as string || null;
    const metaDescription = formData.get("metaDescription") as string || null;
    const id = formData.get("id") as string | null;

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
            // --- IMAGE CLEANUP LOGIC ---
            // 1. Fetch existing page to get old blocks
            // Cast to any to handle potential stale Prisma definitions for 'blocks'
            // @ts-ignore
            const existingPage = await (db.contentPage as any).findUnique({
                where: { id },
                select: { blocks: true }
            });

            if (existingPage && existingPage.blocks) {
                const oldIds = extractImageIds(existingPage.blocks);
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
                    locationId: orgId,
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
    const { userId } = await auth();
    if (!userId) return { message: "Unauthorized" };
    const user = await db.user.findUnique({ where: { clerkId: userId }, include: { locations: true } });
    const orgId = user?.locations[0]?.id;

    // Check if user has access to location (implicit via locationId being on user)
    if (!orgId) return { message: "Unauthorized: No Location" };

    try {
        await db.contentPage.delete({
            where: {
                id,
                locationId: orgId, // Ensure ownership
            },
        });
        revalidatePath("/admin/content/pages");
        return { message: "Success" };
    } catch (e) {
        return { message: "Error deleting page" };
    }
}

export async function upsertPost(prevState: any, formData: FormData) {
    const { userId } = await auth();
    if (!userId) return { message: "Unauthorized" };
    const user = await db.user.findUnique({ where: { clerkId: userId }, include: { locations: true } });
    const orgId = user?.locations[0]?.id;

    // Check if user has access to location (implicit via locationId being on user)
    if (!orgId) return { message: "Unauthorized: No Location" };

    const title = formData.get("title") as string;
    let slug = formData.get("slug") as string;
    const content = formData.get("content") as string;
    const coverImage = formData.get("coverImage") as string;
    const published = formData.get("published") === "on";
    const id = formData.get("id") as string | null;

    slug = slug.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");

    if (RESERVED_SLUGS.includes(slug)) {
        return { message: `The slug '${slug}' is reserved.` };
    }

    try {
        const data = {
            locationId: orgId,
            title,
            slug,
            content,
            coverImage,
            published,
            publishedAt: published ? new Date() : null, // Simple logic: set date on publish
        };

        if (id) {
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
    const { userId } = await auth();
    if (!userId) return { message: "Unauthorized" };
    const user = await db.user.findUnique({ where: { clerkId: userId }, include: { locations: true } });
    const orgId = user?.locations[0]?.id;

    // Check if user has access to location (implicit via locationId being on user)
    if (!orgId) return { message: "Unauthorized: No Location" };

    try {
        await db.blogPost.delete({
            where: { id, locationId: orgId },
        });
        revalidatePath("/admin/content/posts");
        return { message: "Success" };
    } catch (e) {
        return { message: "Error deleting post" };
    }
}

export async function updateHomeConfig(prevState: any, formData: FormData) {
    const { userId } = await auth();
    if (!userId) return { message: "Unauthorized", success: false };

    const locationId = formData.get("locationId") as string;
    const blocksJson = formData.get("blocks") as string;

    if (!locationId) return { message: "Internal Error: No Location ID", success: false };

    // Verify ownership
    const user = await db.user.findUnique({ where: { clerkId: userId }, include: { locations: true } });
    if (!user?.locations.some(l => l.id === locationId)) {
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
        await db.siteConfig.update({
            where: { locationId },
            data: {
                heroContent: heroContent as any, // Cast to any for JSON
                homeSections: homeSections as any
            } as any
        });
    } catch (e) {
        console.error("Failed to update home config", e);
        return { message: "Database update failed", success: false };
    }

    revalidatePath(`/`); // Revalidate home page
    revalidatePath(`/admin/content/home`);

    return { message: "Home Page updated successfully", success: true };
}

export async function updateFavoritesConfig(prevState: any, formData: FormData) {
    const { userId } = await auth();
    if (!userId) return { success: false, message: "Unauthorized" };

    const locationId = formData.get("locationId") as string;

    const favoritesConfig = {
        title: formData.get("title"),
        emptyTitle: formData.get("emptyTitle"),
        emptyBody: formData.get("emptyBody"),
        headerStyle: formData.get("headerStyle"),
        heroImage: formData.get("heroImage"),
        metaTitle: formData.get("metaTitle"),
        metaDescription: formData.get("metaDescription"),
    };

    try {
        await db.siteConfig.update({
            where: { locationId },
            data: {
                favoritesConfig
            } as any
        });

        revalidatePath(`/admin/content/favorites`);
        return { success: true, message: "Favorites configuration saved" };
    } catch (error) {
        console.error("Failed to update favorites config:", error);
        return { success: false, message: "Failed to save configuration" };
    }
}

export async function updateSearchConfig(prevState: any, formData: FormData) {
    const { userId } = await auth();
    if (!userId) return { success: false, message: "Unauthorized" };

    const locationId = formData.get("locationId") as string;

    const searchConfig = {
        metaTitle: formData.get("metaTitle"),
        metaDescription: formData.get("metaDescription"),
        emptyTitle: formData.get("emptyTitle"),
        emptyBody: formData.get("emptyBody"),
        headerStyle: formData.get("headerStyle"),
        heroImage: formData.get("heroImage"),
    };

    try {
        await db.siteConfig.update({
            where: { locationId },
            data: {
                searchConfig
            } as any
        });

        revalidatePath(`/admin/content/search`);
        return { success: true, message: "Search configuration saved" };
    } catch (error) {
        console.error("Failed to update search config:", error);
        return { success: false, message: "Failed to save configuration" };
    }
}

export async function updateSubmissionsConfig(prevState: any, formData: FormData) {
    const { userId } = await auth();
    if (!userId) return { success: false, message: "Unauthorized" };

    const locationId = formData.get("locationId") as string;

    const submissionsConfig = {
        title: formData.get("title"),
        metaTitle: formData.get("metaTitle"),
        metaDescription: formData.get("metaDescription"),
        emptyTitle: formData.get("emptyTitle"),
        emptyBody: formData.get("emptyBody"),
        headerStyle: formData.get("headerStyle"),
        heroImage: formData.get("heroImage"),
    };

    try {
        await db.siteConfig.update({
            where: { locationId },
            data: {
                submissionsConfig
            } as any
        });

        revalidatePath(`/admin/content/submissions`);
        return { success: true, message: "Submissions configuration saved" };
    } catch (error) {
        console.error("Failed to update submissions config:", error);
        return { success: false, message: "Failed to save configuration" };
    }
}
