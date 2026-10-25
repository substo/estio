import { getSiteConfig } from "@/lib/public-data";
import db from "@/lib/db";
import { notFound } from "next/navigation";
import { Metadata } from "next";
import { WebsitePageView } from "@/components/website/page-view";

interface Props {
    params: Promise<{ domain: string; slug: string }>;
}

// 1. Helper to fetch page
async function getPublicPage(locationId: string, slug: string) {
    return await db.contentPage.findFirst({
        where: {
            locationId,
            slug,
            published: true,
        },
    });
}

// 2. Metadata
export async function generateMetadata(props: Props): Promise<Metadata> {
    const params = await props.params;
    const config = await getSiteConfig(params.domain);
    if (!config) return {};

    const page = await getPublicPage(config.locationId, params.slug);
    if (!page) return {};

    const seoTitle = (page as any).metaTitle || page.title;
    const seoDescription = (page as any).metaDescription;

    return {
        title: `${seoTitle} | ${config.location.name ?? 'Real Estate'}`,
        description: seoDescription || undefined,
    };
}

// 3. Component
export default async function GenericPage(props: Props) {
    const params = await props.params;
    const config = await getSiteConfig(params.domain);
    if (!config) notFound();

    const page = await getPublicPage(config.locationId, params.slug);

    if (!page) {
        // If no generic page found, this is a true 404
        notFound();
    }

    return <WebsitePageView page={page} config={config} />;
}
