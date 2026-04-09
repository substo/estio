import { currentUser } from "@clerk/nextjs/server";
import db from "@/lib/db";
import { verifyUserHasAccessToLocation } from "@/lib/auth/permissions";
import { buildPropertyPrintPreviewData, getLocationPrintBranding } from "@/lib/properties/print-preview";
import { generatePropertyPrintPdf } from "@/lib/properties/print-pdf";
import { securelyRecordAiUsage } from "@/lib/ai/usage-metering";

export async function GET(
    _request: Request,
    { params }: { params: Promise<{ id: string; draftId: string }> }
) {
    const { id, draftId } = await params;
    const user = await currentUser();

    if (!user) {
        return new Response("Unauthorized", { status: 401 });
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
        return new Response("Property not found", { status: 404 });
    }

    const hasAccess = await verifyUserHasAccessToLocation(user.id, property.locationId);
    if (!hasAccess) {
        return new Response("Unauthorized", { status: 403 });
    }

    const draft = await db.propertyPrintDraft.findFirst({
        where: { id: draftId, propertyId: property.id },
    });
    if (!draft) {
        return new Response("Print draft not found", { status: 404 });
    }

    const branding = await getLocationPrintBranding(property.locationId);
    const data = buildPropertyPrintPreviewData({ property, draft, branding });

    try {
        const pdfBytes = await generatePropertyPrintPdf(data);

        void securelyRecordAiUsage({
            locationId: property.locationId,
            resourceType: "property",
            resourceId: property.id,
            featureArea: "property_printing",
            action: "generate_pdf",
            provider: "system",
            model: String((draft.generationMetadata as any)?.model || "pdf-lib"),
            metadata: {
                draftId: draft.id,
                templateId: draft.templateId,
            },
        });

        return new Response(Buffer.from(pdfBytes), {
            headers: {
                "Content-Type": "application/pdf",
                "Content-Disposition": `inline; filename="${property.slug || property.id}-${draft.id}.pdf"`,
            },
        });
    } catch (error) {
        console.error("[print-pdf-route] PDF generation failed:", error);
        return new Response("Failed to generate PDF. Please try again or use browser print.", { status: 500 });
    }
}
