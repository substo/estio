import { NextResponse } from "next/server";
import { recordCurrentLocationSession } from "@/lib/team/location-session-access";

export async function POST() {
  const result = await recordCurrentLocationSession();
  return NextResponse.json(result.body, { status: result.status });
}
