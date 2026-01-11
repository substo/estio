import db from "@/lib/db";
import { getLocationById } from "@/lib/location";
import Link from "next/link";
import ContactForm from "../../_components/contact-form";

export default async function PropertyDetailPage({ params, searchParams }: { params: { slug: string }, searchParams: { location?: string } }) {
    const locationId = searchParams.location;

    if (!locationId) {
        return <div className="p-4 text-red-500">Location ID is required</div>;
    }

    const location = await getLocationById(locationId);
    if (!location) {
        return <div className="p-4 text-red-500">Location not found</div>;
    }

    const property = await db.property.findUnique({
        where: { slug: params.slug },
        include: { media: true },
    });

    if (!property || property.locationId !== locationId) {
        return <div className="p-4 text-red-500">Property not found</div>;
    }

    const config = await db.siteConfig.findUnique({ where: { locationId } });
    const primaryColor = config?.primaryColor || "#000000";

    return (
        <div className="min-h-screen bg-gray-50 font-sans pb-10">
            {/* Header */}
            <div className="bg-white shadow-sm p-4 mb-6">
                <div className="max-w-6xl mx-auto">
                    <Link href={`/widget/search?location=${locationId}`} className="text-sm hover:underline flex items-center gap-1">
                        &larr; Back to Search
                    </Link>
                </div>
            </div>

            <div className="max-w-6xl mx-auto px-4 grid grid-cols-1 lg:grid-cols-3 gap-8">
                {/* Main Content */}
                <div className="lg:col-span-2 space-y-6">
                    {/* Media Gallery */}
                    <div className="bg-white rounded-lg overflow-hidden shadow-sm">
                        <div className="aspect-video bg-gray-200 relative">
                            {property.media[0] ? (
                                <img src={property.media[0].url} alt={property.title} className="w-full h-full object-cover" />
                            ) : (
                                <div className="flex items-center justify-center h-full text-gray-400">No Image</div>
                            )}
                        </div>
                        {property.media.length > 1 && (
                            <div className="p-2 flex gap-2 overflow-x-auto">
                                {property.media.map((m) => (
                                    <img key={m.id} src={m.url} alt="" className="w-20 h-20 object-cover rounded cursor-pointer border hover:border-blue-500" />
                                ))}
                            </div>
                        )}
                    </div>

                    {/* Details */}
                    <div className="bg-white rounded-lg p-6 shadow-sm">
                        <div className="flex justify-between items-start mb-4">
                            <div>
                                <h1 className="text-3xl font-bold mb-2">{property.title}</h1>
                                <p className="text-gray-500 text-lg">{property.addressLine1}, {property.city}, {property.propertyLocation}</p>
                            </div>
                            <div className="text-right">
                                <div className="text-2xl font-bold" style={{ color: primaryColor }}>
                                    {property.currency} {property.price?.toLocaleString()}
                                </div>
                                <div className="text-sm text-gray-500">{property.status}</div>
                            </div>
                        </div>

                        <div className="grid grid-cols-3 gap-4 border-y py-4 mb-6 text-center">
                            <div>
                                <span className="block font-bold text-xl">{property.bedrooms}</span>
                                <span className="text-gray-500 text-sm">Bedrooms</span>
                            </div>
                            <div>
                                <span className="block font-bold text-xl">{property.bathrooms}</span>
                                <span className="text-gray-500 text-sm">Bathrooms</span>
                            </div>
                            <div>
                                <span className="block font-bold text-xl">{property.areaSqm}</span>
                                <span className="text-gray-500 text-sm">m²</span>
                            </div>
                        </div>

                        <div className="prose max-w-none">
                            <h3 className="text-xl font-semibold mb-2">Description</h3>
                            <p className="whitespace-pre-wrap text-gray-700">{property.description}</p>
                        </div>
                    </div>
                </div>

                {/* Sidebar */}
                <div className="lg:col-span-1">
                    <div className="sticky top-6">
                        <ContactForm locationId={locationId} propertyId={property.id} primaryColor={primaryColor} />
                    </div>
                </div>
            </div>
        </div>
    );
}
