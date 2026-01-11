import { getSiteConfig, getPublicProperties } from "@/lib/public-data";
import { notFound, redirect } from "next/navigation";
import { SearchResultsGrid } from "./_components/search-results-grid";
import { SearchFilters } from "./_components/search-filters";
import { getSavedSearch } from "@/app/actions/public-user";
import { SetHeaderStyle } from "../../_components/header-context";

interface Props {
    params: Promise<{ domain: string }>;
    searchParams: Promise<{ [key: string]: string | undefined }>;
}

export default async function SearchPage(props: Props) {
    const params = await props.params;
    const searchParams = await props.searchParams;

    // Handle saved search redirect
    if (searchParams.saved === 'true') {
        const savedSearch = await getSavedSearch();
        if (savedSearch.hasSearch) {
            redirect(`/properties/search?${savedSearch.queryString}`);
        } else {
            // No saved search, just show all properties
            redirect('/properties/search');
        }
    }

    // 1. Resolve Tenant
    const config = await getSiteConfig(params.domain);
    if (!config) notFound();

    // @ts-ignore
    const searchConfig = (config.searchConfig || {}) as any;
    const metaTitle = searchConfig.metaTitle || "Search Properties";
    const metaDescription = searchConfig.metaDescription || `Find your dream property in ${config.location?.name || "our listings"}`;

    // 2. Parse Filters
    const filters = {
        q: searchParams.q,

        // Use consistent parsing logic
        // Arrays (safely split if string, or handle undefined)
        categories: searchParams.categories?.split(',').filter(Boolean),
        types: searchParams.types?.split(',').filter(Boolean),
        locations: searchParams.locations?.split(',').filter(Boolean),
        areas: searchParams.areas?.split(',').filter(Boolean),
        bedrooms: searchParams.bedrooms?.split(',').filter(Boolean),
        features: searchParams.features?.split(',').filter(Boolean),

        // Single values
        status: searchParams.status,
        minPrice: searchParams.min_price ? Number(searchParams.min_price) : (searchParams.minPrice ? Number(searchParams.minPrice) : undefined),
        maxPrice: searchParams.max_price ? Number(searchParams.max_price) : (searchParams.maxPrice ? Number(searchParams.maxPrice) : undefined),
        condition: searchParams.condition,
        reference: searchParams.reference,
        filterBy: searchParams.filterBy,
        source: searchParams.source,
        budget: searchParams.budget,

        // Legacy fallback
        beds: searchParams.beds ? Number(searchParams.beds) : undefined,
    };

    // 3. Fetch Data
    // 3. Fetch Data
    const properties = await getPublicProperties(config.locationId, filters);

    // Visual Settings
    const headerStyle = searchConfig.headerStyle || "solid";
    const heroImage = searchConfig.heroImage;

    return (
        <div className="min-h-screen bg-gray-50/30 pb-20">
            {/* Dynamic Header Style Injection */}
            <SetHeaderStyle style={headerStyle} />

            {/* Optional Hero Section (if Transparent Header) */}
            {headerStyle === 'transparent' && heroImage ? (
                <div className="relative h-[40vh] min-h-[300px] w-full flex items-center justify-center text-white mb-8">
                    <div
                        className="absolute inset-0 bg-cover bg-center"
                        style={{ backgroundImage: `url(${heroImage})` }}
                    >
                        <div className="absolute inset-0 bg-black/40" />
                    </div>
                    <div className="relative z-10 text-center px-4">
                        <h1 className="text-4xl md:text-5xl font-bold font-heading mb-4 drop-shadow-md">
                            {metaTitle}
                        </h1>
                    </div>
                </div>
            ) : (
                // Spacer for sticky header if needed, or visual separator
                <div className="pb-8" />
            )}

            {/* Search Filters Component (Sticky & Full Width) */}
            <SearchFilters
                primaryColor={config.primaryColor || undefined}
                resultsCount={properties.length}
            />

            <div className="container mx-auto px-4 py-8 space-y-6">
                {/* Results Header */}
                <div className="flex items-center justify-between">
                    <h1 className="text-2xl font-bold uppercase tracking-tight text-gray-900">
                        {properties.length} Properties
                    </h1>
                </div>

                {/* Grid */}
                <SearchResultsGrid
                    properties={properties}
                    domain={params.domain}
                    emptyTitle={searchConfig.emptyTitle}
                    emptyBody={searchConfig.emptyBody}
                />
            </div>
        </div>
    );
}

export async function generateMetadata(props: Props) {
    const params = await props.params;
    const config = await getSiteConfig(params.domain);
    // @ts-ignore
    const searchConfig = (config?.searchConfig || {}) as any;

    return {
        title: searchConfig.metaTitle || `Search Properties | ${config?.location?.name || "Real Estate"}`,
        description: searchConfig.metaDescription || "Find your dream property.",
    };
}

