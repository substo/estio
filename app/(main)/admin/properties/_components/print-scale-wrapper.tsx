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
    // Default to a small scale initially to avoid jumping/oversize before measurement
    const [autoScale, setAutoScale] = useState(0.1); 
    const [isMeasured, setIsMeasured] = useState(false);
    const containerRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const container = containerRef.current;
        if (!container) return;

        const observer = new ResizeObserver((entries) => {
            if (!entries[0]) return;
            // Get available dimensions from the container wrapper
            // Remove some padding so it doesn't touch the exact edges
            const padding = 32;
            const availableWidth = Math.max(10, entries[0].contentRect.width - padding);
            const availableHeight = Math.max(10, entries[0].contentRect.height - padding);
            
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
            setIsMeasured(true);
        });

        observer.observe(container);

        return () => {
            observer.disconnect();
        };
    }, [widthMm, heightMm, fitMode]);

    // When Zoom is forced by user (e.g. 100%), bypass the autoScale
    const activeScale = zoomScale !== 1 ? zoomScale : autoScale;

    // Calculate physical native footprint of the paper in pixels
    const pixelWidth = widthMm * 3.7795275591;
    const pixelHeight = heightMm * 3.7795275591;
    
    // Calculate final scaled dimensions
    const scaledWidth = pixelWidth * activeScale;
    const scaledHeight = pixelHeight * activeScale;

    return (
        /* The outmost flex container allows center alignment if there's extra room */
        <div className="w-full flex-1 relative flex justify-center items-center print:block overflow-auto min-h-0">
            {/* Absolute observer div to independently track container true size without causing feedback loop with children */}
            <div ref={containerRef} className="absolute inset-0 pointer-events-none print:hidden drop-shadow-none bg-transparent" />
            
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
