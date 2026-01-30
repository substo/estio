"use client";

import { useState, useCallback, useEffect } from "react";
import Image from "next/image";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogClose, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight, X, Maximize2 } from "lucide-react";
import { cn } from "@/lib/utils";
import * as VisuallyHidden from "@radix-ui/react-visually-hidden";


interface PropertyGalleryProps {
    images: string[];
    title: string;
    status?: string | null;
    condition?: string | null;
    primaryColor?: string;
}

export function PropertyGallery({
    images,
    title,
    status,
    condition,
    primaryColor = 'var(--primary-brand)',
}: PropertyGalleryProps) {
    const [currentIndex, setCurrentIndex] = useState(0);
    const [isLightboxOpen, setIsLightboxOpen] = useState(false);

    // Prevent scrolling when lightbox is open (managed by Dialog usually but good to know)

    const handleNext = useCallback((e?: React.MouseEvent) => {
        e?.stopPropagation();
        setCurrentIndex((prev) => (prev + 1) % images.length);
    }, [images.length]);

    const handlePrev = useCallback((e?: React.MouseEvent) => {
        e?.stopPropagation();
        setCurrentIndex((prev) => (prev - 1 + images.length) % images.length);
    }, [images.length]);

    // Keyboard navigation for global (when lightbox open) or focused
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (isLightboxOpen) {
                if (e.key === "ArrowRight") handleNext();
                if (e.key === "ArrowLeft") handlePrev();
                if (e.key === "Escape") setIsLightboxOpen(false);
            }
        };

        window.addEventListener("keydown", handleKeyDown);
        return () => window.removeEventListener("keydown", handleKeyDown);
    }, [isLightboxOpen, handleNext, handlePrev]);

    if (!images || images.length === 0) {
        return (
            <div className="h-[500px] md:h-[600px] w-full bg-secondary/30 flex items-center justify-center rounded-sm">
                <span className="text-muted-foreground">No images available</span>
            </div>
        );
    }

    return (
        <>
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 h-[500px] md:h-[600px]">
                {/* Main Image */}
                <div
                    className="lg:col-span-2 h-full relative group overflow-hidden rounded-sm cursor-pointer"
                    onClick={() => setIsLightboxOpen(true)}
                >
                    <Image
                        src={images[currentIndex]}
                        alt={`${title} - View ${currentIndex + 1}`}
                        fill
                        className="object-cover transition-transform duration-500 group-hover:scale-105"
                        priority
                    />

                    {/* Status Badges */}
                    <div className="absolute top-4 left-4 flex gap-2 z-10">
                        {status && (
                            <Badge className="text-white border-0 uppercase tracking-wider font-bold rounded-sm px-3 py-1.5" style={{ backgroundColor: primaryColor }}>
                                {status}
                            </Badge>
                        )}
                        {condition && (
                            <Badge className="bg-white text-foreground border-0 font-bold rounded-sm px-3 py-1.5 shadow-md">
                                {condition}
                            </Badge>
                        )}
                    </div>

                    {/* Navigation Arrows (visible on hover) */}
                    {images.length > 1 && (
                        <>
                            <button
                                onClick={handlePrev}
                                className="absolute left-4 top-1/2 -translate-y-1/2 bg-black/30 hover:bg-black/50 text-white p-2 rounded-full opacity-0 group-hover:opacity-100 transition-opacity backdrop-blur-sm"
                                aria-label="Previous image"
                            >
                                <ChevronLeft className="h-6 w-6" />
                            </button>
                            <button
                                onClick={handleNext}
                                className="absolute right-4 top-1/2 -translate-y-1/2 bg-black/30 hover:bg-black/50 text-white p-2 rounded-full opacity-0 group-hover:opacity-100 transition-opacity backdrop-blur-sm"
                                aria-label="Next image"
                            >
                                <ChevronRight className="h-6 w-6" />
                            </button>
                        </>
                    )}

                    {/* Expand Hint */}
                    <div className="absolute bottom-4 right-4 opacity-0 group-hover:opacity-100 transition-opacity">
                        <Badge variant="secondary" className="gap-2 shadow-sm backdrop-blur-md bg-white/90 text-black pointer-events-none">
                            <Maximize2 className="h-3 w-3" /> Expand
                        </Badge>
                    </div>
                </div>

                {/* Thumbnails Grid */}
                <div className="hidden lg:grid grid-rows-3 gap-4 h-full">
                    {/* We only show the next 3 images in the timeline after current, or just fixed slots? 
                        The original design showed slots 1, 2, 3 (indices). 
                        Let's show the *next* 3 images wrapping around, so the user sees what's coming.
                        OR strictly indices 1, 2, 3 if static.
                        Let's stick to a static grid of indices 1, 2, 3 for stability, but allow clicking them.
                    */}
                    {[1, 2, 3].map((offset) => {
                        const targetIndex = (0 + offset) % images.length;
                        // If we don't have enough images, show placeholder?
                        if (offset >= images.length) {
                            return <div key={offset} className="bg-secondary/30 rounded-sm"></div>;
                        }

                        const imgUrl = images[targetIndex];
                        return (
                            <div
                                key={targetIndex}
                                className="relative overflow-hidden rounded-sm cursor-pointer hover:opacity-90 transition-opacity"
                                onClick={() => setCurrentIndex(targetIndex)}
                            >
                                <Image
                                    src={imgUrl}
                                    alt={`Thumbnail ${targetIndex + 1}`}
                                    fill
                                    className="object-cover"
                                />
                                {offset === 3 && images.length > 4 && (
                                    <div
                                        className="absolute inset-0 bg-black/50 flex items-center justify-center text-white font-bold text-lg hover:bg-black/60 transition-colors"
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            setIsLightboxOpen(true);
                                        }}
                                    >
                                        +{images.length - 4} Photos
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            </div>

            {/* Lightbox Dialog */}
            <Dialog open={isLightboxOpen} onOpenChange={setIsLightboxOpen}>
                <DialogContent className="max-w-[95vw] w-full h-[95vh] p-0 border-none bg-black/95 shadow-none flex flex-col items-center justify-center outline-none">
                    <VisuallyHidden.Root>
                        <DialogTitle>Image Gallery</DialogTitle>
                    </VisuallyHidden.Root>
                    <div className="absolute top-4 right-4 z-50">
                        <Button
                            variant="ghost"
                            size="icon"
                            className="text-white hover:bg-white/20 rounded-full h-10 w-10"
                            onClick={() => setIsLightboxOpen(false)}
                        >
                            <X className="h-6 w-6" />
                        </Button>
                    </div>

                    <div className="relative w-full h-full flex items-center justify-center">
                        {/* Large Image */}
                        <div className="relative w-full h-full p-4 md:p-10">
                            <Image
                                src={images[currentIndex]}
                                alt={title}
                                fill
                                className="object-contain"
                                priority
                                quality={90}
                            />
                        </div>

                        {/* Navigation Controls */}
                        {images.length > 1 && (
                            <>
                                <button
                                    onClick={handlePrev}
                                    className="absolute left-4 top-1/2 -translate-y-1/2 bg-black/50 hover:bg-black/70 text-white p-3 rounded-full transition-colors border border-white/10"
                                >
                                    <ChevronLeft className="h-8 w-8" />
                                </button>
                                <button
                                    onClick={handleNext}
                                    className="absolute right-4 top-1/2 -translate-y-1/2 bg-black/50 hover:bg-black/70 text-white p-3 rounded-full transition-colors border border-white/10"
                                >
                                    <ChevronRight className="h-8 w-8" />
                                </button>
                            </>
                        )}

                        {/* Footer Info */}
                        <div className="absolute bottom-6 left-1/2 -translate-x-1/2 text-white bg-black/50 px-4 py-2 rounded-full backdrop-blur-md border border-white/10">
                            {currentIndex + 1} / {images.length}
                        </div>
                    </div>
                </DialogContent>
            </Dialog>
        </>
    );
}
