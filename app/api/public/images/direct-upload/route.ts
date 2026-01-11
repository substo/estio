import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { createDirectUploadUrl } from "@/lib/cloudflareImages";

export async function POST(req: Request) {
    try {
        const session = await auth();
        const userId = session.userId;

        if (!userId) {
            return new NextResponse("Unauthorized", { status: 401 });
        }

        const body = await req.json();
        const { locationId, metadata } = body;

        // Note: For public uploads, we trust the Clerk authentication.
        // We ensure the locationId is present to associate the image correctly in Cloudflare metadata,
        // but we don't need to check strict Admin permissions for the location, just that the user is logged in.
        // In a real multi-tenant scenario, we might want to verify the user "belongs" to the location (site),
        // but typically public users (Contacts) are loosely coupled until they interact.

        if (!locationId) {
            return new NextResponse("Missing locationId", { status: 400 });
        }

        // Create the upload URL
        const result = await createDirectUploadUrl({
            requireSignedURLs: false,
            metadata: {
                ...metadata,
                locationId: locationId,
                uploadedBy: userId,
                source: "public-submission"
            }
        });

        return NextResponse.json(result);

    } catch (error) {
        console.error("Public Direct Upload Error:", error);
        return new NextResponse("Internal Server Error", { status: 500 });
    }
}
