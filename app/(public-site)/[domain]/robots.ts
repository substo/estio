import { MetadataRoute } from "next";

export default async function robots({
    params,
}: {
    params: Promise<{ domain: string }>;
}): Promise<MetadataRoute.Robots> {
    const { domain } = await params;
    const baseUrl = `https://${domain}`;

    return {
        rules: {
            userAgent: "*",
            allow: "/",
            disallow: ["/api/", "/_next/"], // Protect API routes
        },
        sitemap: `${baseUrl}/sitemap.xml`,
    };
}
