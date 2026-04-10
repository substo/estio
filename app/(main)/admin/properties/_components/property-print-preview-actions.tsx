"use client";

import { FileDown, Printer, ZoomIn, ZoomOut } from "lucide-react";
import { Button } from "@/components/ui/button";

export function PropertyPrintPreviewActions({
    pdfHref,
    isZoomed,
    onToggleZoom,
}: {
    pdfHref: string;
    isZoomed?: boolean;
    onToggleZoom?: () => void;
}) {
    return (
        <div className="print:hidden sticky top-0 z-20 border-b bg-background/95 backdrop-blur shrink-0">
            <div className="mx-8 flex items-center justify-end gap-2 py-3">
                {onToggleZoom && (
                    <Button type="button" variant="ghost" onClick={onToggleZoom} className="mr-auto">
                        {isZoomed ? (
                            <><ZoomOut className="mr-2 h-4 w-4" /> Fit Screen</>
                        ) : (
                            <><ZoomIn className="mr-2 h-4 w-4" /> Zoom 100%</>
                        )}
                    </Button>
                )}
                <Button type="button" variant="outline" asChild>
                    <a href={pdfHref} target="_blank" rel="noopener noreferrer">
                        <FileDown className="mr-2 h-4 w-4" />
                        Download PDF
                    </a>
                </Button>
                <Button type="button" onClick={() => window.print()}>
                    <Printer className="mr-2 h-4 w-4" />
                    Print / Save as PDF
                </Button>
            </div>
        </div>
    );
}
