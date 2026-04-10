"use client";

import React, { useRef, useLayoutEffect, useState } from "react";

export function AutoFitText({
    children,
    minFontSize = 7,
    maxFontSize = 14,
    step = 0.5,
    className = "",
    style = {},
}: {
    children: React.ReactNode;
    minFontSize?: number;
    maxFontSize?: number;
    step?: number;
    className?: string;
    style?: React.CSSProperties;
}) {
    const containerRef = useRef<HTMLDivElement>(null);
    const contentRef = useRef<HTMLDivElement>(null);
    const [fontSize, setFontSize] = useState(maxFontSize);

    useLayoutEffect(() => {
        const container = containerRef.current;
        const content = contentRef.current;
        if (!container || !content) return;

        const observer = new ResizeObserver(() => {
            let currentSize = maxFontSize;
            content.style.fontSize = `${currentSize}pt`;
            
            // Allow the browser to apply the style
            requestAnimationFrame(() => {
                while (
                    currentSize > minFontSize && 
                    (content.scrollHeight > container.clientHeight || content.scrollWidth > container.clientWidth)
                ) {
                    currentSize -= step;
                    content.style.fontSize = `${currentSize}pt`;
                }
                setFontSize(Math.max(minFontSize, currentSize));
            });
        });

        observer.observe(container);
        return () => observer.disconnect();
    }, [children, maxFontSize, minFontSize, step]);

    return (
        <div ref={containerRef} className={`w-full h-full overflow-hidden ${className}`} style={style}>
            <div ref={contentRef} style={{ fontSize: `${fontSize}pt`, height: 'auto', minHeight: '100%' }}>
                {children}
            </div>
        </div>
    );
}
