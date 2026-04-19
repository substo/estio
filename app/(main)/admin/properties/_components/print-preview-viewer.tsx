"use client";

import { useState } from "react";
import { PropertyPrintPreviewActions } from "./property-print-preview-actions";
import { PropertyPrintPreview } from "./property-print-preview";

export function PrintPreviewViewer({
    pdfHref,
    data
}: {
    pdfHref: string;
    data: any;
}) {
    // 1 = auto-fit according to fitMode (which is 'both' for standalone).
    // >1 could be different zoom levels, but let's just toggle between "Fit Screen" and "100% Zoom"
    const [isZoomed, setIsZoomed] = useState(false);

    return (
        <div className="flex h-screen flex-col overflow-hidden bg-stone-200 print:h-auto print:bg-white print:overflow-visible print:block">
            <div className="print:hidden">
                <PropertyPrintPreviewActions 
                    pdfHref={pdfHref} 
                    isZoomed={isZoomed}
                    onToggleZoom={() => setIsZoomed(!isZoomed)}
                />
            </div>
            <div className={`flex flex-1 overflow-auto print:overflow-visible print:p-0 print:block ${isZoomed ? "p-8" : "p-4"}`}>
                <PropertyPrintPreview 
                    data={data} 
                    embedded={false} 
                    fitMode="both"
                    zoomScale={isZoomed ? 1 : undefined} // undefined means auto-scale
                />
            </div>
        </div>
    );
}
