import { NextResponse } from "next/server";
import { createDirectUploadUrl } from "@/lib/cloudflareImages";
import {
    PropertyAccessDeniedError,
    requireAuthenticatedLocationContext,
} from "@/lib/properties/active-location-access";

export async function POST(req: Request) {
    try {
        const body = await req.json();
        const { locationId, metadata } = body;

        if (!locationId) {
            return new NextResponse("Missing locationId", { status: 400 });
        }

        const access = await requireAuthenticatedLocationContext(locationId);

        // Create the upload URL
        // We pass locationId in metadata to Cloudflare for tracking
        const result = await createDirectUploadUrl({
            requireSignedURLs: false,
            metadata: {
                ...metadata,
                locationId: access.locationId,
                uploadedBy: access.dbUserId,
                purpose: "admin_media",
                workflow: "direct_upload",
            }
        });

        return NextResponse.json(result);

    } catch (error) {
        if (error instanceof PropertyAccessDeniedError) {
            return new NextResponse("Not found", { status: 404 });
        }
        console.error("Direct Upload Error:", error);
        return new NextResponse("Internal Server Error", { status: 500 });
    }
}
