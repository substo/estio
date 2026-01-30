import { auth } from "@clerk/nextjs/server";
import db from "@/lib/db";
import { HomePageForm } from "./home-page-form";
import { redirect } from "next/navigation";

type HomeSectionConfig = {
    id: string;
    type: 'hero' | 'featured-properties' | 'trusted-partners';
    enabled: boolean;
    order: number;
};

export default async function AdminHomePage() {
    const { userId } = await auth();
    if (!userId) return null;
    const user = await db.user.findUnique({ where: { clerkId: userId }, include: { locations: true } });
    const orgId = user?.locations[0]?.id;

    if (!orgId) return <div>Organization not found</div>;

    const siteConfig = await db.siteConfig.findUnique({
        where: { locationId: orgId },
        include: { location: true }
    });

    if (!siteConfig) return <div>Site Config not found</div>;

    // --- TRANSFORM SITE CONFIG TO BLOCKS ---
    const blocks: any[] = [];

    // Default fallback if no homeSections configured
    const defaultSections: HomeSectionConfig[] = [
        { id: 'hero', type: 'hero', enabled: true, order: 0 },
        { id: 'featured', type: 'featured-properties', enabled: true, order: 1 },
        { id: 'partners', type: 'trusted-partners', enabled: true, order: 2 },
    ];

    // @ts-ignore
    const homeSections = (siteConfig.homeSections as unknown as HomeSectionConfig[]) || defaultSections;

    // Sort sections by order
    const sortedSections = [...homeSections].sort((a, b) => a.order - b.order);

    for (const section of sortedSections) {
        if (!section.enabled) continue;

        if (section.type === 'hero') {
            // Rehydrate Hero Block from SiteConfig.heroContent
            const heroContent = siteConfig.heroContent as any || {};
            blocks.push({
                type: 'hero',
                ...heroContent,
                // Ensure layout defaults if missing
                layout: heroContent.layout || 'full-width',
            });
        } else {
            // System Blocks & Other Configurable Blocks (like Categories)
            blocks.push({
                ...section, // Spread all saved properties (items, title, etc.)
                type: section.type,
                enabled: true
            });
        }
    }


    return (
        <div className="p-6 space-y-6">
            <h1 className="text-2xl font-bold">Edit Home Page</h1>
            <HomePageForm initialBlocks={blocks} siteConfig={siteConfig} />
        </div>
    );
}
