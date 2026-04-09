import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { getPaperDimensions } from "@/lib/properties/print-designer";

function mmToPt(valueMm: number) {
    return valueMm * 2.8346456693;
}

function hexToRgb(color: string) {
    const normalized = String(color || "").replace("#", "").trim();
    if (normalized.length !== 6) {
        return rgb(0.62, 0.04, 0.09);
    }

    const red = parseInt(normalized.slice(0, 2), 16) / 255;
    const green = parseInt(normalized.slice(2, 4), 16) / 255;
    const blue = parseInt(normalized.slice(4, 6), 16) / 255;
    return rgb(red, green, blue);
}

function wrapText(text: string, maxChars: number) {
    const words = String(text || "").split(/\s+/).filter(Boolean);
    const lines: string[] = [];
    let current = "";

    for (const word of words) {
        const next = current ? `${current} ${word}` : word;
        if (next.length > maxChars && current) {
            lines.push(current);
            current = word;
        } else {
            current = next;
        }
    }

    if (current) lines.push(current);
    return lines;
}

async function fetchImageBytes(url: string | null | undefined) {
    const normalized = String(url || "").trim();
    if (!normalized) return null;

    try {
        const response = await fetch(normalized);
        if (!response.ok) return null;
        const contentType = response.headers.get("content-type") || "";
        const bytes = await response.arrayBuffer();
        return { bytes, contentType };
    } catch {
        return null;
    }
}

async function safeEmbedImage(pdfDoc: PDFDocument, imageData: { bytes: ArrayBuffer; contentType: string }) {
    try {
        if (imageData.contentType.includes("png")) {
            return await pdfDoc.embedPng(imageData.bytes);
        }
        if (imageData.contentType.includes("jpeg") || imageData.contentType.includes("jpg")) {
            return await pdfDoc.embedJpg(imageData.bytes);
        }
        // Unsupported format (WebP, AVIF, SVG, etc.) — skip gracefully
        console.warn(`[print-pdf] Skipping unsupported image format: ${imageData.contentType}`);
        return null;
    } catch (err) {
        console.warn(`[print-pdf] Failed to embed image:`, err);
        return null;
    }
}

export async function generatePropertyPrintPdf(data: any) {
    const pdfDoc = await PDFDocument.create();
    const paper = getPaperDimensions(data.draft.paperSize, data.draft.orientation);
    const page = pdfDoc.addPage([mmToPt(paper.widthMm), mmToPt(paper.heightMm)]);
    const width = page.getWidth();
    const height = page.getHeight();
    const margin = 28;
    const accent = hexToRgb(data.branding.primaryColor || "#9d0917");

    const fontRegular = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

    page.drawRectangle({
        x: 0,
        y: 0,
        width,
        height,
        color: rgb(0.99, 0.99, 0.99),
    });

    const heroImage = data.images[0];
    const heroBytes = await fetchImageBytes(heroImage?.url);
    if (heroBytes) {
        const embedded = await safeEmbedImage(pdfDoc, heroBytes);
        if (embedded) {
            page.drawImage(embedded, {
                x: margin,
                y: height - 250,
                width: width * 0.52,
                height: 220,
            });
        }
    }

    const logoBytes = await fetchImageBytes(data.branding.logoUrl);
    if (logoBytes) {
        const embeddedLogo = await safeEmbedImage(pdfDoc, logoBytes);
        if (embeddedLogo) {
            page.drawImage(embeddedLogo, {
                x: width - 180,
                y: height - 80,
                width: 140,
                height: 40,
            });
        }
    }

    let cursorY = height - margin - 24;
    page.drawText(data.property.priceText, {
        x: width * 0.58,
        y: cursorY,
        font: fontBold,
        size: 20,
        color: accent,
    });

    cursorY -= 30;
    page.drawText(data.draft.generatedContent.title || data.property.title, {
        x: width * 0.58,
        y: cursorY,
        font: fontBold,
        size: 18,
        color: rgb(0.12, 0.14, 0.17),
        maxWidth: width * 0.34,
    });

    cursorY -= 24;
    page.drawText(data.draft.generatedContent.subtitle || data.property.locationLine || "", {
        x: width * 0.58,
        y: cursorY,
        font: fontRegular,
        size: 11,
        color: rgb(0.38, 0.4, 0.45),
        maxWidth: width * 0.34,
    });

    cursorY -= 28;
    for (const fact of data.property.facts.slice(0, 4)) {
        page.drawText(`${fact.label}: ${fact.value}`, {
            x: width * 0.58,
            y: cursorY,
            font: fontBold,
            size: 10,
            color: rgb(0.2, 0.22, 0.25),
        });
        cursorY -= 16;
    }

    cursorY -= 8;
    const languages = data.draft.generatedContent.languages
        .filter((block: any) => data.draft.languages.includes(block.language))
        .slice(0, 2);
    for (const block of languages) {
        page.drawText(block.label, {
            x: width * 0.58,
            y: cursorY,
            font: fontBold,
            size: 10,
            color: accent,
        });
        cursorY -= 16;
        const lines = wrapText(block.body, 48).slice(0, 11);
        for (const line of lines) {
            page.drawText(line, {
                x: width * 0.58,
                y: cursorY,
                font: fontRegular,
                size: 10,
                color: rgb(0.23, 0.24, 0.27),
            });
            cursorY -= 13;
        }
        cursorY -= 8;
    }

    const footerY = 60;
    page.drawLine({
        start: { x: margin, y: footerY + 35 },
        end: { x: width - margin, y: footerY + 35 },
        thickness: 1,
        color: rgb(0.85, 0.85, 0.87),
    });

    page.drawText(data.property.reference || "", {
        x: margin,
        y: footerY + 12,
        font: fontBold,
        size: 10,
        color: accent,
    });

    const footerLines = [
        data.draft.generatedContent.contactCta,
        data.branding.contact.mobile,
        data.branding.contact.landline,
        data.branding.contact.email,
        data.branding.publicUrl,
    ].filter(Boolean);

    let footerTextY = footerY + 12;
    for (const line of footerLines.slice(0, 5)) {
        page.drawText(String(line), {
            x: width * 0.42,
            y: footerTextY,
            font: fontRegular,
            size: 10,
            color: rgb(0.28, 0.29, 0.33),
        });
        footerTextY -= 12;
    }

    const footerNoteLines = wrapText(data.draft.generatedContent.footerNote || "", 90).slice(0, 3);
    let footerNoteY = footerY - 24;
    for (const line of footerNoteLines) {
        page.drawText(line, {
            x: margin,
            y: footerNoteY,
            font: fontRegular,
            size: 9,
            color: rgb(0.42, 0.43, 0.47),
        });
        footerNoteY -= 10;
    }

    return pdfDoc.save();
}
