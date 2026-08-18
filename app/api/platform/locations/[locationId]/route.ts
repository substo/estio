import { NextResponse } from "next/server";
import { deletePlatformLocation } from "@/lib/platform/location-deletion";
import { LocationDeletionError, locationDeletionHttpStatus } from "@/lib/platform/location-deletion-policy";

export const dynamic = "force-dynamic";

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ locationId: string }> },
) {
  try {
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return NextResponse.json({ error: "Invalid request." }, { status: 400 });
    }
    const { locationId } = await params;
    const result = await deletePlatformLocation({
      locationId,
      confirmationName: String((body as { confirmationName?: unknown }).confirmationName || ""),
    });
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const expected = error instanceof LocationDeletionError;
    if (!expected) console.error("[Platform] Location deletion failed", error);
    const message = expected ? error.message : "The location could not be deleted.";
    return NextResponse.json(
      { error: message },
      { status: locationDeletionHttpStatus(error), headers: { "Cache-Control": "no-store" } },
    );
  }
}
