import { NextResponse } from "next/server";

import { getLocationContext } from "@/lib/auth/location-context";
import {
    cancelScheduledMessage,
    sendScheduledMessageNow,
    updateScheduledMessage,
} from "@/lib/conversations/scheduled-messages";

type RouteContext = {
    params: Promise<{ id: string }> | { id: string };
};

export async function PATCH(request: Request, context: RouteContext) {
    const location = await getLocationContext();
    if (!location?.id) {
        return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    }

    const params = await context.params;
    const body = await request.json().catch(() => ({}));
    const result = await updateScheduledMessage({
        locationId: location.id,
        id: params.id,
        body: body?.body,
        scheduledFor: body?.scheduledFor,
        scheduledTimeZone: body?.scheduledTimeZone,
        scheduledLocal: body?.scheduledLocal,
        channel: body?.channel,
    });

    return NextResponse.json(result, { status: result.success ? 200 : 400 });
}

export async function DELETE(_request: Request, context: RouteContext) {
    const location = await getLocationContext();
    if (!location?.id) {
        return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    }

    const params = await context.params;
    const result = await cancelScheduledMessage({
        locationId: location.id,
        id: params.id,
    });

    return NextResponse.json(result, { status: result.success ? 200 : 400 });
}

export async function POST(_request: Request, context: RouteContext) {
    const location = await getLocationContext();
    if (!location?.id) {
        return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    }

    const params = await context.params;
    const result = await sendScheduledMessageNow({
        locationId: location.id,
        id: params.id,
    });

    return NextResponse.json(result, { status: result.success ? 200 : 400 });
}
