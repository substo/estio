import { NextRequest, NextResponse } from "next/server";
import { analyticsTrackPayloadSchema } from "@/lib/analytics/events";
import { recordAnalyticsRouteEvent } from "@/lib/analytics/server";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }

  const parsed = analyticsTrackPayloadSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "invalid_payload" }, { status: 400 });
  }

  const payload = parsed.data;

  const result = await recordAnalyticsRouteEvent({
    eventName: payload.eventName,
    domain: payload.domain || null,
    anonymousId: payload.anonymousId,
    externalSessionId: payload.sessionId,
    path: payload.path,
    title: payload.title,
    referrer: payload.referrer,
    entityType: payload.entityType,
    entityId: payload.entityId,
    propertyId: payload.propertyId,
    metadata: payload.metadata,
    occurredAt: payload.occurredAt || null,
    headers: request.headers,
    cookies: request.cookies,
  });

  return NextResponse.json({
    ok: true,
    recorded: result.recorded,
    visitorId: result.visitorAnonymousId,
    sessionId: result.externalSessionId,
  }, {
    headers: result.headers,
  });
}
