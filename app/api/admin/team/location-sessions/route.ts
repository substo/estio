import { NextRequest, NextResponse } from "next/server";
import { getLocationMemberSessions } from "@/lib/team/location-session-access";

export async function GET(request: NextRequest) {
  const targetUserId = request.nextUrl.searchParams.get("userId")?.trim() || "";
  if (!targetUserId) {
    return NextResponse.json({ sessions: [], unavailable: false }, { status: 400 });
  }

  const result = await getLocationMemberSessions(targetUserId);
  return NextResponse.json(result.body, { status: result.status });
}
