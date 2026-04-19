import { currentUser } from "@clerk/nextjs/server";
import { cookies } from "next/headers";
import db from "@/lib/db";
import { verifyUserHasAccessToLocation } from "@/lib/auth/permissions";
import { generatePdfViaPuppeteer } from "@/lib/properties/print-puppeteer";
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
            locationId: property.locationId,
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
