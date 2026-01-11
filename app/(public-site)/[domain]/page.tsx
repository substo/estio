import { getSiteConfig, getFeaturedProperties, getCategoryCounts } from "@/lib/public-data";
import { notFound } from "next/navigation";
import { HeroSection } from "./_components/hero-section";
import { FeaturedProperties } from "./_components/featured-properties";
import { TrustedPartnerSection } from "./_components/trusted-partner-section";
import { CategoriesSection } from "../_components/categories-section";
import { PublicBlockRenderer } from "../_components/public-block-renderer";


type HomeSectionConfig = {
    id: string;
    type: 'hero' | 'featured-properties' | 'trusted-partners' | 'categories';
    enabled: boolean;
    order: number;
};

const defaultSections: HomeSectionConfig[] = [
    { id: 'hero', type: 'hero', enabled: true, order: 0 },
    { id: 'categories', type: 'categories', enabled: true, order: 0.5 }, // Between Hero and Featured
    { id: 'featured', type: 'featured-properties', enabled: true, order: 1 },
    { id: 'partners', type: 'trusted-partners', enabled: true, order: 2 },
];

export default async function PublicHomePage(props: { params: Promise<{ domain: string }> }) {
    const params = await props.params;
    const config = await getSiteConfig(params.domain);
    if (!config) notFound();



    const theme = config.theme as any | null;
    const primaryColor = theme?.primaryColor;

    // Determine sections to render
    // Cast to any to avoid TS error until VS Code picks up the new Prisma Client types
    const sectionsConfig = (config as any).homeSections;
    let sections: HomeSectionConfig[] = (sectionsConfig as HomeSectionConfig[]) || defaultSections;

    // Sort by order
    sections.sort((a, b) => a.order - b.order);

    // Find Categories Block Config
    const categoriesBlock = sections.find(s => s.type === 'categories') as any;

    // Fetch Data with Config (if any)
    const featuredProperties = await getFeaturedProperties(config.locationId);
    const categoryCounts = await getCategoryCounts(config.locationId, categoriesBlock);

    return (
        <main>
            {sections.map(section => {
                if (!section.enabled) return null;

                switch (section.type) {
                    case 'hero':
                        return <HeroSection key={section.id} siteConfig={config} />;
                    case 'categories':
                        return (
                            <CategoriesSection
                                key={section.id}
                                data={categoryCounts}
                                title={(section as any).title} // Pass configured title
                                primaryColor={primaryColor}
                            />
                        );
                    case 'featured-properties':
                        return (
                            <FeaturedProperties
                                key={section.id}
                                properties={featuredProperties}
                                primaryColor={primaryColor}
                                domain={params.domain}
                            />
                        );
                    case 'trusted-partners':
                        return (
                            <TrustedPartnerSection
                                key={section.id}
                                primaryColor={primaryColor}
                                brandName={theme?.logo?.textTop ? `${theme.logo.textTop} ${(theme.logo.textBottom || '').replace('REAL ESTATE AGENCY', '')}` : "Down Town Cyprus"}
                            />
                        );
                    default:
                        // Use the Generic Block Renderer for AI-generated or other section types
                        return <PublicBlockRenderer key={section.id} blocks={[section]} siteConfig={config} />;
                }
            })}
        </main>
    );
}
