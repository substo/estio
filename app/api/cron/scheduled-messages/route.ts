import { NextResponse } from "next/server";

import { dispatchDueScheduledMessages } from "@/lib/conversations/scheduled-messages";

export async function GET(request: Request) {
    return runScheduledMessagesCron(request);
}

export async function POST(request: Request) {
    return runScheduledMessagesCron(request);
}

async function runScheduledMessagesCron(request: Request) {
    const url = new URL(request.url);
    const result = await dispatchDueScheduledMessages({
        locationId: url.searchParams.get("locationId"),
        limit: Number(url.searchParams.get("limit") || 100),
    });

    return NextResponse.json({ success: true, ...result });
}
