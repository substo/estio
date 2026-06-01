import { NextRequest, NextResponse } from "next/server";
import { getLocationContext } from "@/lib/auth/location-context";
import { extractPropertyUrlContext } from "@/lib/conversations/property-url-context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
    const location = await getLocationContext();
    if (!location) {
        return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json().catch(() => null) as { url?: unknown } | null;
    const url = typeof body?.url === "string" ? body.url : "";
    if (!url.trim()) {
        return NextResponse.json({ success: false, error: "URL is required." }, { status: 400 });
    }

    const result = await extractPropertyUrlContext(url);
    return NextResponse.json(result, { status: result.success ? 200 : 400 });
}
