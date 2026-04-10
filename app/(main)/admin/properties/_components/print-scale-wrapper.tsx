"use client";

import { useEffect, useState, useRef } from "react";

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
    const [autoScale, setAutoScale] = useState(1);
    const containerRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const container = containerRef.current;
        if (!container) return;

        const observer = new ResizeObserver((entries) => {
            if (!entries[0]) return;
            const availableWidth = entries[0].contentRect.width;
            const availableHeight = entries[0].contentRect.height;
            
            const pixelWidth = widthMm * 3.7795275591;
            const pixelHeight = heightMm * 3.7795275591;
            
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
        });

        observer.observe(container);

        return () => {
            observer.disconnect();
        };
    }, [widthMm, heightMm, fitMode]);

    const activeScale = zoomScale !== 1 ? zoomScale : autoScale;

    // Calculate actual pixel footprint based on active scale
    const pixelWidth = widthMm * 3.7795275591;
    const pixelHeight = heightMm * 3.7795275591;
    const scaledWidth = pixelWidth * activeScale;
    const scaledHeight = pixelHeight * activeScale;

    return (
        <div ref={containerRef} className="w-full h-full flex justify-center items-center print:block print:w-auto print:h-auto overflow-hidden">
            <div
                className="print:!transform-none print:w-auto print:h-auto transition-transform duration-200"
                style={{
                    transform: `scale(${activeScale})`,
                    transformOrigin: "center center",
                    /* Make the wrapper precisely the scaled dimension so scrollbars (if any) wrap it perfectly */
                    width: `${pixelWidth}px`,
                    height: `${pixelHeight}px`,
                    /* margin offsets to cancel out the unscaled footprint */
                    marginBottom: `-${pixelHeight - scaledHeight}px`,
                    marginRight: `-${pixelWidth - scaledWidth}px`,
                    marginLeft: `-${pixelWidth - scaledWidth}px`,
                    marginTop: `-${pixelHeight - scaledHeight}px`
                }}
            >
                {children}
            </div>
        </div>
    );
}
