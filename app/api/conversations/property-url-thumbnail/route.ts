import { NextRequest, NextResponse } from "next/server";
import { getLocationContext } from "@/lib/auth/location-context";
import { fetchPublicHttpResponse, PropertyUrlFetchError } from "@/lib/conversations/property-url-context";
import { verifyPropertyThumbnailToken } from "@/lib/conversations/property-thumbnail";

export const runtime = "nodejs";
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

async function readImageWithLimit(response: Response) {
    const declaredSize = Number(response.headers.get("content-length") || 0);
    if (declaredSize > MAX_IMAGE_BYTES) throw new PropertyUrlFetchError("Thumbnail exceeds the 5 MB limit.", "image_too_large");
    if (!response.body) return new Uint8Array();
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > MAX_IMAGE_BYTES) {
            await reader.cancel();
            throw new PropertyUrlFetchError("Thumbnail exceeds the 5 MB limit.", "image_too_large");
        }
        chunks.push(value);
    }
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
    }
    return bytes;
}

export async function GET(req: NextRequest) {
    if (!(await getLocationContext())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const token = req.nextUrl.searchParams.get("token") || "";
    const suppliedSignature = req.nextUrl.searchParams.get("signature") || "";
    const verified = verifyPropertyThumbnailToken(token, suppliedSignature);
    if (!verified) return NextResponse.json({ error: "Invalid or expired thumbnail token." }, { status: 403 });

    try {
        const { response } = await fetchPublicHttpResponse(verified.url, {
            timeoutMs: 10_000,
            accept: "image/avif,image/webp,image/png,image/jpeg,image/gif,image/*;q=0.8",
        });
        if (!response.ok) return NextResponse.json({ error: `Thumbnail fetch failed (${response.status}).` }, { status: 502 });
        const contentType = (response.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
        if (!contentType.startsWith("image/") || contentType === "image/svg+xml") {
            return NextResponse.json({ error: "Thumbnail response was not a supported raster image." }, { status: 415 });
        }
        const bytes = await readImageWithLimit(response);
        return new NextResponse(bytes, {
            headers: {
                "Content-Type": contentType,
                "Content-Length": String(bytes.byteLength),
                "Cache-Control": "private, max-age=3600, stale-while-revalidate=86400",
                "X-Content-Type-Options": "nosniff",
            },
        });
    } catch (error) {
        const message = error instanceof Error ? error.message : "Thumbnail fetch failed.";
        console.warn("[property-thumbnail]", JSON.stringify({ event: "fetch_failed", error: message }));
        return NextResponse.json({ error: message }, { status: 502 });
    }
}
