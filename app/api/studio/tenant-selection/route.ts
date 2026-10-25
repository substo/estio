import { NextResponse } from "next/server";
/** Retired storage-ID preference protocol. Tenant selection uses Location IDs only. */
export async function POST() {
  return NextResponse.json({ error: "Reload Studio to use location selection." }, { status: 409, headers: { "Cache-Control": "no-store" } });
}
