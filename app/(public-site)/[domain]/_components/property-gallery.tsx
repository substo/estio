"use client";

import { useState } from "react";
import Image from "next/image";
import { cn } from "@/lib/utils";

interface PropertyGalleryProps {
    images: string[];
    title: string;
}

export function PropertyGallery({ images, title }: PropertyGalleryProps) {
    const [mainImage, setMainImage] = useState(images[0]);
    const [loading, setLoading] = useState(true);

    if (!images || images.length === 0) {
        return (
            <div className="w-full h-[400px] md:h-[500px] bg-gray-100 rounded-xl flex items-center justify-center text-gray-400">
                No Images Available
            </div>
        );
    }

    return (
        <div className="space-y-4">
            {/* Main Image */}
            <div className="relative w-full h-[400px] md:h-[500px] rounded-xl overflow-hidden shadow-sm bg-gray-100">
                <Image
                    src={mainImage}
                    alt={title}
                    fill
                    className={cn(
                        "object-cover transition-opacity duration-500",
                        loading ? "opacity-0" : "opacity-100"
                    )}
                    onLoad={() => setLoading(false)}
                    priority
                />
            </div>

            {/* Thumbnails (Only if more than 1 image) */}
            {images.length > 1 && (
                <div className="grid grid-cols-4 sm:grid-cols-5 md:grid-cols-6 gap-2">
                    {images.map((img, idx) => (
                        <button
                            key={idx}
                            onClick={() => {
                                setMainImage(img);
                                setLoading(true); // Reset loading for fade effect
                            }}
                            className={cn(
                                "relative aspect-square rounded-lg overflow-hidden border-2 transition-all",
                                mainImage === img ? "border-primary ring-2 ring-primary/20" : "border-transparent opacity-70 hover:opacity-100"
                            )}
                        >
                            <Image
                                src={img}
                                alt={`View ${idx + 1}`}
                                fill
                                className="object-cover"
                            />
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
}
