"use client";

import { FileDown, Printer } from "lucide-react";
import { Button } from "@/components/ui/button";

export function PropertyPrintPreviewActions({
    pdfHref,
}: {
    pdfHref: string;
}) {
    return (
        <div className="print:hidden sticky top-0 z-20 border-b bg-background/95 backdrop-blur">
            <div className="mx-auto flex max-w-6xl items-center justify-end gap-2 px-6 py-3">
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
