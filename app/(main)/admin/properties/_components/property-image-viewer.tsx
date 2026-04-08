"use client";

import { useEffect, useMemo, useRef } from "react";
import { ChevronLeft, ChevronRight, Eye, X } from "lucide-react";
import * as VisuallyHidden from "@radix-ui/react-visually-hidden";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { CloudflareImage } from "@/components/media/CloudflareImage";
import {
    resolvePropertyImageDisplay,
    type PropertyImageLike,
} from "@/lib/properties/property-media-ai";
import { PropertyImageAiTags } from "./property-image-ai-tags";

export interface PropertyImageViewerProps {
    visibleImages: PropertyImageLike[];
    allImages: PropertyImageLike[];
    open: boolean;
    activeIndex: number;
    onOpenChange: (open: boolean) => void;
    onActiveIndexChange: (index: number) => void;
    persistentOriginalPreview: boolean;
    holdOriginalPreview: boolean;
    onPersistentOriginalPreviewChange: (next: boolean) => void;
    onHoldOriginalPreviewChange: (next: boolean) => void;
}

const HOLD_PREVIEW_MIN_MS = 300;

export function PropertyImageViewer({
    visibleImages,
    allImages,
    open,
    activeIndex,
    onOpenChange,
    onActiveIndexChange,
    persistentOriginalPreview,
    holdOriginalPreview,
    onPersistentOriginalPreviewChange,
    onHoldOriginalPreviewChange,
}: PropertyImageViewerProps) {
    const keyDownStartRef = useRef<number | null>(null);
    const safeIndex = Math.min(Math.max(activeIndex, 0), Math.max(visibleImages.length - 1, 0));
    const activeImage = visibleImages[safeIndex];

    const resolvedDisplay = useMemo(() => {
        if (!activeImage) return null;
        return resolvePropertyImageDisplay({
            item: activeImage,
            allImages: allImages as PropertyImageLike[],
            previewOriginal: persistentOriginalPreview || holdOriginalPreview,
        });
    }, [activeImage, allImages, holdOriginalPreview, persistentOriginalPreview]);

    const canNavigate = visibleImages.length > 1;
    const canPreviewOriginal = Boolean(resolvedDisplay?.canPreviewOriginal);
    const isPreviewingOriginal = Boolean(
        resolvedDisplay
        && canPreviewOriginal
        && resolvedDisplay.displayImage !== activeImage
    );

    const goNext = () => {
        if (!canNavigate) return;
        onActiveIndexChange((safeIndex + 1) % visibleImages.length);
    };

    const goPrev = () => {
        if (!canNavigate) return;
        onActiveIndexChange((safeIndex - 1 + visibleImages.length) % visibleImages.length);
    };

    const togglePersistentOriginalPreview = () => {
        if (!canPreviewOriginal) return;
        onPersistentOriginalPreviewChange(!persistentOriginalPreview);
    };

    useEffect(() => {
        if (!open) return;

        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === "Escape") {
                event.preventDefault();
                onOpenChange(false);
                return;
            }

            if (event.key === "ArrowRight") {
                event.preventDefault();
                goNext();
                return;
            }

            if (event.key === "ArrowLeft") {
                event.preventDefault();
                goPrev();
                return;
            }

            if (event.key.toLowerCase() === "o" && canPreviewOriginal) {
                if (!event.repeat) {
                    keyDownStartRef.current = Date.now();
                    onHoldOriginalPreviewChange(true);
                }
                event.preventDefault();
            }
        };

        const onKeyUp = (event: KeyboardEvent) => {
            if (event.key.toLowerCase() !== "o") return;
            if (!canPreviewOriginal) return;

            const startedAt = keyDownStartRef.current;
            keyDownStartRef.current = null;
            onHoldOriginalPreviewChange(false);

            if (!startedAt) {
                event.preventDefault();
                return;
            }

            const pressDuration = Date.now() - startedAt;
            if (pressDuration < HOLD_PREVIEW_MIN_MS) {
                onPersistentOriginalPreviewChange(!persistentOriginalPreview);
            }

            event.preventDefault();
        };

        window.addEventListener("keydown", onKeyDown);
        window.addEventListener("keyup", onKeyUp);

        return () => {
            window.removeEventListener("keydown", onKeyDown);
            window.removeEventListener("keyup", onKeyUp);
        };
    }, [
        canPreviewOriginal,
        onHoldOriginalPreviewChange,
        onOpenChange,
        onPersistentOriginalPreviewChange,
        persistentOriginalPreview,
        open,
    ]);

    useEffect(() => {
        if (!open) {
            keyDownStartRef.current = null;
            onHoldOriginalPreviewChange(false);
        }
    }, [onHoldOriginalPreviewChange, open]);

    if (!activeImage || !resolvedDisplay) {
        return null;
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-[95vw] w-full h-[95vh] p-0 border-none bg-black/95 shadow-none flex flex-col items-center justify-center outline-none">
                <VisuallyHidden.Root>
                    <DialogTitle>Property image viewer</DialogTitle>
                </VisuallyHidden.Root>

                <div className="absolute top-4 right-4 z-50 flex items-center gap-2">
                    {canPreviewOriginal ? (
                        <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="h-10 rounded-full border border-white/20 bg-black/50 px-4 text-white hover:bg-black/70"
                            onClick={togglePersistentOriginalPreview}
                        >
                            <Eye className="mr-1 h-4 w-4" />
                            {isPreviewingOriginal ? "Viewing Original" : "Preview Original"}
                        </Button>
                    ) : null}
                    <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="text-white hover:bg-white/20 rounded-full h-10 w-10"
                        onClick={() => onOpenChange(false)}
                        aria-label="Close image viewer"
                    >
                        <X className="h-6 w-6" />
                    </Button>
                </div>

                <div className="absolute top-4 left-4 z-40">
                    <PropertyImageAiTags
                        isAiGenerated={resolvedDisplay.isAiGenerated}
                        hasOriginalAvailable={resolvedDisplay.hasOriginalAvailable}
                    />
                </div>

                <div className="relative w-full h-full flex items-center justify-center">
                    <div className="relative w-full h-full p-4 md:p-10">
                        {resolvedDisplay.displayImage.cloudflareImageId ? (
                            <CloudflareImage
                                imageId={resolvedDisplay.displayImage.cloudflareImageId}
                                variant="public"
                                alt={`Property image ${safeIndex + 1}`}
                                fill
                                className="object-contain"
                                priority
                            />
                        ) : (
                            <img
                                src={resolvedDisplay.displayImage.url}
                                alt={`Property image ${safeIndex + 1}`}
                                className="h-full w-full object-contain"
                            />
                        )}
                    </div>

                    {canNavigate ? (
                        <>
                            <button
                                type="button"
                                onClick={goPrev}
                                className="absolute left-4 top-1/2 -translate-y-1/2 bg-black/50 hover:bg-black/70 text-white p-3 rounded-full transition-colors border border-white/10"
                                aria-label="Previous image"
                            >
                                <ChevronLeft className="h-8 w-8" />
                            </button>
                            <button
                                type="button"
                                onClick={goNext}
                                className="absolute right-4 top-1/2 -translate-y-1/2 bg-black/50 hover:bg-black/70 text-white p-3 rounded-full transition-colors border border-white/10"
                                aria-label="Next image"
                            >
                                <ChevronRight className="h-8 w-8" />
                            </button>
                        </>
                    ) : null}

                    <div className="absolute bottom-6 left-1/2 -translate-x-1/2 text-white bg-black/50 px-4 py-2 rounded-full backdrop-blur-md border border-white/10 text-sm">
                        {safeIndex + 1} / {visibleImages.length}
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    );
}
