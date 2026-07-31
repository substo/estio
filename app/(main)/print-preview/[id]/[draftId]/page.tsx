import { notFound } from "next/navigation";
import db from "@/lib/db";
import { getLocationPrintBranding, buildPropertyPrintPreviewData } from "@/lib/properties/print-preview";
import { PrintPreviewViewer } from "@/app/(main)/admin/properties/_components/print-preview-viewer";
import {
    PropertyAccessDeniedError,
    requirePropertyInActiveLocation,
} from "@/lib/properties/active-location-access";

export const dynamic = "force-dynamic";

export default async function PropertyPrintPreviewPage({
    params,
}: {
    params: Promise<{ id: string; draftId: string }>;
}) {
    const { id, draftId } = await params;
    let locationId: string;
    try {
        locationId = (await requirePropertyInActiveLocation(id)).locationId;
    } catch (error) {
        if (error instanceof PropertyAccessDeniedError) notFound();
        throw error;
    }

    const property = await db.property.findFirst({
        where: { id, locationId },
        include: {
            media: {
                orderBy: { sortOrder: "asc" },
            },
        },
    });

    if (!property) notFound();

    const draft = await db.propertyPrintDraft.findFirst({
        where: { id: draftId, propertyId: property.id },
    });

    if (!draft) {
        notFound();
    }

    const branding = await getLocationPrintBranding(locationId);
    const data = buildPropertyPrintPreviewData({ property, draft, branding });

    return (
        <PrintPreviewViewer 
            pdfHref={`/print-preview/${property.id}/${draft.id}/pdf`} 
            data={data} 
        />
    );
}
