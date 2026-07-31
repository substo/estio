import { cookies } from "next/headers";
import db from "@/lib/db";
import { generatePdfViaPuppeteer } from "@/lib/properties/print-puppeteer";
import { securelyRecordAiUsage } from "@/lib/ai/usage-metering";
import {
    PropertyAccessDeniedError,
    requirePropertyInActiveLocation,
} from "@/lib/properties/active-location-access";

export async function GET(
    _request: Request,
    { params }: { params: Promise<{ id: string; draftId: string }> }
) {
    const { id, draftId } = await params;
    let locationId: string;
    let dbUserId: string;
    try {
        const access = await requirePropertyInActiveLocation(id);
        locationId = access.locationId;
        dbUserId = access.dbUserId;
    } catch (error) {
        if (error instanceof PropertyAccessDeniedError) {
            return new Response("Not found", { status: 404 });
        }
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

    if (!property) {
        return new Response("Property not found", { status: 404 });
    }

    const draft = await db.propertyPrintDraft.findFirst({
        where: { id: draftId, propertyId: property.id },
    });
    
    if (!draft) {
        return new Response("Print draft not found", { status: 404 });
    }

    try {
        const incomingHost = _request.headers.get("x-forwarded-host") || _request.headers.get("host");
        const proto = _request.headers.get("x-forwarded-proto") || (_request.url.startsWith("https") ? "https" : "http");
        const parsedUrl = new URL(_request.url);
        const pathname = parsedUrl.pathname.replace(/\/pdf$/, "");
        
        let targetUrl = incomingHost 
            ? `${proto}://${incomingHost}${pathname}${parsedUrl.search}`
            : _request.url.replace(/\/pdf(\?.*)?$/, "");
            
        // Final sanity check: if somehow it resulted in https://localhost, forcefully demote to http
        if (targetUrl.startsWith("https://localhost")) {
            targetUrl = targetUrl.replace("https://localhost", "http://localhost");
        }

        const requestCookies = (await cookies()).getAll();
        
        const pdfBytes = await generatePdfViaPuppeteer(targetUrl, requestCookies);

        void securelyRecordAiUsage({
            locationId,
            userId: dbUserId,
            resourceType: "property",
            resourceId: property.id,
            featureArea: "property_printing",
            action: "generate_pdf",
            provider: "system",
            model: "puppeteer-headless",
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
    } catch (error: any) {
        console.error("[print-pdf-route] PDF generation failed:", error);
        return new Response(`Failed to generate PDF. Error: ${error.message || String(error)}\nPlease try again or use browser print.`, { status: 500 });
    }
}
