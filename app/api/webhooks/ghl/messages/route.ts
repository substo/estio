import { NextRequest, NextResponse } from 'next/server';

export async function POST(req: NextRequest) {
    try {
        const bodyText = await req.text();
        // Validation logic can be added here if GHL signs requests

        const payload = JSON.parse(bodyText);
        console.log('[GHL Webhook] Message Event:', payload.type);

        // We are primarily interested in 'InboundMessage' to trigger AI or UI updates
        // Payload usually contains: type, locationId, conversationId, messageId, body, contactId, ...

        if (payload.type === 'InboundMessage') {
            console.log(`[GHL Webhook] New Message from Contact ${payload.contactId}: ${payload.body}`);
            // TODO: Signal UI to refresh or invalidates cache
            // TODO: Trigger AI Coordinator if auto-reply is enabled
        }

        return NextResponse.json({ message: 'Received' }, { status: 200 });
    } catch (error: any) {
        console.error('[GHL Webhook] Error:', error);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}
