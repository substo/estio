import { NextRequest, NextResponse } from "next/server";
import db from "@/lib/db";
import { getLocationContext } from "@/lib/auth/location-context";
import { createWhatsAppMediaReadUrl, parseR2Uri } from "@/lib/whatsapp/media-r2";

export const runtime = "nodejs";

export async function GET(
    req: NextRequest,
    { params }: { params: Promise<{ attachmentId: string }> }
) {
    const { attachmentId } = await params;
    const isDownload = req.nextUrl.searchParams.get("download") === "1";
    const location = await getLocationContext();

    if (!location) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const attachment = await db.messageAttachment.findUnique({
        where: { id: attachmentId },
        include: {
            message: {
                include: {
                    conversation: {
                        select: { locationId: true }
                    }
                }
            }
        }
    });

    if (!attachment || attachment.message.conversation.locationId !== location.id) {
        return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    if (!attachment.url) {
        return NextResponse.json({ error: "Attachment URL missing" }, { status: 404 });
    }

    if (!attachment.url.startsWith("r2://")) {
        return NextResponse.redirect(attachment.url, { status: 302 });
    }

    const parsed = parseR2Uri(attachment.url);
    if (!parsed) {
        return NextResponse.json({ error: "Invalid storage URL" }, { status: 500 });
    }

    try {
        const signedUrl = await createWhatsAppMediaReadUrl({
            key: parsed.key,
            contentType: attachment.contentType,
            fileName: attachment.fileName,
            disposition: isDownload ? "attachment" : "inline",
            expiresInSeconds: 300,
        });
        return NextResponse.redirect(signedUrl, { status: 302 });
    } catch (error) {
        console.error("[Media Attachment] Failed to sign R2 URL:", error);
        return NextResponse.json({ error: "Failed to fetch attachment" }, { status: 500 });
    }
}
