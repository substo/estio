import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { createDirectUploadUrl } from "@/lib/cloudflareImages";
import { verifyUserHasAccessToLocation } from "@/lib/auth/permissions";

export async function POST(req: Request) {
    try {
        const session = await auth();
        const userId = session.userId;

        if (!userId) {
            return new NextResponse("Unauthorized", { status: 401 });
        }

        const body = await req.json();
        const { locationId, metadata } = body;

        if (!locationId) {
            return new NextResponse("Missing locationId", { status: 400 });
        }

        // Verify user has access to this location
        const hasAccess = await verifyUserHasAccessToLocation(userId, locationId);
        if (!hasAccess) {
            return new NextResponse("Forbidden", { status: 403 });
        }

        // Create the upload URL
        // We pass locationId in metadata to Cloudflare for tracking
        const result = await createDirectUploadUrl({
            requireSignedURLs: false,
            metadata: {
                ...metadata,
                locationId: locationId,
                uploadedBy: userId
            }
        });

        return NextResponse.json(result);

    } catch (error) {
        console.error("Direct Upload Error:", error);
        return new NextResponse("Internal Server Error", { status: 500 });
    }
}
