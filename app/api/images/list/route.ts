import { NextResponse } from "next/server";
import { listImages } from "@/lib/cloudflareImages";
import {
    PropertyAccessDeniedError,
    requireAuthenticatedLocationContext,
} from "@/lib/properties/active-location-access";
import { listBoundedLocationImages } from "@/lib/properties/location-image-gallery";

export async function GET(req: Request) {
    try {
        const { locationId } = await requireAuthenticatedLocationContext();

        const { searchParams } = new URL(req.url);
        const requestedLimit = parseInt(searchParams.get("per_page") || "50");
        const result = await listBoundedLocationImages({
            locationId,
            limit: Number.isFinite(requestedLimit) ? requestedLimit : 50,
            fetchPage: async (page, perPage) => {
                const pageResult = await listImages({ page, per_page: perPage });
                return pageResult.images;
            },
        });

        return NextResponse.json(result);

    } catch (error) {
        if (error instanceof PropertyAccessDeniedError) {
            return new NextResponse("Not found", { status: 404 });
        }
        console.error("List Images Error:", error);
        return new NextResponse("Internal Server Error", { status: 500 });
    }
}
