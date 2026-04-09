import { currentUser } from "@clerk/nextjs/server";
import db from "@/lib/db";
import { verifyUserHasAccessToLocation } from "@/lib/auth/permissions";
import { getLocationPrintBranding, buildPropertyPrintPreviewData } from "@/lib/properties/print-preview";
import { PropertyPrintPreview } from "@/app/(main)/admin/properties/_components/property-print-preview";
import { PropertyPrintPreviewActions } from "@/app/(main)/admin/properties/_components/property-print-preview-actions";

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
        <div>
            <PropertyPrintPreviewActions pdfHref={`/admin/properties/${property.id}/print/${draft.id}/pdf`} />
            <PropertyPrintPreview data={data} />
        </div>
    );
}
