"use client";

import { useEffect, useState } from "react";

export function PrintScaleWrapper({
    widthMm,
    children,
}: {
    widthMm: number;
    children: React.ReactNode;
}) {
    const [scale, setScale] = useState(1);

    useEffect(() => {
        function updateScale() {
            // Approx pixel width of the paper (1mm ≈ 3.78px)
            const pixelWidth = widthMm * 3.7795275591;
            // Available width (subtracting some padding)
            const availableWidth = window.innerWidth - 80;
            
            if (pixelWidth > availableWidth) {
                setScale(availableWidth / pixelWidth);
            } else {
                setScale(1);
            }
        }

        updateScale();
        window.addEventListener("resize", updateScale);
        return () => window.removeEventListener("resize", updateScale);
    }, [widthMm]);

    return (
        <div
            className="print:!transform-none print:w-auto print:h-auto"
            style={{
                transform: `scale(${scale})`,
                transformOrigin: "top center",
            }}
        >
            {children}
        </div>
    );
}
