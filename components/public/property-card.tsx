import { getImageDeliveryUrl } from "@/lib/cloudflareImages";
import Link from "next/link";
import Image from "next/image";

interface PropertyProps {
    property: {
        title: string;
        price: number;
        bedrooms: number;
        bathrooms: number;
        images: string[];
        address: string;
        slug: string;
        // Optional media array from updated helper
        media?: { cloudflareImageId: string | null; url: string }[];
    };
    domain: string;
}

export function PropertyCard({ property, domain }: PropertyProps) {
    // Format price
    const price = new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
        maximumFractionDigits: 0,
    }).format(property.price);

    let imageUrl = "/placeholder-house.png";

    if (property.media && property.media.length > 0) {
        const mainImage = property.media[0];
        if (mainImage.cloudflareImageId) {
            imageUrl = getImageDeliveryUrl(mainImage.cloudflareImageId, "public");
        } else if (mainImage.url) {
            imageUrl = mainImage.url;
        }
    } else if (property.images && property.images.length > 0) {
        imageUrl = property.images[0];
    }

    return (
        <Link
            href={`/properties/${property.slug}`}
            className="group block border rounded-lg overflow-hidden bg-white shadow-sm hover:shadow-md transition-shadow"
        >
            <div className="relative aspect-video bg-gray-100">
                <Image
                    src={imageUrl}
                    alt={property.title}
                    fill
                    className="object-cover group-hover:scale-105 transition-transform duration-300"
                />
            </div>
            <div className="p-4 space-y-2">
                <div className="flex justify-between items-start">
                    <h3 className="font-semibold text-lg line-clamp-1">{property.title}</h3>
                    <p className="font-bold text-lg" style={{ color: 'var(--primary-brand)' }}>
                        {price}
                    </p>
                </div>
                <p className="text-sm text-gray-500 line-clamp-1">{property.address}</p>
                <div className="flex gap-4 text-sm text-gray-600 pt-2 border-t mt-2">
                    <span>{property.bedrooms} Beds</span>
                    <span>{property.bathrooms} Baths</span>
                </div>
            </div>
        </Link>
    );
}
