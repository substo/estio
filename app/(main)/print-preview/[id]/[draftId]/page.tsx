import { currentUser } from "@clerk/nextjs/server";
import db from "@/lib/db";
import { verifyUserHasAccessToLocation } from "@/lib/auth/permissions";
import { getLocationPrintBranding, buildPropertyPrintPreviewData } from "@/lib/properties/print-preview";
import { PrintPreviewViewer } from "@/app/(main)/admin/properties/_components/print-preview-viewer";

export const dynamic = "force-dynamic";

export default async function PropertyPrintPreviewPage({
    params,
}: {
    params: Promise<{ id: string; draftId: string }>;
}) {
    const { id, draftId } = await params;
    const user = await currentUser();

    if (!user) {
        return <div className="p-6">Unauthorized.</div>;
    }

    const property = await db.property.findFirst({
        where: { id },
        include: {
            media: {
                orderBy: { sortOrder: "asc" },
            },
        },
    });

    if (!property) {
        return <div className="p-6">Property not found.</div>;
    }

    const hasAccess = await verifyUserHasAccessToLocation(user.id, property.locationId);
    if (!hasAccess) {
        return <div className="p-6">Unauthorized.</div>;
    }

    const draft = await db.propertyPrintDraft.findFirst({
        where: { id: draftId, propertyId: property.id },
    });

    if (!draft) {
        return <div className="p-6">Print draft not found.</div>;
    }

    const branding = await getLocationPrintBranding(property.locationId);
    const data = buildPropertyPrintPreviewData({ property, draft, branding });

    return (
        <PrintPreviewViewer 
            pdfHref={`/print-preview/${property.id}/${draft.id}/pdf`} 
            data={data} 
        />
    );
}
