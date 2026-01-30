import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { listImages } from "@/lib/cloudflareImages";

export async function GET(req: Request) {
    try {
        const session = await auth();
        if (!session.userId) {
            return new NextResponse("Unauthorized", { status: 401 });
        }

        const { searchParams } = new URL(req.url);
        const page = parseInt(searchParams.get("page") || "1");
        const per_page = parseInt(searchParams.get("per_page") || "50");

        const result = await listImages({ page, per_page });

        return NextResponse.json(result);

    } catch (error) {
        console.error("List Images Error:", error);
        return new NextResponse("Internal Server Error", { status: 500 });
    }
}
