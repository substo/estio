import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import db from "@/lib/db";
import { getLocationById } from "@/lib/location";
import Link from "next/link";

export default async function WidgetSearchPage({ searchParams }: { searchParams: { location?: string, q?: string, minPrice?: string, maxPrice?: string, type?: string } }) {
    const locationId = searchParams.location;

    if (!locationId) {
        return <div className="p-4 text-red-500">Location ID is required</div>;
    }

    const location = await getLocationById(locationId);
    if (!location) {
        return <div className="p-4 text-red-500">Location not found</div>;
    }

    const config = await db.siteConfig.findUnique({ where: { locationId } });

    const where: any = { locationId, status: "ACTIVE" };
    if (searchParams.q) {
        where.OR = [
            { title: { contains: searchParams.q, mode: "insensitive" } },
            { city: { contains: searchParams.q, mode: "insensitive" } },
        ];
    }
    if (searchParams.minPrice) where.price = { ...where.price, gte: Number(searchParams.minPrice) };
    if (searchParams.maxPrice) where.price = { ...where.price, lte: Number(searchParams.maxPrice) };
    if (searchParams.type) where.type = { contains: searchParams.type, mode: "insensitive" };

    const properties = await db.property.findMany({
        where,
        orderBy: { createdAt: "desc" },
        include: { media: true },
    });

    const primaryColor = config?.primaryColor || "#000000";

    return (
        <div className="min-h-screen bg-gray-50 font-sans">
            {/* Header / Filter Bar */}
            <div className="p-4 shadow-sm bg-white sticky top-0 z-10">
                <form className="flex flex-wrap gap-2 items-center max-w-6xl mx-auto">
                    <input type="hidden" name="location" value={locationId} />
                    <Input name="q" placeholder="Search city, title..." defaultValue={searchParams.q} className="w-full sm:w-auto" />
                    <Input name="minPrice" type="number" placeholder="Min Price" defaultValue={searchParams.minPrice} className="w-24" />
                    <Input name="maxPrice" type="number" placeholder="Max Price" defaultValue={searchParams.maxPrice} className="w-24" />
                    <Button type="submit" style={{ backgroundColor: primaryColor }}>Search</Button>
                </form>
            </div>

            {/* Results */}
            <div className="max-w-6xl mx-auto p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
                {properties.length === 0 ? (
                    <div className="col-span-full text-center py-10 text-gray-500">No properties found matching your criteria.</div>
                ) : (
                    properties.map((property) => (
                        <Link key={property.id} href={`/widget/property/${property.slug}?location=${locationId}`} className="block group">
                            <div className="bg-white rounded-lg overflow-hidden shadow-sm hover:shadow-md transition-shadow border">
                                <div className="aspect-video bg-gray-200 relative overflow-hidden">
                                    {property.media[0] ? (
                                        <img src={property.media[0].url} alt={property.title} className="w-full h-full object-cover group-hover:scale-105 transition-transform" />
                                    ) : (
                                        <div className="flex items-center justify-center h-full text-gray-400">No Image</div>
                                    )}
                                    {property.featured && (
                                        <span className="absolute top-2 right-2 bg-yellow-400 text-xs font-bold px-2 py-1 rounded">Featured</span>
                                    )}
                                </div>
                                <div className="p-4">
                                    <h3 className="font-semibold text-lg truncate">{property.title}</h3>
                                    <p className="text-gray-500 text-sm mb-2">{property.city}, {property.propertyLocation}</p>
                                    <div className="flex justify-between items-center">
                                        <span className="font-bold text-lg" style={{ color: primaryColor }}>
                                            {property.currency} {property.price?.toLocaleString()}
                                        </span>
                                        <div className="text-xs text-gray-500 flex gap-2">
                                            <span>{property.bedrooms} bds</span>
                                            <span>{property.bathrooms} ba</span>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </Link>
                    ))
                )}
            </div>
        </div>
    );
}
