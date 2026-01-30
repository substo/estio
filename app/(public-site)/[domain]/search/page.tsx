import { getSiteConfig, getPublicProperties } from "@/lib/public-data";
import { notFound } from "next/navigation";
import { PropertyCard } from "@/components/public/property-card";
import { SearchFilters } from "./_components/search-filters";

interface Props {
    params: Promise<{ domain: string }>;
    searchParams: Promise<{ [key: string]: string | undefined }>;
}

export default async function SearchPage(props: Props) {
    const params = await props.params;
    const searchParams = await props.searchParams;

    // 1. Resolve Tenant
    const config = await getSiteConfig(params.domain);
    if (!config) notFound();

    // 2. Parse Filters
    // Safely parse comma-separated lists into arrays
    const parseArray = (key: string) => searchParams[key]?.split(',').filter(Boolean) || [];

    const filters = {
        q: searchParams.q,
        status: searchParams.status,
        minPrice: searchParams.min_price ? Number(searchParams.min_price) : undefined,
        maxPrice: searchParams.max_price ? Number(searchParams.max_price) : undefined,
        reference: searchParams.reference,
        condition: searchParams.condition,
        // Advanced Arrays
        locations: parseArray('locations'),
        areas: parseArray('areas'),
        categories: parseArray('categories'),
        types: parseArray('types'),
        bedrooms: parseArray('bedrooms'),
        features: parseArray('features'),
    };

    // 3. Fetch Data
    const properties = await getPublicProperties(config.locationId, filters);

    return (
        <div className="container mx-auto px-4 py-8 space-y-8">

            {/* Search Filters Component */}
            <div className="space-y-4">
                <SearchFilters primaryColor={config.primaryColor || undefined} />

                <div className="flex items-center justify-between">
                    <h1 className="text-2xl font-bold">Property Search</h1>
                    <p className="text-gray-500 text-sm">Found {properties.length} results</p>
                </div>
            </div>

            {/* Grid */}
            {properties.length > 0 ? (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {properties.map((prop) => (
                        <PropertyCard
                            key={prop.id}
                            property={prop as any}
                            domain={params.domain}
                        />
                    ))}
                </div>
            ) : (
                <div className="text-center py-20 bg-gray-50 rounded-lg border border-dashed">
                    <h2 className="text-xl font-semibold">No properties found</h2>
                    <p className="text-gray-500 mt-2">Try adjusting your search filters to find what you're looking for.</p>
                </div>
            )}
        </div>
    );
}
