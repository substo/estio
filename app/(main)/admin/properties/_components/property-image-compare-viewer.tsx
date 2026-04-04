"use client";

import { useId, useState } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

interface PropertyImageCompareViewerProps {
    beforeSrc: string;
    afterSrc: string;
    alt: string;
    className?: string;
}

export function PropertyImageCompareViewer({
    beforeSrc,
    afterSrc,
    alt,
    className,
}: PropertyImageCompareViewerProps) {
    const [position, setPosition] = useState(50);
    const [showOriginal, setShowOriginal] = useState(false);
    const sliderId = useId();

    return (
        <div className={cn("space-y-3", className)}>
            <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>Original</span>
                <span>Edited</span>
            </div>

            <div className="relative overflow-hidden rounded-lg border bg-black/90">
                <div className="relative aspect-video w-full">
                    <img
                        src={beforeSrc}
                        alt={`${alt} original`}
                        className="absolute inset-0 h-full w-full select-none object-contain"
                        draggable={false}
                    />

                    {!showOriginal ? (
                        <>
                            <div
                                className="absolute inset-0 overflow-hidden"
                                style={{ clipPath: `inset(0 0 0 ${position}%)` }}
                            >
                                <img
                                    src={afterSrc}
                                    alt={`${alt} edited`}
                                    className="absolute inset-0 h-full w-full select-none object-contain"
                                    draggable={false}
                                />
                            </div>

                            <div
                                className="pointer-events-none absolute inset-y-0 z-10"
                                style={{ left: `${position}%` }}
                            >
                                <div className="absolute inset-y-0 w-px -translate-x-1/2 bg-white/90 shadow-[0_0_0_1px_rgba(0,0,0,0.3)]" />
                                <div className="absolute left-1/2 top-1/2 flex h-10 w-10 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-white/80 bg-black/70 text-white shadow-lg">
                                    <span className="text-lg leading-none">|</span>
                                </div>
                            </div>
                        </>
                    ) : null}

                    <label htmlFor={sliderId} className="sr-only">Compare original and edited image</label>
                    <input
                        id={sliderId}
                        type="range"
                        min={0}
                        max={100}
                        value={position}
                        onChange={(event) => setPosition(Number(event.target.value))}
                        className={cn(
                            "absolute inset-0 z-20 h-full w-full cursor-ew-resize opacity-0",
                            showOriginal ? "pointer-events-none" : ""
                        )}
                        aria-label="Before after comparison slider"
                    />

                    <div className="absolute bottom-3 left-3 right-3 flex items-center justify-between gap-2">
                        <div className="rounded-full bg-black/60 px-2 py-1 text-[11px] text-white">
                            Drag to compare
                        </div>
                        <Button
                            type="button"
                            variant="secondary"
                            size="sm"
                            className="md:hidden"
                            onClick={() => setShowOriginal((prev) => !prev)}
                        >
                            {showOriginal ? "Show Edited" : "Show Original"}
                        </Button>
                    </div>
                </div>
            </div>
        </div>
    );
}
