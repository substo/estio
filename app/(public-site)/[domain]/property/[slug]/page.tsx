import { getSiteConfig, getPublicPropertyBySlug } from "@/lib/public-data";
import { notFound } from "next/navigation";
import Image from "next/image";
import { Metadata } from "next";
import { getImageDeliveryUrl } from "@/lib/cloudflareImages";
import { LeadForm } from "@/components/public/lead-form";

interface Props {
    params: Promise<{ domain: string; slug: string }>;
}

// Helper to generate Schema
function generateJsonLd(property: any, domain: string) {
    // Get the best image
    let imageUrl = "/placeholder-house.png";
    if (property.media?.length && property.media[0].cloudflareImageId) {
        imageUrl = getImageDeliveryUrl(property.media[0].cloudflareImageId, "public");
    } else if (property.images?.length) {
        imageUrl = property.images[0];
    }

    const schema = {
        "@context": "https://schema.org",
        "@type": "RealEstateListing",
        "name": property.title,
        "description": property.description,
        "image": [imageUrl],
        "datePosted": property.createdAt,
        "url": `https://${domain}/property/${property.slug}`,
        "address": {
            "@type": "PostalAddress",
            "streetAddress": property.addressLine1,
            "addressLocality": property.city,
            "addressRegion": property.propertyLocation || "",
            "postalCode": property.postalCode,
            "addressCountry": property.country || "Cyprus"
        },
        "offers": {
            "@type": "Offer",
            "price": property.price,
            "priceCurrency": property.currency || "EUR",
            "availability": property.status === "ACTIVE" ? "https://schema.org/InStock" : "https://schema.org/Sold"
        },
        "numberOfRooms": property.bedrooms, // Approximate mapping
        "numberOfBathroomsTotal": property.bathrooms,
        "floorSize": {
            "@type": "QuantitativeValue",
            "value": property.areaSqm,
            "unitCode": "SQM"
        }
    };

    return schema;
}

export async function generateMetadata(props: Props): Promise<Metadata> {
    const params = await props.params;
    const config = await getSiteConfig(params.domain);
    if (!config) return {};
    const property = await getPublicPropertyBySlug(config.locationId, params.slug);
    if (!property) return { title: "Property Not Found" };

    // Resolve Image for Open Graph
    let ogImage = "/placeholder-house.png";
    if (property.media?.length && property.media[0].cloudflareImageId) {
        ogImage = getImageDeliveryUrl(property.media[0].cloudflareImageId, "public"); // or 'social' variant if exists
    } else if (property.images?.length) {
        ogImage = property.images[0];
    }

    const title = `${property.title} | ${config.location.name}`;
    const description = property.description?.slice(0, 160) || "View details for this property.";

    return {
        title,
        description,
        openGraph: {
            title,
            description,
            images: [{ url: ogImage, width: 1200, height: 630 }],
            type: "website",
        },
        twitter: {
            card: "summary_large_image",
            title,
            description,
            images: [ogImage],
        },
    };
}

export default async function PropertyDetailPage(props: Props) {
    const params = await props.params;
    // 1. Resolve Tenant
    const config = await getSiteConfig(params.domain);
    if (!config) notFound();

    // 2. Fetch Property (Scoped to Tenant)
    const property = await getPublicPropertyBySlug(config.locationId, params.slug);
    if (!property) notFound();

    const price = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(property.price || 0);

    // Helper to resolve image URL
    const getImageUrl = (index: number) => {
        if (property.media && property.media[index]) {
            const m = property.media[index];
            if (m.cloudflareImageId) return getImageDeliveryUrl(m.cloudflareImageId, "public");
            return m.url;
        }
        return property.images?.[index] || (index === 0 ? "/placeholder-house.png" : null);
    };

    const mainImageUrl = getImageUrl(0) || "/placeholder-house.png";
    const jsonLd = generateJsonLd(property, params.domain);

    return (
        <div className="container mx-auto px-4 py-8">
            {/* Inject Structured Data */}
            <script
                type="application/ld+json"
                dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
            />

            {/* Header */}
            <div className="mb-8">
                <h1 className="text-3xl md:text-4xl font-bold mb-2">{property.title}</h1>
                <p className="text-xl text-gray-500">{property.addressLine1} {property.city}</p>
            </div>

            {/* Image Gallery (Simple Grid) */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8 h-[400px] md:h-[500px]">
                {/* Main Image */}
                <div className="relative h-full w-full rounded-xl overflow-hidden bg-gray-100">
                    <Image
                        src={mainImageUrl}
                        alt={property.title}
                        fill
                        className="object-cover"
                        priority
                    />
                </div>
                {/* Secondary Images (Hidden on mobile for now) */}
                <div className="hidden md:grid grid-cols-2 gap-4 h-full">
                    {[1, 2, 3, 4].map((i) => {
                        const url = getImageUrl(i);
                        return (
                            <div key={i} className="relative h-full w-full rounded-xl overflow-hidden bg-gray-100">
                                {url && (
                                    <Image
                                        src={url}
                                        alt={`View ${i}`}
                                        fill
                                        className="object-cover"
                                    />
                                )}
                            </div>
                        );
                    })}
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-12">
                {/* Main Info */}
                <div className="lg:col-span-2 space-y-8">
                    <div className="flex gap-8 border-y py-6">
                        <div>
                            <span className="block text-2xl font-bold">{property.bedrooms}</span>
                            <span className="text-gray-500">Bedrooms</span>
                        </div>
                        <div>
                            <span className="block text-2xl font-bold">{property.bathrooms}</span>
                            <span className="text-gray-500">Bathrooms</span>
                        </div>
                        <div>
                            <span className="block text-2xl font-bold">{property.areaSqm || "-"}</span>
                            <span className="text-gray-500">Sqm</span>
                        </div>
                    </div>

                    <div>
                        <h2 className="text-2xl font-semibold mb-4">Description</h2>
                        <div className="prose max-w-none text-gray-700 whitespace-pre-line">
                            {property.description}
                        </div>
                    </div>
                </div>

                {/* Sidebar / Lead Capture */}
                <div className="lg:col-span-1">
                    <div className="border rounded-xl p-6 shadow-sm sticky top-24 bg-white">
                        <div className="mb-6">
                            <p className="text-gray-500 text-sm">List Price</p>
                            <p className="text-3xl font-bold" style={{ color: 'var(--primary-brand)' }}>{price}</p>
                        </div>

                        <div className="space-y-4">
                            <h3 className="font-semibold text-lg">Interested in this property?</h3>
                            <LeadForm domain={params.domain} propertyId={property.id} />

                            <p className="text-xs text-gray-400 text-center">
                                By submitting, you agree to share your info with the agent.
                            </p>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
