"use client";

import Image, { ImageProps } from "next/image";
import { getImageDeliveryUrl } from "@/lib/cloudflareImages";

interface CloudflareImageProps extends Omit<ImageProps, "src"> {
    imageId: string;
    variant?: string; // e.g. "public", "thumbnail", "avatar"
}

export function CloudflareImage({
    imageId,
    variant = "public",
    alt,
    ...props
}: CloudflareImageProps) {
    // If no imageId, we can return null or a placeholder. 
    // For robustness, let's gracefully handle missing ID.
    if (!imageId) return null;

    const src = getImageDeliveryUrl(imageId, variant);

    return (
        <Image
            src={src}
            alt={alt || "Property Image"}
            {...props}
        />
    );
}
