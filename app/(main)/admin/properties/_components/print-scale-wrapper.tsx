"use client";

import { useEffect, useState, useRef, useCallback } from "react";

export function PrintScaleWrapper({
    widthMm,
    heightMm,
    fitMode = 'width',
    zoomScale = 1,
    children,
}: {
    widthMm: number;
    heightMm: number;
    fitMode?: 'width' | 'both';
    zoomScale?: number; // 1 means auto-fit according to fitMode. >1 means a specific zoom factor override.
    children: React.ReactNode;
}) {
    const [autoScale, setAutoScale] = useState<number | null>(null);
    const wrapperRef = useRef<HTMLDivElement>(null);

    // Calculate physical native footprint of the paper in pixels
    const pixelWidth = widthMm * 3.7795275591;
    const pixelHeight = heightMm * 3.7795275591;

    /**
     * Measure the PARENT element to get stable container dimensions that don't
     * depend on our own content size. This prevents the feedback loop where
     * scaled content → small wrapper → small measurement → smaller scale → …
     *
     * We observe the wrapper's parentElement which has its size determined by
     * the page layout (flex, grid, etc.) independently of our content.
     */
    const measure = useCallback(() => {
        const wrapper = wrapperRef.current;
        if (!wrapper) return;

        // Use the parent element's dimensions as the stable reference frame.
        // The parent's size is set by the outer layout and doesn't depend on
        // our content, so this avoids the circular dependency.
        const target = wrapper.parentElement;
        if (!target) return;

        const rect = target.getBoundingClientRect();
        const padding = 32;
        const availableWidth = Math.max(10, rect.width - padding);
        const availableHeight = Math.max(10, rect.height - padding);

        let scale = 1;

        if (fitMode === 'both') {
            const scaleW = availableWidth / pixelWidth;
            const scaleH = availableHeight / pixelHeight;
            scale = Math.min(scaleW, scaleH);
        } else {
            scale = availableWidth / pixelWidth;
        }

        // Cap at 1.0 (don't upscale beyond 100% physically if container is huge)
        setAutoScale(Math.min(1, scale));
    }, [widthMm, heightMm, fitMode, pixelWidth, pixelHeight]);

    useEffect(() => {
        const wrapper = wrapperRef.current;
        if (!wrapper) return;

        // Observe the PARENT element — its size is layout-determined and stable
        const target = wrapper.parentElement;
        if (!target) return;

        const observer = new ResizeObserver(() => {
            measure();
        });

        observer.observe(target);

        // Also measure immediately on mount
        measure();

        return () => {
            observer.disconnect();
        };
    }, [measure]);

    // When Zoom is forced by user (e.g. 100%), bypass the autoScale
    const isMeasured = autoScale !== null;
    const activeScale = zoomScale !== 1 ? zoomScale : (autoScale ?? 0.1);

    // Calculate final scaled dimensions
    const scaledWidth = pixelWidth * activeScale;
    const scaledHeight = pixelHeight * activeScale;

    return (
        /* The outermost wrapper — used as a ref anchor to find the parent for measurement */
        <div
            ref={wrapperRef}
            className="w-full flex-1 relative flex justify-center items-start print:block overflow-auto min-h-0"
        >
            {/* The scaled boundary box: enforces exact width/height of the scaled document in the DOM flow.
                Keeps scrollbars honest and prevents layout collapsing. */}
            <div 
                className={`print:!w-auto print:!h-auto transition-opacity duration-300 ${isMeasured || zoomScale !== 1 ? 'opacity-100' : 'opacity-0'}`}
                style={{ 
                    width: `${scaledWidth}px`, 
                    height: `${scaledHeight}px`,
                    flexShrink: 0
                }}
            >
                {/* The actual transform scaled content. Bounded cleanly inside the exact scaled dimensions above. */}
                <div
                    className="print:!transform-none print:w-auto print:h-auto transition-transform duration-200"
                    style={{
                        width: `${pixelWidth}px`,
                        height: `${pixelHeight}px`,
                        transform: `scale(${activeScale})`,
                        transformOrigin: "top left",
                    }}
                >
                    {children}
                </div>
            </div>
            
        </div>
    );
}
