import { getSiteConfig } from "@/lib/public-data";
import db from "@/lib/db";
import { notFound } from "next/navigation";
import { Metadata } from "next";
import { PublicBlockRenderer } from "../../_components/public-block-renderer";
import { SetHeaderStyle } from "../_components/header-context";

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

    // Check if we have legacy content or new blocks
    const hasBlocks = page.blocks && Array.isArray(page.blocks) && page.blocks.length > 0;
    const heroImage = (page as any).heroImage;
    const headerStyle = page.headerStyle;

    return (
        <div className="min-h-screen bg-slate-50">
            {headerStyle && <SetHeaderStyle style={headerStyle} />}

            {/* Optional Hero Section for Transparent Header */}
            {headerStyle === 'transparent' && heroImage && (
                <div className="relative h-[50vh] min-h-[350px] w-full flex items-center justify-center text-white">
                    <div
                        className="absolute inset-0 bg-cover bg-center"
                        style={{ backgroundImage: `url(${heroImage})` }}
                    >
                        <div className="absolute inset-0 bg-black/40" />
                    </div>
                    <div className="relative z-10 text-center px-4">
                        <h1 className="text-4xl md:text-5xl font-bold font-heading mb-4 drop-shadow-md">
                            {page.title}
                        </h1>
                    </div>
                </div>
            )}

            {/* If using new blocks, the renderer handles layout/containers per block. */}
            {hasBlocks ? (
                <PublicBlockRenderer blocks={page.blocks as any[]} siteConfig={config} />
            ) : (
                /* Legacy Layout for simple HTML content */
                <div className="container mx-auto px-4 py-12 max-w-4xl">
                    {/* Only show title here if no hero was shown */}
                    {!(headerStyle === 'transparent' && heroImage) && (
                        <div className="mb-8 text-center">
                            <h1 className="text-4xl font-bold tracking-tight">{page.title}</h1>
                        </div>
                    )}
                    <div
                        className="prose prose-lg max-w-none prose-headings:font-bold prose-a:text-blue-600"
                        dangerouslySetInnerHTML={{ __html: page.content || "" }}
                    />
                </div>
            )}
        </div>
    );
}
