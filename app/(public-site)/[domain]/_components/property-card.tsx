"use client";

import Image from "next/image";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardFooter } from "@/components/ui/card";
import { Bed, Bath, PlusSquare, MapPin } from "lucide-react";
import { getImageDeliveryUrl } from "@/lib/cloudflareImages";
import { FavoriteButton } from "./favorite-button";


interface PropertyCardProps {
    property: any;
    domain: string;
    primaryColor?: string;
    isFavorited?: boolean;
    customHref?: string;
}

export function PropertyCard({ property, domain, primaryColor, isFavorited = false, customHref }: PropertyCardProps) {
    // 1. Image Data Logic
    const mainImage = property.media?.[0];
    const imageUrl = mainImage?.cloudflareImageId
        ? getImageDeliveryUrl(mainImage.cloudflareImageId, "public")
        : (mainImage?.url || property.images?.[0] || "/placeholder-house.png");

    const price = new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: property.currency || "EUR",
        maximumFractionDigits: 0
    }).format(property.price || 0);

    return (
        <Link href={customHref || `/properties/${property.slug}`}>
            <Card className="group overflow-hidden border-none shadow-md hover:shadow-xl transition-all duration-300 h-full flex flex-col">
                {/* Image Container with Hover Scale */}
                <div className="relative w-full aspect-[4/3] overflow-hidden">
                    <Image
                        src={imageUrl}
                        alt={property.title}
                        fill
                        className="object-cover transition-transform duration-500 group-hover:scale-110"
                    />
                    {/* Status Badge */}
                    <div className="absolute top-3 left-3">
                        <Badge className="uppercase tracking-wide font-bold bg-white/90 text-primary hover:bg-white shadow-sm">
                            {property.status}
                        </Badge>
                    </div>
                    {/* Favorite Button */}
                    <div className="absolute top-3 right-3">
                        <FavoriteButton
                            propertyId={property.id}
                            initialFavorited={isFavorited}
                            size="sm"
                        />
                    </div>
                </div>

                <CardContent className="flex-1 p-5 space-y-3">
                    {/* Price & Address */}
                    <div>
                        <p className="text-2xl font-bold text-primary group-hover:text-primary/80 transition-colors" style={{ color: primaryColor }}>
                            {price}
                        </p>
                        <h3 className="font-heading font-medium text-lg leading-tight line-clamp-1 mt-1 text-foreground">
                            {property.title}
                        </h3>
                        <p className="text-muted-foreground text-sm flex items-center mt-1">
                            <MapPin className="h-3 w-3 mr-1" />
                            {property.addressLine1}, {property.city}
                        </p>
                    </div>

                    {/* Features Row */}
                    <div className="flex items-center gap-4 text-sm text-foreground/80 pt-2 border-t mt-3">
                        <div className="flex items-center gap-1.5">
                            <Bed className="h-4 w-4 text-muted-foreground" />
                            <span className="font-semibold">{property.bedrooms}</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                            <Bath className="h-4 w-4 text-muted-foreground" />
                            <span className="font-semibold">{property.bathrooms}</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                            <PlusSquare className="h-4 w-4 text-muted-foreground" />
                            <span className="font-semibold">{property.areaSqm}m²</span>
                        </div>
                    </div>
                </CardContent>
            </Card>
        </Link>
    );
}

