import { MetadataRoute } from "next";
import db from "@/lib/db";
import { getSiteConfig } from "@/lib/public-data";

// Limit sitemap size for performance
const MAX_PROPERTIES = 5000;

export default async function sitemap({
    params,
}: {
    params: Promise<{ domain: string }>;
}): Promise<MetadataRoute.Sitemap> {
    // 1. Resolve Tenant
    const { domain } = await params;
    const config = await getSiteConfig(domain);
    if (!config) return [];

    const baseUrl = `https://${domain}`;

    // 2. Static Routes (Home, Search)
    const routes: MetadataRoute.Sitemap = [
        {
            url: baseUrl,
            lastModified: new Date(),
            changeFrequency: "daily",
            priority: 1,
        },
        {
            url: `${baseUrl}/properties/search`,
            lastModified: new Date(),
            changeFrequency: "daily",
            priority: 0.8,
        },
    ];

    // 3. Dynamic Property Routes
    const properties = await db.property.findMany({
        where: {
            locationId: config.locationId,
            publicationStatus: "PUBLISHED", // Only public listings
        },
        select: {
            slug: true,
            updatedAt: true,
        },
        orderBy: { updatedAt: "desc" },
        take: MAX_PROPERTIES,
    });

    const propertyRoutes: MetadataRoute.Sitemap = properties.map((prop) => ({
        url: `${baseUrl}/properties/${prop.slug}`,
        lastModified: prop.updatedAt,
        changeFrequency: "weekly",
        priority: 0.9, // Real estate listings are high priority
    }));

    return [...routes, ...propertyRoutes];
}
