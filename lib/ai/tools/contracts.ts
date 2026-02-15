import db from "@/lib/db";
import { PDFDocument } from "pdf-lib";
import { uploadMediaFile } from "@/lib/ghl/media";

/**
 * contracts.ts
 * Tools for Phase 5: Closer Agent
 */

/**
 * Generate a legal contract PDF from a template and store in GHL.
 * Fills in buyer, seller, property, and price details.
 */
export async function generateContract(data: {
    dealId: string;
    type: "reservation" | "sales_contract";
    buyer: { name: string; email: string; address: string };
    seller: { name: string; email: string; address: string };
    property: { title: string; address: string; area: number };
    terms: { agreedPrice: number; depositAmount: number; completionDate: string; conditions: string[] };
}) {
    try {
        // 1. Fetch Deal Location to get Access Token
        const deal = await db.dealContext.findUnique({
            where: { id: data.dealId },
            include: { location: true }
        });

        if (!deal || !deal.location.ghlAccessToken) {
            throw new Error("Deal location not found or not connected to GHL. Cannot upload contract.");
        }

        const accessToken = deal.location.ghlAccessToken;

        // 2. Generate PDF
        const pdfDoc = await PDFDocument.create();
        const page = pdfDoc.addPage();
        const { width, height } = page.getSize();
        const fontSize = 12;

        page.drawText(`CONTRACT: ${data.type.toUpperCase().replace("_", " ")}`, {
            x: 50,
            y: height - 50,
            size: 20,
        });

        const text = `
    Date: ${new Date().toLocaleDateString()}
    
    BETWEEN:
    Seller: ${data.seller.name} (${data.seller.address})
    AND
    Buyer: ${data.buyer.name} (${data.buyer.address})
    
    PROPERTY:
    ${data.property.title}
    Address: ${data.property.address}
    Area: ${data.property.area} sqm
    
    TERMS:
    Agreed Price: €${data.terms.agreedPrice.toLocaleString()}
    Deposit: €${data.terms.depositAmount.toLocaleString()}
    Completion Date: ${data.terms.completionDate}
    
    CONDITIONS:
    ${data.terms.conditions.map((c, i) => `${i + 1}. ${c}`).join("\n")}
    
    _________________________          _________________________
    Seller Signature                   Buyer Signature
    `;

        page.drawText(text, {
            x: 50,
            y: height - 100,
            size: fontSize,
            maxWidth: width - 100,
            lineHeight: 15,
        });

        const pdfBytes = await pdfDoc.save();

        // 3. Upload to GHL Media Library
        const fileName = `${data.type}_${data.dealId}_${Date.now()}.pdf`;
        const blob = new Blob([Buffer.from(pdfBytes)], { type: "application/pdf" });

        // Note: passing blob as 'file' might need casting/wrapping depending on environment
        // straightforward blob usually works with FormData in Node 18+
        const uploaded = await uploadMediaFile(accessToken, {
            file: blob,
            name: fileName,
            hosted: false
        });

        if (!uploaded || !uploaded.url) {
            throw new Error("Failed to get URL from GHL Media upload.");
        }

        // 4. Create DB record
        const document = await db.dealDocument.create({
            data: {
                dealId: data.dealId,
                type: data.type,
                name: fileName,
                fileUrl: uploaded.url, // Store the GHL URL
                status: "draft",
            },
        });

        return { success: true, document };

    } catch (e) {
        console.error("Contract generation failed", e);
        throw new Error(`Failed to generate contract: ${(e as any).message}`);
    }
}
