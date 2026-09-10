import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { createDirectUploadUrl } from "@/lib/cloudflareImages";
import { resolvePublicSiteContactContext } from "@/lib/auth/public-site-contact-context";
import { handlePublicImageDirectUpload } from "./service";

export async function POST(req: Request) {
    try {
        return await handlePublicImageDirectUpload(req, {
            getUserId: async () => (await auth()).userId,
            resolveContext: resolvePublicSiteContactContext,
            createUploadUrl: createDirectUploadUrl,
        });
    } catch (error) {
        console.error("Public Direct Upload Error:", error);
        return new NextResponse("Internal Server Error", { status: 500 });
    }
}
